import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

export function database() {
  const sql = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    sql.exec(readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8"));
  }
  const db = {
    sql, fail: null,
    prepare(query) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async first() { if (db.fail?.(query)) throw new Error("Injected database failure"); return sql.prepare(query).get(...args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...args) }; },
        async run() {
          if (db.fail?.(query)) throw new Error("Injected database failure");
          const result = sql.prepare(query).run(...args);
          return { success: true, meta: { changes: result.changes } };
        },
      };
      return statement;
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec("COMMIT"); return results; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  };
  return db;
}

export function bucket() {
  const objects = new Map();
  return {
    objects, failDelete: false, puts: 0,
    async head(key) { return objects.has(key) ? { key } : null; },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return { body: bytes, httpEtag: "fixture", writeHttpMetadata(headers) { headers.set("content-type", "image/jpeg"); } };
    },
    async put(key, stream) {
      this.puts++;
      objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer()));
    },
    async delete(key) { if (this.failDelete) throw new Error("Injected R2 failure"); objects.delete(key); },
    async list() { return { objects: [], truncated: false }; },
  };
}

export function routeFixtures(env, owner) {
  globalThis.fathersFixture = { env, owner };
  const security = new URL("../lib/security.ts", import.meta.url).href;
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "cloudflare:workers" || specifier === "@/lib/security") return { url: "fixture:" + specifier, shortCircuit: true };
      if (specifier.startsWith("@/")) return { url: new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === "fixture:cloudflare:workers") return { format: "module", source: "export const env = globalThis.fathersFixture.env", shortCircuit: true };
      if (url === "fixture:@/lib/security") return {
        format: "module", shortCircuit: true,
        source: `export { isSameOriginWrite, privateJson } from ${JSON.stringify(security)}; export async function verifyAccessOwner() { return globalThis.fathersFixture.owner; }`,
      };
      return nextLoad(url, context);
    },
  });
}
