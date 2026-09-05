import { env } from "cloudflare:workers";
import { verifyAccessOwner } from "@/lib/security";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  const legacy = /^(dad|father-in-law|me|brother-in-law|cam|mark|tim)\//.test(key ?? "");
  const imported = /^pending\/(dad|father-in-law|me|brother-in-law|cam|mark|tim)\//.test(key ?? "");
  const missing = () => new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  if (!key || (!legacy && !imported)) return missing();
  let isPublic = legacy;
  if (imported) {
    const candidate = await env.DB.prepare("SELECT user_id, status FROM photo_candidates WHERE r2_key = ?")
      .bind(key).first<{ user_id: string; status: string }>();
    if (!candidate || candidate.status === "rejected") return missing();
    isPublic = candidate.status === "approved";
    if (!isPublic) {
      const owner = await verifyAccessOwner(request, env);
      if (!owner || candidate.status !== "pending" || candidate.user_id !== owner.id) return missing();
    }
  }
  const object = await env.BUCKET.get(key);
  if (!object) return missing();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox");
  headers.set("cache-control", isPublic ? "public, max-age=3600" : "private, no-store");
  return new Response(object.body, { headers });
}
