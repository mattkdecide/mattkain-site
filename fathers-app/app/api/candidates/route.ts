import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isDad } from "@/lib/dads";

type Candidate = {
  id: string; dad: string; r2_key: string; filename: string; caption: string;
  captured_at: string | null; width: number | null; height: number | null; status: string;
};

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const url = new URL(request.url);
  const dad = url.searchParams.get("dad") ?? "";
  const status = url.searchParams.get("status") ?? "pending";
  if (!isDad(dad) || !["pending", "approved", "rejected"].includes(status)) return Response.json({ error: "Invalid filter" }, { status: 400 });
  const result = await env.DB.prepare(`SELECT id, dad, r2_key, filename, caption, captured_at, width, height, status
    FROM photo_candidates WHERE user_id = ? AND dad = ? AND status = ? ORDER BY captured_at DESC, created_at DESC LIMIT 200`)
    .bind(user.id, dad, status).all<Candidate>();
  const candidates = result.results.map((item) => ({
    id: item.id, dad: item.dad, filename: item.filename, caption: item.caption,
    capturedAt: item.captured_at, width: item.width, height: item.height, status: item.status,
    url: `/api/photos/file?key=${encodeURIComponent(item.r2_key)}`,
  }));
  const groups: typeof candidates[] = [];
  for (const candidate of candidates) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    const currentTime = candidate.capturedAt ? Date.parse(candidate.capturedAt) : NaN;
    const previousTime = previous?.capturedAt ? Date.parse(previous.capturedAt) : NaN;
    if (last && Number.isFinite(currentTime) && Number.isFinite(previousTime) && Math.abs(currentTime - previousTime) <= 3000) last.push(candidate);
    else groups.push([candidate]);
  }
  const review = groups.flatMap((group) => {
    const best = group.reduce((winner, candidate) => ((candidate.width ?? 0) * (candidate.height ?? 0) > (winner.width ?? 0) * (winner.height ?? 0) ? candidate : winner), group[0]);
    return group.map((candidate) => ({ ...candidate, similarShot: group.length > 1, suggestedBest: group.length > 1 && candidate.id === best.id }));
  });
  return Response.json({ candidates: review });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { id?: string; action?: string; caption?: string };
  if (!body.id || !["approve", "reject"].includes(body.action ?? "")) return Response.json({ error: "Invalid review action" }, { status: 400 });
  const item = await env.DB.prepare(`SELECT id, dad, r2_key, filename, caption FROM photo_candidates
    WHERE id = ? AND user_id = ? AND status = 'pending'`).bind(body.id, user.id).first<Candidate>();
  if (!item) return Response.json({ error: "Photo not found" }, { status: 404 });

  if (body.action === "reject") {
    await env.BUCKET.delete(item.r2_key);
    await env.DB.prepare("UPDATE photo_candidates SET status = 'rejected', updated_at = ? WHERE id = ?")
      .bind(Date.now(), item.id).run();
    return Response.json({ status: "rejected" });
  }

  const object = await env.BUCKET.get(item.r2_key);
  if (!object) return Response.json({ error: "Photo file is unavailable" }, { status: 410 });
  const caption = String(body.caption ?? item.caption).slice(0, 160);
  const approvedKey = `${item.dad}/${Date.now()}-${crypto.randomUUID()}-${item.filename}`;
  await env.BUCKET.put(approvedKey, object.body, { httpMetadata: object.httpMetadata, customMetadata: { caption } });
  await env.BUCKET.delete(item.r2_key);
  await env.DB.prepare("UPDATE photo_candidates SET status = 'approved', r2_key = ?, caption = ?, updated_at = ? WHERE id = ?")
    .bind(approvedKey, caption, Date.now(), item.id).run();
  return Response.json({ status: "approved" });
}
