import assert from "node:assert/strict";
import { test } from "node:test";
import { database, bucket, routeFixtures } from "./fixtures.mjs";
const DB = database();
const env = {
  DB, BUCKET: bucket(), GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  GOOGLE_REDIRECT_URI: "https://family.example/fathers/api/google/callback",
  GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-only-secret",
};
const hooks = routeFixtures(env, { id: "owner", email: "owner@example.com" });
const tokens = await import("../lib/google-photos.ts");
const callback = await import("../app/api/google/callback/route.ts");
hooks.deregister();

test("AES-GCM round trip, randomized IV, tamper and wrong-key rejection", async () => {
  const a = await tokens.encryptToken("test-refresh-token");
  const b = await tokens.encryptToken("test-refresh-token");
  assert.notEqual(a.iv, b.iv);
  assert.equal(await tokens.decryptToken(a.encrypted, a.iv), "test-refresh-token");
  const bytes = Buffer.from(a.encrypted, "base64"); bytes[0] ^= 1;
  await assert.rejects(tokens.decryptToken(bytes.toString("base64"), a.iv));
  env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  await assert.rejects(tokens.decryptToken(a.encrypted, a.iv));
  env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

test("OAuth state is owner-bound, expiring, and atomically consumed", async () => {
  let exchanges = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { exchanges++; return Response.json({ refresh_token: "test-refresh-token" }); };
  const add = (state, owner, expires) => DB.sql.prepare("INSERT INTO oauth_states VALUES (?,?,'owner@example.com','dad',?)").run(state, owner, expires);
  const request = (state) => new Request("https://family.example/fathers/api/google/callback?state=" + state + "&code=test-code");
  try {
    add("other", "other-owner", Date.now() + 60_000);
    assert.match((await callback.GET(request("other"))).headers.get("location"), /invalid-state/);
    add("expired", "owner", 1);
    assert.match((await callback.GET(request("expired"))).headers.get("location"), /invalid-state/);
    add("once", "owner", Date.now() + 60_000);
    const results = await Promise.all([callback.GET(request("once")), callback.GET(request("once"))]);
    assert.equal(exchanges, 1);
    assert.equal(results.filter((r) => r.headers.get("location").includes("google=connected")).length, 1);
    assert.ok(results.every((r) => r.headers.get("location").startsWith("https://family.example/fathers/")));
    assert.ok(results.every((r) => r.headers.get("cache-control") === "private, no-store"));
    assert.equal(DB.sql.prepare("SELECT COUNT(*) AS count FROM google_connections").get().count, 1);
  } finally { globalThis.fetch = oldFetch; }
});
