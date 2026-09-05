import { env } from "cloudflare:workers";
import { isSameOriginWrite, privateJson, verifyAccessOwner } from "@/lib/security";
import { isDad } from "@/lib/dads";

export async function GET(request: Request) {
  const dad = new URL(request.url).searchParams.get("dad") ?? "dad";
  if (!isDad(dad)) return Response.json({ error: "Unknown album" }, { status: 400 });
  try {
    const listed = await env.BUCKET.list({ prefix: `${dad}/` });
    const photos = listed.objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime()).map((object) => ({ key: object.key, dad, caption: object.customMetadata?.caption ?? "", url: `/api/photos/file?key=${encodeURIComponent(object.key)}` }));
    return Response.json({ photos });
  } catch { return Response.json({ photos: [], error: "Photos are temporarily unavailable" }, { status: 503 }); }
}

export async function POST(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return privateJson({ error: "Owner access required" }, { status: 401 });
  if (!isSameOriginWrite(request)) return privateJson({ error: "Cross-origin request rejected" }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("photo");
    const dad = String(form.get("dad") ?? "");
    const caption = String(form.get("caption") ?? "").slice(0, 160);
    if (!(file instanceof File) || !isDad(dad)) return privateJson({ error: "A valid photo and album are required" }, { status: 400 });
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) return privateJson({ error: "Use an image smaller than 20 MB" }, { status: 400 });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);
    const key = `${dad}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { caption } });
    return privateJson({ key }, { status: 201 });
  } catch { return privateJson({ error: "That photo could not be added. Please try again." }, { status: 500 }); }
}
