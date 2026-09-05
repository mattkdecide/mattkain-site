import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isDad } from "@/lib/dads";
import { accessToken, decryptToken, googleFetch, loadGoogleAppConfig } from "@/lib/google-photos";

type Connection = { encrypted_refresh_token: string; token_iv: string };
type PickerRow = {
  id: string; google_session_id: string; dad: string; status: string;
  next_page_token: string | null; imported_count: number; expires_at: number;
};
type PickerSession = {
  id: string; pickerUri?: string; mediaItemsSet?: boolean; expireTime?: string;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
};
type PickedItem = {
  id: string; createTime?: string; type?: string;
  mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string; mediaFileMetadata?: { width?: number; height?: number } };
};

async function tokenFor(userId: string) {
  const row = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_connections WHERE user_id = ?")
    .bind(userId).first<Connection>();
  if (!row) return null;
  const config = await loadGoogleAppConfig(userId);
  if (!config) return null;
  return accessToken(await decryptToken(row.encrypted_refresh_token, row.token_iv), config);
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "photo.jpg";
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { dad?: string };
  if (!body.dad || !isDad(body.dad)) return Response.json({ error: "Unknown album" }, { status: 400 });

  try {
    const token = await tokenFor(user.id);
    if (!token) return Response.json({ error: "Connect Google Photos first" }, { status: 409 });
    const response = await googleFetch("/sessions", token, { method: "POST", body: "{}" });
    if (!response.ok) throw new Error(`Picker session creation failed (${response.status})`);
    const session = await response.json() as PickerSession;
    if (!session.id || !session.pickerUri) throw new Error("Google returned an incomplete picker session");
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = session.expireTime ? Date.parse(session.expireTime) : now + 60 * 60 * 1000;
    await env.DB.prepare(`INSERT INTO picker_sessions
      (id, google_session_id, user_id, dad, status, next_page_token, imported_count, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'awaiting_selection', NULL, 0, ?, ?, ?)`)
      .bind(id, session.id, user.id, body.dad, expiresAt, now, now).run();
    return Response.json({ id, pickerUri: session.pickerUri });
  } catch (error) {
    console.error("Unable to create picker session", error);
    return Response.json({ error: "Google Photos could not be opened" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing picker session" }, { status: 400 });

  try {
    let row = await env.DB.prepare(`SELECT id, google_session_id, dad, status, next_page_token, imported_count, expires_at
      FROM picker_sessions WHERE id = ? AND user_id = ?`).bind(id, user.id).first<PickerRow>();
    if (!row) return Response.json({ error: "Picker session not found" }, { status: 404 });
    if (row.status === "complete") return Response.json({ complete: true, imported: row.imported_count });
    if (row.expires_at < Date.now()) return Response.json({ error: "This selection has expired. Please start again." }, { status: 410 });

    const token = await tokenFor(user.id);
    if (!token) return Response.json({ error: "Reconnect Google Photos" }, { status: 409 });

    if (row.status === "awaiting_selection") {
      const sessionResponse = await googleFetch(`/sessions/${encodeURIComponent(row.google_session_id)}`, token);
      if (!sessionResponse.ok) throw new Error(`Picker polling failed (${sessionResponse.status})`);
      const session = await sessionResponse.json() as PickerSession;
      if (!session.mediaItemsSet) {
        const interval = Number.parseFloat(session.pollingConfig?.pollInterval ?? "3") || 3;
        return Response.json({ complete: false, waiting: true, pollAfterMs: Math.max(2000, interval * 1000) });
      }
      await env.DB.prepare("UPDATE picker_sessions SET status = 'importing', updated_at = ? WHERE id = ?")
        .bind(Date.now(), row.id).run();
      row = { ...row, status: "importing" };
    }

    const params = new URLSearchParams({ sessionId: row.google_session_id, pageSize: "12" });
    if (row.next_page_token) params.set("pageToken", row.next_page_token);
    const itemsResponse = await googleFetch(`/mediaItems?${params}`, token);
    if (!itemsResponse.ok) throw new Error(`Photo listing failed (${itemsResponse.status})`);
    const page = await itemsResponse.json() as { mediaItems?: PickedItem[]; nextPageToken?: string };
    let added = 0;

    for (const item of page.mediaItems ?? []) {
      if (item.type !== "PHOTO" || !item.mediaFile?.baseUrl) continue;
      const existing = await env.DB.prepare("SELECT id FROM photo_candidates WHERE dad = ? AND google_media_id = ?")
        .bind(row.dad, item.id).first();
      if (existing) continue;
      const filename = safeFilename(item.mediaFile.filename ?? `${item.id}.jpg`);
      const photoResponse = await fetch(`${item.mediaFile.baseUrl}=d`, { headers: { authorization: `Bearer ${token}` } });
      if (!photoResponse.ok || !photoResponse.body) continue;
      const candidateId = crypto.randomUUID();
      const key = `pending/${row.dad}/${candidateId}-${filename}`;
      const now = Date.now();
      await env.BUCKET.put(key, photoResponse.body, {
        httpMetadata: { contentType: item.mediaFile.mimeType ?? "image/jpeg" },
        customMetadata: { caption: filename.replace(/\.[^/.]+$/, "") },
      });
      await env.DB.prepare(`INSERT INTO photo_candidates
        (id, user_id, dad, google_media_id, r2_key, filename, mime_type, caption, captured_at, width, height, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .bind(candidateId, user.id, row.dad, item.id, key, filename, item.mediaFile.mimeType ?? "image/jpeg",
          filename.replace(/\.[^/.]+$/, ""), item.createTime ?? null,
          item.mediaFile.mediaFileMetadata?.width ?? null, item.mediaFile.mediaFileMetadata?.height ?? null, now, now).run();
      added += 1;
    }

    const imported = row.imported_count + added;
    if (page.nextPageToken) {
      await env.DB.prepare("UPDATE picker_sessions SET next_page_token = ?, imported_count = ?, updated_at = ? WHERE id = ?")
        .bind(page.nextPageToken, imported, Date.now(), row.id).run();
      return Response.json({ complete: false, importing: true, imported, pollAfterMs: 250 });
    }

    await googleFetch(`/sessions/${encodeURIComponent(row.google_session_id)}`, token, { method: "DELETE" });
    await env.DB.prepare("UPDATE picker_sessions SET status = 'complete', imported_count = ?, updated_at = ? WHERE id = ?")
      .bind(imported, Date.now(), row.id).run();
    return Response.json({ complete: true, imported });
  } catch (error) {
    console.error("Google Photos import failed", error);
    return Response.json({ error: "The selection could not be imported. Please try again." }, { status: 502 });
  }
}
