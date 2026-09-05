import { env } from "cloudflare:workers";
import { verifyAccessOwner } from "@/lib/security";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  const approved = /^(dad|father-in-law|me|brother-in-law|cam|mark|tim)\//.test(key ?? "");
  const pending = /^pending\/(dad|father-in-law|me|brother-in-law|cam|mark|tim)\//.test(key ?? "");
  if (!key || (!approved && !pending)) return new Response("Not found", { status: 404 });
  if (pending) {
    const owner = await verifyAccessOwner(request, env);
    if (!owner) return new Response("Owner access required", { status: 401, headers: { "cache-control": "private, no-store" } });
    const candidate = await env.DB.prepare("SELECT id FROM photo_candidates WHERE user_id = ? AND r2_key = ? AND status = 'pending'")
      .bind(owner.id, key).first();
    if (!candidate) return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  const object = await env.BUCKET.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", pending ? "private, no-store" : "public, max-age=3600");
  return new Response(object.body, { headers });
}
