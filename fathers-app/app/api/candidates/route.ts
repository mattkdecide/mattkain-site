import { env } from "cloudflare:workers";
import { isSameOriginWrite, privateJson, verifyAccessOwner } from "@/lib/security";
import { isDad } from "@/lib/dads";
import { appPath } from "@/lib/paths";

type Candidate = {
  id: string; dad: string; r2_key: string; filename: string; caption: string;
  captured_at: string | null; width: number | null; height: number | null; status: string;
};

export async function GET(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return privateJson({ error: "Owner access required" }, { status: 401 });
  const url = new URL(request.url);
  const dad = url.searchParams.get("dad") ?? "";
  const status = url.searchParams.get("status") ?? "pending";
  if (!isDad(dad) || !["pending", "approved", "rejected"].includes(status)) return privateJson({ error: "Invalid filter" }, { status: 400 });
  const cursor = url.searchParams.get("cursor") ?? "";
  if (cursor.length > 200) return privateJson({ error: "Invalid cursor" }, { status: 400 });
  const result = await env.DB.prepare(`SELECT id, dad, r2_key, filename, caption, captured_at, width, height, status
    FROM photo_candidates WHERE user_id = ? AND dad = ? AND status = ? AND id > ? ORDER BY id LIMIT 201`)
    .bind(user.id, dad, status, cursor).all<Candidate>();
  const page = result.results.slice(0, 200);
  const candidates = page.map((item) => ({
    id: item.id, dad: item.dad, filename: item.filename, caption: item.caption,
    capturedAt: item.captured_at, width: item.width, height: item.height, status: item.status,
    url: appPath(`/api/photos/file?key=${encodeURIComponent(item.r2_key)}`),
  }));
  const groups: typeof candidates[] = [];
  for (const candidate of candidates.sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""))) {
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
  return privateJson({ candidates: review, nextCursor: result.results.length > 200 ? page.at(-1)!.id : null });
}

export async function PATCH(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return privateJson({ error: "Owner access required" }, { status: 401 });
  if (!isSameOriginWrite(request)) return privateJson({ error: "Cross-origin request rejected" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: string; action?: string; caption?: string };
  if (!body.id || !["approve", "reject"].includes(body.action ?? "")) return privateJson({ error: "Invalid review action" }, { status: 400 });
  const item = await env.DB.prepare(`SELECT id, dad, r2_key, filename, caption, status FROM photo_candidates
    WHERE id = ? AND user_id = ?`).bind(body.id, user.id).first<Candidate>();
  if (!item) return privateJson({ error: "Photo not found" }, { status: 404 });
  const status = body.action === "approve" ? "approved" : "rejected";
  if (item.status !== "pending" && item.status !== status) return privateJson({ error: "This photo has already been reviewed" }, { status: 409 });
  if (status === "approved" && item.status === "pending" && !await env.BUCKET.head(item.r2_key)) {
    return privateJson({ error: "Photo file is unavailable" }, { status: 410 });
  }
  const caption = String(body.caption ?? item.caption).slice(0, 160);
  // The database alone decides visibility. Approval never moves or deletes the
  // original, so a crash cannot leave a public copy without a committed decision.
  await env.DB.prepare("UPDATE photo_candidates SET status = ?, caption = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'")
    .bind(status, caption, Date.now(), item.id, user.id).run();
  const current = await env.DB.prepare("SELECT status FROM photo_candidates WHERE id = ? AND user_id = ?")
    .bind(item.id, user.id).first<{ status: string }>();
  if (current?.status !== status) return privateJson({ error: "Another review won. Reload the queue." }, { status: 409 });
  // Cleanup is retryable. A rejected row is inaccessible even if R2 is unavailable.
  if (status === "rejected") {
    try { await env.BUCKET.delete(item.r2_key); }
    catch { return privateJson({ status, cleanupPending: true }); }
  }
  return privateJson({ status });
}
