import { env } from "cloudflare:workers";
import { privateJson, verifyAccessOwner } from "@/lib/security";
import { loadGoogleAppConfig } from "@/lib/google-photos";

export async function GET(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return privateJson({ error: "Owner access required" }, { status: 401 });
  const connection = await env.DB.prepare("SELECT updated_at FROM google_connections WHERE user_id = ?")
    .bind(user.id).first<{ updated_at: number }>();
  const configured = Boolean(await loadGoogleAppConfig(user.id));
  return privateJson({ connected: Boolean(connection), configured, updatedAt: connection?.updated_at ?? null });
}
