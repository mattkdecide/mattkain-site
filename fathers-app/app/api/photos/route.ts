import { env } from "cloudflare:workers";
import { isSameOriginWrite, privateJson, verifyAccessOwner } from "@/lib/security";
import { isDad } from "@/lib/dads";
import { appPath } from "@/lib/paths";

export async function GET(request: Request) {
  const dad = new URL(request.url).searchParams.get("dad") ?? "dad";
  if (!isDad(dad)) return Response.json({ error: "Unknown album" }, { status: 400 });
  try {
    const url = new URL(request.url);
    const source = url.searchParams.get("source") ?? "imports";
    const cursor = url.searchParams.get("cursor") ?? "";
    if (!["imports", "uploads"].includes(source) || cursor.length > 2048) return Response.json({ error: "Invalid page" }, { status: 400 });
    if (source === "imports") {
      const result = await env.DB.prepare("SELECT id, r2_key, caption FROM photo_candidates WHERE dad = ? AND status = 'approved' AND id > ? ORDER BY id LIMIT 201")
        .bind(dad, cursor).all<{ id: string; r2_key: string; caption: string }>();
      const rows = result.results.slice(0, 200);
      return Response.json({
        photos: rows.map((row) => ({ key: row.r2_key, dad, caption: row.caption, url: appPath(`/api/photos/file?key=${encodeURIComponent(row.r2_key)}`) })),
        next: result.results.length > 200 ? { source: "imports", cursor: rows.at(-1)!.id } : { source: "uploads", cursor: "" },
      });
    }
    const options: R2ListOptions & { include: string[] } = { prefix: `${dad}/`, cursor: cursor || undefined, limit: 200, include: ["customMetadata"] };
    const listed = await env.BUCKET.list(options);
    const photos = listed.objects.map((object) => ({ key: object.key, dad, caption: object.customMetadata?.caption ?? "", url: appPath(`/api/photos/file?key=${encodeURIComponent(object.key)}`) }));
    return Response.json({ photos, next: listed.truncated ? { source: "uploads", cursor: listed.cursor } : null });
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
