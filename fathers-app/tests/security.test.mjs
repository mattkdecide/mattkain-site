import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isSameOriginWrite, privateJson, verifyAccessOwner } from "../lib/security.ts";

const env = {
  CF_ACCESS_TEAM_DOMAIN: "https://family.cloudflareaccess.com",
  CF_ACCESS_AUD: "fathers-audience",
  OWNER_EMAILS: "owner@example.com",
};
let privateKey;
let originalFetch;

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : value).toString("base64url");
}

async function token(overrides = {}) {
  const header = base64url(JSON.stringify({ alg: "RS256", kid: "test-key" }));
  const claims = base64url(JSON.stringify({
    aud: env.CF_ACCESS_AUD,
    email: "owner@example.com",
    exp: Math.floor(Date.now() / 1000) + 300,
    iss: env.CF_ACCESS_TEAM_DOMAIN,
    sub: "owner-id",
    ...overrides,
  }));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
}

before(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, `${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    return Response.json({ keys: [{ ...publicJwk, kid: "test-key" }] });
  };
});

after(() => { globalThis.fetch = originalFetch; });

test("rejects a request without a Cloudflare Access assertion", async () => {
  assert.equal(await verifyAccessOwner(new Request("https://mattkain.com/api/candidates"), env), null);
});

test("accepts a signed assertion only for an explicitly listed owner", async () => {
  const assertion = await token();
  const request = new Request("https://mattkain.com/api/candidates", { headers: { "cf-access-jwt-assertion": assertion } });
  assert.deepEqual(await verifyAccessOwner(request, env), { id: "owner-id", email: "owner@example.com" });

  const stranger = new Request("https://mattkain.com/api/candidates", { headers: { "cf-access-jwt-assertion": await token({ email: "stranger@example.com" }) } });
  assert.equal(await verifyAccessOwner(stranger, env), null);
});

test("rejects expired and wrong-audience assertions", async () => {
  const expired = new Request("https://mattkain.com/api/candidates", { headers: { "cf-access-jwt-assertion": await token({ exp: 1 }) } });
  const wrongAudience = new Request("https://mattkain.com/api/candidates", { headers: { "cf-access-jwt-assertion": await token({ aud: "other" }) } });
  assert.equal(await verifyAccessOwner(expired, env), null);
  assert.equal(await verifyAccessOwner(wrongAudience, env), null);
});

test("same-origin write and private response helpers enforce browser/cache boundaries", () => {
  assert.equal(isSameOriginWrite(new Request("https://mattkain.com/api/photos", { method: "POST", headers: { origin: "https://mattkain.com", "sec-fetch-site": "same-origin" } })), true);
  assert.equal(isSameOriginWrite(new Request("https://mattkain.com/api/photos", { method: "POST", headers: { origin: "https://evil.example" } })), false);
  assert.equal(privateJson({ ok: true }).headers.get("cache-control"), "private, no-store");
});
