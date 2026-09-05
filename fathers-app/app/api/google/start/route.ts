import { env } from "cloudflare:workers";
import { isSameOriginWrite, privateJson, verifyAccessOwner } from "@/lib/security";
import { isDad } from "@/lib/dads";
import { googleAuthorisationUrl, loadGoogleAppConfig } from "@/lib/google-photos";

export async function POST(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return privateJson({ error: "Owner access required" }, { status: 401 });
  if (!isSameOriginWrite(request)) return privateJson({ error: "Cross-origin request rejected" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { dad?: string };
  const dad = body.dad ?? "";
  if (!isDad(dad)) return Response.json({ error: "Unknown album" }, { status: 400 });

  try {
    const config = await loadGoogleAppConfig(user.id);
    if (!config) return Response.json({ error: "Set up Google Photos first" }, { status: 409 });
    const state = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now),
      env.DB.prepare("INSERT INTO oauth_states (state, user_id, user_email, dad, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(state, user.id, user.email, dad, now + 10 * 60 * 1000),
    ]);
    return privateJson({ url: googleAuthorisationUrl(state, config) });
  } catch (error) {
    console.error("Unable to start Google connection", error);
    return Response.json({ error: "Google Photos connection is not configured yet" }, { status: 503 });
  }
}
