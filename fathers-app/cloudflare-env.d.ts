interface FathersEnv {
  ASSETS: Fetcher;
  BUCKET: R2Bucket;
  DB: D1Database;
  IMAGES: ImagesBinding;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  OWNER_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_TOKEN_ENCRYPTION_KEY?: string;
}

declare namespace Cloudflare {
  // Cloudflare's module uses this mergeable interface for its env export.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Env extends FathersEnv {}
}
