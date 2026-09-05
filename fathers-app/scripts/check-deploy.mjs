import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const path = process.argv[2];
assert.ok(path, "Usage: node scripts/check-deploy.mjs <deployment-config.jsonc>");
const raw = readFileSync(path, "utf8");
// The supplied template is JSON-compatible JSONC; keep configuration strict.
const config = JSON.parse(raw);
assert.ok(!/REPLACE|00000000-0000-4000-8000-000000000000/.test(raw), "Replace all deployment placeholders.");
assert.equal(config.workers_dev, false, "Disable the workers.dev bypass.");
assert.equal(config.preview_urls, false, "Disable preview URLs.");
assert.ok(config.d1_databases?.some((db) => db.binding === "DB" && /^[a-f0-9-]{36}$/i.test(db.database_id)), "Configure D1.");
assert.ok(config.r2_buckets?.some((bucket) => bucket.binding === "BUCKET"), "Configure private R2.");
const vars = config.vars ?? {};
assert.match(vars.CF_ACCESS_TEAM_DOMAIN ?? "", /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/);
assert.ok(vars.CF_ACCESS_AUD && vars.OWNER_EMAILS, "Configure Access audience and owner allowlist.");
const callback = new URL(vars.GOOGLE_REDIRECT_URI);
assert.equal(callback.protocol, "https:");
assert.equal(callback.pathname, "/fathers/api/google/callback");
assert.ok(config.routes?.every((route) => {
  const pattern = typeof route === "string" ? route : route.pattern;
  return pattern === callback.hostname + "/fathers*" || pattern === callback.hostname + "/fathers/*" || pattern === callback.hostname + "/fathers";
}), "Routes must stay within the chosen host's /fathers path.");
assert.ok(config.routes?.length, "Configure explicit /fathers routes.");
for (const key of ["GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_ENCRYPTION_KEY"]) assert.ok(!(key in vars), key + " must be stored as a Worker secret.");
console.log("Configuration checks pass. Access policy, private bucket, secrets, billing and staging still require live verification.");
