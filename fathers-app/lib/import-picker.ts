type PickerRow = {
  id: string; google_session_id: string; dad: string; status: string;
  next_page_token: string | null; imported_count: number; expires_at: number;
};
type PickedItem = {
  id: string; createTime?: string; type?: string;
  mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string; mediaFileMetadata?: { width?: number; height?: number } };
};
type Dependencies = {
  DB: D1Database; BUCKET: R2Bucket;
  googleFetch: (path: string, token: string, init?: RequestInit) => Promise<Response>;
  tokenFor: (userId: string) => Promise<string | null>;
  download?: typeof fetch;
};

export class ImportError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export async function importPickerPage(id: string, userId: string, deps: Dependencies) {
  const { DB, BUCKET, googleFetch, tokenFor } = deps;
  const lock = crypto.randomUUID();
  const leaseMs = 120_000;
  const acquired = await DB.prepare(`UPDATE picker_sessions SET lock_token = ?, lock_until = ?
    WHERE id = ? AND user_id = ? AND lock_until < ? RETURNING id`)
    .bind(lock, Date.now() + leaseMs, id, userId, Date.now()).first();
  if (!acquired) {
    const exists = await DB.prepare("SELECT id FROM picker_sessions WHERE id = ? AND user_id = ?").bind(id, userId).first();
    if (!exists) throw new ImportError("Picker session not found", 404);
    return { complete: false, busy: true, pollAfterMs: 3000 };
  }
  async function renew() {
    const row = await DB.prepare("UPDATE picker_sessions SET lock_until = ? WHERE id = ? AND lock_token = ? RETURNING id")
      .bind(Date.now() + leaseMs, id, lock).first();
    if (!row) throw new ImportError("Another import resumed this selection. Retry to continue.", 409);
  }
  try {
    const row = await DB.prepare("SELECT * FROM picker_sessions WHERE id = ? AND user_id = ?").bind(id, userId).first<PickerRow>();
    if (!row) throw new ImportError("Picker session not found", 404);
    if (row.status === "complete") return { complete: true, imported: row.imported_count };
    if (row.expires_at <= Date.now()) throw new ImportError("This selection expired. Start a new selection; already imported photos are kept.", 410);
    const token = await tokenFor(userId);
    if (!token) throw new ImportError("Reconnect Google Photos to continue.", 409);
    if (row.status === "awaiting_selection") {
      const response = await googleFetch(`/sessions/${encodeURIComponent(row.google_session_id)}`, token);
      if (!response.ok) throw new ImportError("Google Photos is unavailable. Retry this selection.");
      const session = await response.json() as { mediaItemsSet?: boolean; pollingConfig?: { pollInterval?: string } };
      if (!session.mediaItemsSet) return {
        complete: false, waiting: true,
        pollAfterMs: Math.min(60_000, Math.max(2000, (Number.parseFloat(session.pollingConfig?.pollInterval ?? "3") || 3) * 1000)),
      };
    }
    const params = new URLSearchParams({ sessionId: row.google_session_id, pageSize: "12" });
    if (row.next_page_token) params.set("pageToken", row.next_page_token);
    const response = await googleFetch(`/mediaItems?${params}`, token);
    if (!response.ok) throw new ImportError("Photo listing failed. Retry this selection.");
    const page = await response.json() as { mediaItems?: PickedItem[]; nextPageToken?: string };
    if (page.mediaItems !== undefined && !Array.isArray(page.mediaItems)) throw new ImportError("Google returned an invalid photo list.");
    for (const item of page.mediaItems ?? []) {
      if (item.type === "VIDEO") continue;
      if (item.type !== "PHOTO" || !item.id || !item.mediaFile?.baseUrl) throw new ImportError("Google returned an incomplete photo. Retry this selection.");
      await renew();
      const existing = await DB.prepare("SELECT id FROM photo_candidates WHERE user_id = ? AND dad = ? AND google_media_id = ?")
        .bind(userId, row.dad, item.id).first();
      if (existing) continue;
      // Stable identity lets a retry reuse an R2 upload after a database failure.
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([userId, row.dad, item.id])));
      const candidateId = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const filename = (item.mediaFile.filename ?? "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "photo.jpg";
      const key = `pending/${row.dad}/${candidateId}`;
      if (!await BUCKET.head(key)) {
        const photo = await (deps.download ?? fetch)(`${item.mediaFile.baseUrl}=d`, {
          headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
        });
        if (!photo.ok || !photo.body) throw new ImportError("A photo could not be downloaded. Retry will keep completed photos.");
        await BUCKET.put(key, photo.body, {
          httpMetadata: { contentType: item.mediaFile.mimeType ?? "image/jpeg" },
        });
      }
      await renew();
      const now = Date.now();
      await DB.batch([
        DB.prepare(`INSERT INTO photo_candidates
          (id, user_id, dad, google_media_id, picker_session_id, r2_key, filename, mime_type, caption, captured_at, width, height, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          ON CONFLICT(user_id, dad, google_media_id) DO NOTHING`)
          .bind(candidateId, userId, row.dad, item.id, id, key, filename, item.mediaFile.mimeType ?? "image/jpeg",
            filename.replace(/\.[^/.]+$/, ""), item.createTime ?? null,
            item.mediaFile.mediaFileMetadata?.width ?? null, item.mediaFile.mediaFileMetadata?.height ?? null, now, now),
        DB.prepare(`UPDATE picker_sessions SET imported_count =
          (SELECT COUNT(*) FROM photo_candidates WHERE picker_session_id = ?), updated_at = ?
          WHERE id = ? AND lock_token = ?`).bind(id, now, id, lock),
      ]);
    }
    await renew();
    const next = page.nextPageToken || null;
    if (next && next === row.next_page_token) throw new ImportError("Google repeated a page. Retry this selection.");
    const completed = await DB.prepare(`UPDATE picker_sessions SET next_page_token = ?, status = ?, updated_at = ?
      WHERE id = ? AND lock_token = ? RETURNING imported_count`)
      .bind(next, next ? "importing" : "complete", Date.now(), id, lock).first<{ imported_count: number }>();
    if (!completed) throw new ImportError("Import was interrupted. Retry to continue.", 409);
    if (!next) {
      // Finalize locally first: remote cleanup must not make a completed import fail.
      try { await googleFetch(`/sessions/${encodeURIComponent(row.google_session_id)}`, token, { method: "DELETE" }); } catch { /* expires remotely */ }
    }
    return { complete: !next, importing: Boolean(next), imported: completed.imported_count, pollAfterMs: 500 };
  } finally {
    await DB.prepare("UPDATE picker_sessions SET lock_token = NULL, lock_until = 0 WHERE id = ? AND lock_token = ?").bind(id, lock).run();
  }
}
