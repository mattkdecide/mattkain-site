import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Exercise the real route with a verified-owner fixture. Signature validation
// remains covered separately by security.test.mjs.
const securityUrl = new URL("../lib/security.ts", import.meta.url).href;
globalThis.reviewTestOwner = { id: "owner-id", email: "owner@example.com" };
let databaseReads = 0;
globalThis.reviewTestEnv = {
  DB: { prepare() {
    databaseReads++;
    return { bind() { return this; }, async all() { return { results: [] }; } };
  } },
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers" || specifier === "@/lib/security") {
      return { url: `fixture:${specifier}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "fixture:cloudflare:workers") return {
      format: "module", source: "export const env = globalThis.reviewTestEnv", shortCircuit: true,
    };
    if (url === "fixture:@/lib/security") return {
      format: "module", shortCircuit: true,
      source: `export { isSameOriginWrite, privateJson } from ${JSON.stringify(securityUrl)};
        export async function verifyAccessOwner() { return globalThis.reviewTestOwner; }`,
    };
    return nextLoad(url, context);
  },
});
const { GET, PATCH } = await import("../app/api/candidates/route.ts");
hooks.deregister();

test("owner can read the review queue without an Origin header", async () => {
  const response = await GET(new Request("https://family.example/api/candidates?dad=dad"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { candidates: [] });
});

test("review writes reject missing and cross-site Origin before touching the database", async () => {
  const before = databaseReads;
  for (const headers of [{}, { origin: "https://evil.example" }, {
    origin: "https://family.example", "sec-fetch-site": "cross-site",
  }]) {
    const response = await PATCH(new Request("https://family.example/api/candidates", {
      method: "PATCH", headers, body: JSON.stringify({ id: "photo", action: "approve" }),
    }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(databaseReads, before);
});

test("same-origin invalid actions and filters remain private", async () => {
  const response = await PATCH(new Request("https://family.example/api/candidates", {
    method: "PATCH", headers: { origin: "https://family.example" }, body: "{}",
  }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const invalid = await GET(new Request("https://family.example/api/candidates?dad=unknown"));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "private, no-store");
});

test("unauthenticated requests cannot read or mutate review records", async () => {
  globalThis.reviewTestOwner = null;
  const before = databaseReads;
  for (const handler of [GET, PATCH]) {
    const response = await handler(new Request("https://family.example/api/candidates?dad=dad"));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(databaseReads, before);
});
