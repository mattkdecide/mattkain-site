# Fathers project: Codex handover

## Start here

Continue the seven-dad family photo tribute towards mattkain.com/fathers. Preserve the existing root homepage, CNAME, and other site folders. The imported application is under fathers-app; it is NOT a static GitHub Pages application. Do not merge or deploy automatically.

## Imported state

Source: Sites version 4, commit 81d3151da291b21f2ae805fabd5bfdaf5b3d473b. The build passed, but Google OAuth and imports have not been tested end to end. The saved version was not deployed. The original private Sites project is retained; this transfer does not move its database, photos, secrets, or access policy.

The Sites identity manifest is intentionally excluded to avoid coupling this checkout to the original deployment. Existing build scripts still depend on Sites infrastructure and need review before independent hosting. Keep the lockfile and app source as the migration baseline.

## Product requirements

Seven albums: John, Ron, Matt, Ed, Cam, Mark, and Tim. Preserve internal IDs father-in-law, dad, me, brother-in-law, cam, mark, and tim respectively. Each album requires that dad's inclusion. Other people must belong to the user-approved extended family; combinations are allowed. Prefer family photos, and select stronger images from near-duplicate bursts. Ask the owner for any private family mapping needed; it is deliberately not included in this public repository.

Desktop: subtle, high-end, modern design. Mobile: stripped back. Later scope includes individual slideshows and optional user-controlled music, off by default.

## What exists

- Gallery and manual R2 uploads.
- Google OAuth, AES-GCM encrypted token storage, and Picker sessions.
- Encrypted OAuth-client setup form.
- D1 candidate queue, Keep/Skip decisions, and approved R2 objects.
- Timestamp-based grouping within three seconds, with resolution ranking only. This is NOT visual similarity, sharpness, expression, identity, or best-photo analysis.

Google Picker requires explicit user selection. It does not expose Google Photos face labels or provide automatic live-album synchronisation. Existing Google face albums are an upstream selection aid, not a guarantee of correct identity or exclusion of strangers. Do not claim automatic family-rule enforcement.

## Hosting and security work before deployment

1. Choose a supported private backend for OAuth, D1/SQLite metadata, and object storage. GitHub Pages can serve the public gallery only. Keep secrets and private review out of public static output.
2. Replace or deliberately preserve Cloudflare Workers bindings and Sites-specific auth/build helpers. The app uses cloudflare:workers and trusted oai-authenticated-user headers. These headers are only trustworthy behind the Sites dispatcher. Independent hosting MUST establish real authentication and explicit owner authorisation; never trust client-supplied headers.
3. Add owner checks on every admin endpoint, origin/CSRF checks for writes, private no-store responses for settings, and ownership checks when serving pending images. Current code largely checks sign-in, not explicit owner status; it relied on the original owner-only Site access policy.
4. Review import concurrency, retry behaviour, recoverability, pagination beyond 200 candidates, download failures, and idempotent approval. Skip currently deletes the pending stored copy, not the Google original.
5. Provide credential replacement/recovery UI, clear callback errors, and album-safe polling when tabs change. Do not call the feature complete based on compilation alone.
6. Add focused tests for unauthorised access, encryption, OAuth state validation, import retries, review transitions, and mobile layout before publishing.

## Credentials and state

No credentials or photo assets are included. Original Sites runtime has GOOGLE_REDIRECT_URI and GOOGLE_TOKEN_ENCRYPTION_KEY. They do not transfer with source. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET still need creation, or entry through the private setup form. A new host needs a new exact callback URL registered with Google and its own securely managed encryption key. Do not rotate an encryption key over existing encrypted records without a migration.

Original callback: https://four-dads-fathers-day.mattkdecide.chatgpt.site/api/google/callback

Google Cloud was unavailable in the shared browser. The owner will need to complete Google Cloud setup separately. Never request secrets in chat or commit them. Keep the existing Sites deployment unchanged until a replacement is verified.

## Suggested first Codex task

Read this handover and inspect fathers-app. Plan and implement a portable, secure private-admin/public-gallery architecture for mattkain.com/fathers without changing the homepage. Start by addressing the explicit security and runtime dependencies above. Preserve all existing content, do not publish without approval, and report any required hosting choice before provisioning paid services.
