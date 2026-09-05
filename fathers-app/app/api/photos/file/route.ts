import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  const approved = /^(dad|father-in-law|me|brother-in-law|cam|mark|tim)\//.test(key ?? "");
  const pending = /^pending\/(dad|father-in-law|me|brother-in-law|cam|mark|tim)\//.test(key ?? "");
  if (!key || (!approved && !pending)) return new Response("Not found", { status: 404 });
  if (pending && !(await getChatGPTUser())) return new Response("Sign in required", { status: 401 });
  const object = await env.BUCKET.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
