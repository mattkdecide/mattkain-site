import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isDad } from "@/lib/dads";
import { googleAuthorisationUrl, loadGoogleAppConfig } from "@/lib/google-photos";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const dad = new URL(request.url).searchParams.get("dad") ?? "";
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
    return Response.redirect(googleAuthorisationUrl(state, config), 302);
  } catch (error) {
    console.error("Unable to start Google connection", error);
    return Response.json({ error: "Google Photos connection is not configured yet" }, { status: 503 });
  }
}
