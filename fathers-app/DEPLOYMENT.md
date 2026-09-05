# Father's Day release

## Current implementation

The gallery, API URLs, owner sign-in and OAuth callback use `/fathers`. Keep the repository root homepage, CNAME and other static files unchanged. Build from this app directory only.

Approval now changes a D1 row without moving the original. Imported keys retain their historical `pending/` prefix, but the file route allows public reads only when the corresponding row is approved. Pending files require the matching authenticated owner. Rejected and orphaned imports are inaccessible. Do not configure a lifecycle rule that deletes all `pending/` objects: approved originals also live there. Manual uploads and legacy approved keys remain under the album prefix.

Import polling uses a renewable session lease. Failed downloads leave the page checkpoint unchanged. Deterministic object keys and per-owner uniqueness make partial retries idempotent. Counts are persisted with candidate insertion. Session IDs are retained per album in browser session storage; Resume / retry continues after a page refresh. Expired Google selections require a new selection; saved candidates remain.

Keep/Skip is a final decision in the current UI. Rejected-object cleanup failures are hidden from public reads and can be retried with the same reject request. Add a scheduled cleanup process if ongoing operation creates a meaningful backlog. No cleanup job is provisioned here.

## Hosting configuration

Use Cloudflare Workers, D1, private R2 and Access. The owner has approved proceeding toward launch; account access, any billing commitment and final family photo selection must still be established.

1. Sign in to the Cloudflare account for the domain. Confirm whether mattkain.com is already a proxied Cloudflare zone. Do not change nameservers, the root DNS target, or the existing GitHub Pages origin without reviewing the exact change with the owner.
2. Pick an isolated staging hostname in a Cloudflare-managed zone. Route only its `/fathers` prefix to the Worker. Staging should be protected in full by Access until its public/private behavior is verified.
3. Create a staging D1 database and private R2 bucket after confirming billing. Disable R2 public bucket access. The original Sites data, credentials and photos are not in this checkout and are not migrated automatically.
4. Copy `wrangler.example.jsonc` to ignored `wrangler.jsonc`. Replace the placeholder routes, D1 ID, bucket, team domain, Access audience, owner allowlist and exact Google callback.
5. Configure a Cloudflare Access self-hosted application for `STAGING_HOST/fathers/*` with an owner-email Allow policy. For production, retain an Access entry application on `mattkain.com/fathers/admin`; the app itself verifies the signed Access cookie on every private API. Verify that login sets a cookie available on `/fathers/api/*` and that its audience matches CF_ACCESS_AUD. Access applications that intercept additional API paths must use the same intended audience or be accounted for explicitly.
6. Keep workers.dev and preview URLs disabled. Do not add a bypass policy for pending images. The production public gallery and approved image endpoint must remain reachable anonymously, while writes are authorized by the Worker.
7. Register a Google Web application OAuth client with the Photos Picker API enabled. Use the exact HTTPS `/fathers/api/google/callback` URL. Add the owner as a test user if the OAuth application is in testing. Enter client credentials through the private settings form or Worker secrets; never paste secrets into chat.
8. Generate and store a base64 32-byte `GOOGLE_TOKEN_ENCRYPTION_KEY` using Wrangler's secret workflow. Keep it stable for existing encrypted rows. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as secrets if the private setup form is not used.
9. Apply all three migrations to staging. Do not reapply individual SQL files manually to existing databases; use Wrangler's migration tracker.

## Commands after account/resources are configured

Use Node 24 for the complete test suite. It uses native SQLite and module hooks. These commands do not provision or deploy automatically:

```sh
npm ci
npm test
npm run lint
npx tsc --noEmit
node scripts/check-deploy.mjs wrangler.jsonc
FATHERS_DEPLOY_CONFIG=wrangler.jsonc npm run build
npx wrangler deploy --dry-run --config dist/server/wrangler.json
```

The build must explicitly use FATHERS_DEPLOY_CONFIG for staging/production. Without it, Vite uses the checked-in local-only configuration. Deploy the generated `dist/server/wrangler.json`, not the raw TypeScript entry template.

After staging resources, policy and billing are approved:
```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
npx wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY --config wrangler.jsonc
npx wrangler deploy --config dist/server/wrangler.json
```

## Required live checks

- Anonymous production gallery works; private APIs reject forged Sites headers and missing/foreign Access tokens.
- Owner login, callback cookie, state consumption and Google consent work across the exact selected hostname.
- Pick real family photos; interrupt a download and resume; import more than 200 photos and review subsequent pages.
- Keep a photo twice; Skip another; verify approved images anonymously and pending/rejected images from a separate signed-out browser.
- Switch albums during a running import, reload, and resume in the original album. No photos should appear under the wrong dad.
- Verify mobile with real photos and check root homepage and other existing pages before and after route activation.
- Only owner-approved family photos should enter the public gallery. No face-recognition or automatic family filtering is implemented.

## Evidence and limits

Local build, lint, TypeScript, encryption/state tests and SQLite-backed failure tests run without live cloud credentials. Local D1 migrations have been applied using Wrangler. Local browser checks cover public loading, navigation and mobile width. They do not replace Access, Google OAuth or real-photo staging checks.

## References

- [Cloudflare Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare R2 Worker API and metadata](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Google Picker media selection and retrieval](https://developers.google.com/photos/picker/guides/media-items)
