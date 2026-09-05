import assert from "node:assert/strict";
import { test } from "node:test";
import { importPickerPage } from "../lib/import-picker.ts";
import { database, bucket } from "./fixtures.mjs";

function setup() {
  const DB = database(), BUCKET = bucket();
  DB.sql.prepare("INSERT INTO picker_sessions(id,google_session_id,user_id,dad,status,expires_at,created_at,updated_at) VALUES ('session','google','owner','dad','importing',?,0,0)").run(Date.now() + 60_000);
  const page = { mediaItems: ["a", "b"].map((id) => ({ id, type: "PHOTO", mediaFile: { baseUrl: "https://photos.example/" + id, filename: id + ".jpg" } })) };
  let downloadFails = false, deleteFails = false;
  const deps = {
    DB, BUCKET, tokenFor: async () => "token",
    googleFetch: async (_path, _token, init) => {
      if (init?.method === "DELETE") { if (deleteFails) throw new Error("cleanup failed"); return new Response(null, { status: 204 }); }
      return Response.json(page);
    },
    download: async (url) => downloadFails && url.endsWith("/b=d") ? new Response(null, { status: 503 }) : new Response("photo"),
  };
  return { DB, BUCKET, deps, page, failDownload(value) { downloadFails = value; }, failDelete(value) { deleteFails = value; } };
}

test("failed download preserves page and completed photos; retry has no duplicates", async () => {
  const f = setup(); f.failDownload(true);
  await assert.rejects(importPickerPage("session", "owner", f.deps), /downloaded/);
  assert.equal(f.DB.sql.prepare("SELECT COUNT(*) AS count FROM photo_candidates").get().count, 1);
  assert.equal(f.DB.sql.prepare("SELECT imported_count FROM picker_sessions").get().imported_count, 1);
  assert.equal(f.DB.sql.prepare("SELECT next_page_token FROM picker_sessions").get().next_page_token, null);
  assert.equal(f.DB.sql.prepare("SELECT lock_token FROM picker_sessions").get().lock_token, null);
  f.failDownload(false); f.failDelete(true);
  const result = await importPickerPage("session", "owner", f.deps);
  assert.equal(result.complete, true); assert.equal(result.imported, 2);
  assert.equal(f.BUCKET.puts, 2);
  assert.deepEqual(await importPickerPage("session", "owner", f.deps), { complete: true, imported: 2 });
});

test("database failure after R2 upload reuses the same object on retry", async () => {
  const f = setup();
  f.DB.fail = (query) => query.startsWith("INSERT INTO photo_candidates");
  await assert.rejects(importPickerPage("session", "owner", f.deps), /Injected/);
  assert.equal(f.BUCKET.puts, 1);
  f.DB.fail = null;
  assert.equal((await importPickerPage("session", "owner", f.deps)).imported, 2);
  assert.equal(f.BUCKET.puts, 2);
  assert.equal(f.BUCKET.objects.size, 2);
});

test("concurrent polling does not download a page twice", async () => {
  const f = setup();
  const results = await Promise.all([importPickerPage("session", "owner", f.deps), importPickerPage("session", "owner", f.deps)]);
  assert.equal(results.filter((result) => result.busy).length, 1);
  assert.equal(f.BUCKET.puts, 2);
});

test("expired leases recover; foreign owners and expired sessions are rejected", async () => {
  const f = setup();
  await assert.rejects(importPickerPage("session", "other", f.deps), /not found/);
  f.DB.sql.exec("UPDATE picker_sessions SET lock_token='old',lock_until=1");
  assert.equal((await importPickerPage("session", "owner", f.deps)).complete, true);
  const expired = setup();
  expired.DB.sql.exec("UPDATE picker_sessions SET expires_at=1");
  await assert.rejects(importPickerPage("session", "owner", expired.deps), (error) => error.status === 410);
});

test("page checkpoints advance only after all photos and counts commit", async () => {
  const f = setup(); f.page.nextPageToken = "page-2";
  const first = await importPickerPage("session", "owner", f.deps);
  assert.equal(first.complete, false); assert.equal(first.imported, 2);
  assert.equal(f.DB.sql.prepare("SELECT next_page_token FROM picker_sessions").get().next_page_token, "page-2");
  f.page.mediaItems = [{ id: "c", type: "PHOTO", mediaFile: { baseUrl: "https://photos.example/c" } }];
  delete f.page.nextPageToken;
  assert.equal((await importPickerPage("session", "owner", f.deps)).imported, 3);
});
