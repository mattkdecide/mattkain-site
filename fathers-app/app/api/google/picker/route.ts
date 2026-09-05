import { env } from "cloudflare:workers";
import { isSameOriginWrite, privateJson, verifyAccessOwner } from "@/lib/security";
import { isDad } from "@/lib/dads";
import { accessToken, decryptToken, googleFetch, loadGoogleAppConfig } from "@/lib/google-photos";

import { importPickerPage, ImportError } from "@/lib/import-picker";

type Connection = { encrypted_refresh_token: string; token_iv: string };
type PickerSession = {
  id: string; pickerUri?: string; mediaItemsSet?: boolean; expireTime?: string;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
};

async function tokenFor(userId: string) {
  const row = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_connections WHERE user_id = ?")
    .bind(userId).first<Connection>();
  if (!row) return null;
  const config = await loadGoogleAppConfig(userId);
  if (!config) return null;
  return accessToken(await decryptToken(row.encrypted_refresh_token, row.token_iv), config);
}


export async function POST(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return privateJson({ error: "Owner access required" }, { status: 401 });
  if (!isSameOriginWrite(request)) return privateJson({ error: "Cross-origin request rejected" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { dad?: string };
  if (!body.dad || !isDad(body.dad)) return privateJson({ error: "Unknown album" }, { status: 400 });

  try {
    const token = await tokenFor(user.id);
    if (!token) return privateJson({ error: "Connect Google Photos first" }, { status: 409 });
    const response = await googleFetch("/sessions", token, { method: "POST", body: "{}" });
    if (!response.ok) throw new Error(`Picker session creation failed (${response.status})`);
    const session = await response.json() as PickerSession;
    if (!session.id || !session.pickerUri) throw new Error("Google returned an incomplete picker session");
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = session.expireTime ? Date.parse(session.expireTime) : now + 60 * 60 * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("Google returned an expired session");
    await env.DB.prepare(`INSERT INTO picker_sessions
      (id, google_session_id, user_id, dad, status, next_page_token, imported_count, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'awaiting_selection', NULL, 0, ?, ?, ?)`)
      .bind(id, session.id, user.id, body.dad, expiresAt, now, now).run();
    return privateJson({ id, pickerUri: session.pickerUri });
  } catch (error) {
    console.error("Unable to create picker session", error);
    return privateJson({ error: "Google Photos could not be opened" }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const user = await verifyAccessOwner(request, env);
  if (!user) return privateJson({ error: "Owner access required" }, { status: 401 });
  if (!isSameOriginWrite(request)) return privateJson({ error: "Cross-origin request rejected" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: string };
  if (typeof body.id !== "string" || !body.id) return privateJson({ error: "Missing picker session" }, { status: 400 });
  try {
    return privateJson(await importPickerPage(body.id, user.id, { DB: env.DB, BUCKET: env.BUCKET, googleFetch, tokenFor }));
  } catch (error) {
    console.error("Google Photos import failed", error);
    return privateJson({ error: error instanceof ImportError ? error.message : "Import interrupted. Retry this selection; completed photos are kept." },
      { status: error instanceof ImportError ? error.status : 502 });
  }
}
