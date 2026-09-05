import { env } from "cloudflare:workers";
import { verifyAccessOwner } from "@/lib/security";
import { encryptToken, exchangeCode, loadGoogleAppConfig } from "@/lib/google-photos";

type StateRow = { user_id: string; user_email: string; dad: string; expires_at: number };

function home(request: Request, params: Record<string, string>) {
  const url = new URL("/", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return Response.redirect(url, 302);
}

export async function GET(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return home(request, { google: "signin-required" });
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.has("error")) return home(request, { google: "cancelled" });

  try {
    const saved = await env.DB.prepare("SELECT user_id, user_email, dad, expires_at FROM oauth_states WHERE state = ?")
      .bind(state).first<StateRow>();
    if (!saved || saved.expires_at < Date.now() || saved.user_id !== user.id) return home(request, { google: "invalid-state" });

    const config = await loadGoogleAppConfig(user.id);
    if (!config) throw new Error("Google Photos is not configured");
    const tokens = await exchangeCode(code, config);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token");
    const encrypted = await encryptToken(tokens.refresh_token);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO google_connections
        (user_id, user_email, encrypted_refresh_token, token_iv, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET user_email = excluded.user_email,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          token_iv = excluded.token_iv, updated_at = excluded.updated_at`)
        .bind(user.id, saved.user_email, encrypted.encrypted, encrypted.iv, now, now),
      env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state),
    ]);
    return home(request, { google: "connected", dad: saved.dad });
  } catch (error) {
    console.error("Google callback failed", error);
    return home(request, { google: "failed" });
  }
}
