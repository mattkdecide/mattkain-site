import { env } from "cloudflare:workers";

type RuntimeEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_TOKEN_ENCRYPTION_KEY?: string;
};

const runtime = env as unknown as RuntimeEnv;

export type GoogleAppConfig = { clientId: string; clientSecret: string; redirectUri: string };

function requireSetting(name: keyof RuntimeEnv): string {
  const value = runtime[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

async function encryptionKey() {
  const raw = base64ToBytes(requireSetting("GOOGLE_TOKEN_ENCRYPTION_KEY"));
  if (raw.byteLength !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(token));
  return { encrypted: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptToken(encrypted: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await encryptionKey(), base64ToBytes(encrypted));
  return new TextDecoder().decode(decrypted);
}

export async function loadGoogleAppConfig(userId: string): Promise<GoogleAppConfig | null> {
  const redirectUri = runtime.GOOGLE_REDIRECT_URI;
  if (!redirectUri) return null;
  const saved = await env.DB.prepare(`SELECT client_id, encrypted_client_secret, secret_iv
    FROM google_app_settings WHERE user_id = ?`).bind(userId).first<{
      client_id: string; encrypted_client_secret: string; secret_iv: string;
    }>();
  if (saved) return {
    clientId: saved.client_id,
    clientSecret: await decryptToken(saved.encrypted_client_secret, saved.secret_iv),
    redirectUri,
  };
  if (runtime.GOOGLE_CLIENT_ID && runtime.GOOGLE_CLIENT_SECRET) return {
    clientId: runtime.GOOGLE_CLIENT_ID,
    clientSecret: runtime.GOOGLE_CLIENT_SECRET,
    redirectUri,
  };
  return null;
}

export function googleAuthorisationUrl(state: string, config: GoogleAppConfig) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, config: GoogleAppConfig) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  return response.json() as Promise<{ refresh_token?: string }>;
}

export async function accessToken(refreshToken: string, config: GoogleAppConfig) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Google did not return an access token");
  return data.access_token;
}

export async function googleFetch(path: string, token: string, init?: RequestInit) {
  return fetch(`https://photospicker.googleapis.com/v1${path}`, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
}
