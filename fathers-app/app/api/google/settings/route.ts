import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { encryptToken } from "@/lib/google-photos";

type RuntimeEnv = { GOOGLE_REDIRECT_URI?: string };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const saved = await env.DB.prepare("SELECT client_id, updated_at FROM google_app_settings WHERE user_id = ?")
    .bind(user.id).first<{ client_id: string; updated_at: number }>();
  const redirectUri = (env as unknown as RuntimeEnv).GOOGLE_REDIRECT_URI ?? "";
  return Response.json({ configured: Boolean(saved), clientId: saved?.client_id ?? "", redirectUri, updatedAt: saved?.updated_at ?? null });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { clientId?: string; clientSecret?: string };
  const clientId = String(body.clientId ?? "").trim();
  const clientSecret = String(body.clientSecret ?? "").trim();
  if (!clientId.endsWith(".apps.googleusercontent.com") || clientSecret.length < 8) {
    return Response.json({ error: "Enter the Web application client ID and client secret from Google Cloud" }, { status: 400 });
  }
  try {
    const encrypted = await encryptToken(clientSecret);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO google_app_settings
        (user_id, client_id, encrypted_client_secret, secret_iv, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET client_id = excluded.client_id,
          encrypted_client_secret = excluded.encrypted_client_secret,
          secret_iv = excluded.secret_iv, updated_at = excluded.updated_at`)
        .bind(user.id, clientId, encrypted.encrypted, encrypted.iv, now, now),
      env.DB.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(user.id),
    ]);
    return Response.json({ configured: true, clientId });
  } catch (error) {
    console.error("Unable to save Google Photos settings", error);
    return Response.json({ error: "The Google settings could not be saved" }, { status: 500 });
  }
}
