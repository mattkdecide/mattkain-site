# Father’s Day gallery

The application is the migration baseline for the seven-album Father’s Day gallery. It remains separate from the static repository homepage; do not copy its output over the repository root. Nothing in this directory provisions, deploys, merges, or publishes infrastructure.

## Approved architecture required before deployment

The supported target is **one Cloudflare Worker built with Vinext, Cloudflare D1 for metadata, a private R2 bucket for originals, and Cloudflare Access for owner authentication**. This keeps the public approved-photo gallery and private review APIs in one runtime while retaining the imported D1/R2 data model. GitHub Pages cannot host the OAuth callback or private APIs.

This is a proposed hosting choice, not approval to create paid resources. Before provisioning, the owner must approve Cloudflare Workers/D1/R2/Access, the final hostname, and any cost. Keep the existing Sites deployment unchanged until the replacement passes staging verification.

### Security boundary

The app no longer trusts `oai-authenticated-user-*` headers. Private endpoints verify Cloudflare Access’s signed JWT (header or `CF_Authorization` cookie), including its issuer, audience, expiry, and RSA signature, and then require the verified email in `OWNER_EMAILS`. Cloudflare Access must be configured to allow only the owner to establish that cookie. Do not expose the origin on a route that bypasses the Worker.

All writes additionally require an exact same-origin `Origin` and reject cross-site Fetch Metadata. OAuth connection starts with a same-origin POST; the Google callback remains protected by a one-time, expiring state tied to the verified owner. Imported R2 objects are publicly readable only after the matching database row is approved. Pending originals require the matching owner; rejected and orphaned imports are inaccessible. Admin JSON and pending files are `private, no-store`.

## Configuration (after owner approval)

1. Run `npm ci` with Node.js 24 for the complete test suite.
2. Copy `wrangler.example.jsonc` to ignored `wrangler.jsonc`; provision D1 and R2 and replace the placeholders. Never commit account IDs, credentials, owner addresses, or secrets.
3. Apply every migration in `drizzle/` to the staging D1 database.
4. Create a Cloudflare Access self-hosted application and owner-only policy for the private application paths. Set `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `OWNER_EMAILS` exactly as shown by Access.
5. Store `GOOGLE_TOKEN_ENCRYPTION_KEY` with `wrangler secret put`. It must be a base64-encoded 32-byte value. Also set `GOOGLE_REDIRECT_URI`; register that exact HTTPS callback in Google Cloud. The client ID and secret may be runtime secrets or entered through the owner settings form.
6. Never rotate the encryption key while encrypted settings/connections exist unless those rows are migrated or intentionally discarded and reconnected.
7. Build and deploy to an isolated staging hostname first. Verify anonymous gallery reads, owner-only APIs, callback errors, imports, retry/recovery, review transitions, and mobile layout before requesting explicit publication approval.

The example deliberately contains invalid placeholders so an accidental deploy fails rather than creating or targeting resources.

## Local checks

- `npm run build` — compile the Worker bundle.
- `npm run lint` — run ESLint.
- `npm test` — build and run focused checks.

Local Vite uses disposable Miniflare bindings named `DB` and `BUCKET`. Runtime secrets belong in ignored `.dev.vars`/`.env` files and must never be committed.

## Remaining release blockers

- Owner approval of the hosting choice, hostname, and provisioning.
- Private family/person mapping and final photo approval from the owner.
- Real Google credentials, a newly registered callback URL, and end-to-end staging OAuth/import testing.
- Live staging verification of the implemented retry/lease handling, pagination, idempotent approval, and album-safe resume behavior.
- A staging review of Access path policy. Compilation alone is not release approval.

## Release preparation

See [DEPLOYMENT.md](DEPLOYMENT.md) for the /fathers path setup, configuration checks, migration order and current evidence. Local builds use wrangler.local.jsonc. Set FATHERS_DEPLOY_CONFIG explicitly for a real target. Do not attach a lifecycle deletion rule to pending/: approved originals now remain at their original key.
