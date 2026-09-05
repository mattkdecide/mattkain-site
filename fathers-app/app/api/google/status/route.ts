import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadGoogleAppConfig } from "@/lib/google-photos";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const connection = await env.DB.prepare("SELECT updated_at FROM google_connections WHERE user_id = ?")
    .bind(user.id).first<{ updated_at: number }>();
  const configured = Boolean(await loadGoogleAppConfig(user.id));
  return Response.json({ connected: Boolean(connection), configured, updatedAt: connection?.updated_at ?? null });
}
