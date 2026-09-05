import assert from "node:assert/strict";
import { test } from "node:test";
import { database, bucket, routeFixtures } from "./fixtures.mjs";
const DB = database(), BUCKET = bucket();
const hooks = routeFixtures({ DB, BUCKET }, { id: "owner", email: "owner@example.com" });
const review = await import("../app/api/candidates/route.ts");
const files = await import("../app/api/photos/file/route.ts");
const gallery = await import("../app/api/photos/route.ts");
hooks.deregister();

function candidate(id) {
  DB.sql.prepare("INSERT INTO photo_candidates(id,user_id,dad,google_media_id,r2_key,filename,mime_type,created_at,updated_at) VALUES (?,'owner','dad',?,?,?,'image/jpeg',0,0)")
    .run(id, id, "pending/dad/" + id, id + ".jpg");
  BUCKET.objects.set("pending/dad/" + id, new Uint8Array([1,2,3]));
}
const action = (id, action) => review.PATCH(new Request("https://family.example/fathers/api/candidates", {
  method: "PATCH", headers: { origin: "https://family.example" }, body: JSON.stringify({ id, action }),
}));
const photo = (id) => files.GET(new Request("https://family.example/fathers/api/photos/file?key=pending/dad/" + id));

test("approval is idempotent and does not copy/delete the original", async () => {
  candidate("approve");
  assert.equal((await action("approve", "approve")).status, 200);
  assert.equal((await action("approve", "approve")).status, 200);
  assert.equal(BUCKET.puts, 0);
  assert.equal(BUCKET.objects.has("pending/dad/approve"), true);
  globalThis.fathersFixture.owner = null;
  assert.equal((await photo("approve")).headers.get("cache-control"), "public, max-age=3600");
  globalThis.fathersFixture.owner = { id: "owner" };
});

test("failed database decision leaves the original pending and private", async () => {
  candidate("db-failure");
  DB.fail = (query) => query.startsWith("UPDATE photo_candidates");
  await assert.rejects(action("db-failure", "approve"), /Injected/);
  DB.fail = null;
  globalThis.fathersFixture.owner = null;
  assert.equal((await photo("db-failure")).status, 404);
  globalThis.fathersFixture.owner = { id: "owner" };
  assert.equal((await action("db-failure", "approve")).status, 200);
});

test("rejected originals stay inaccessible during cleanup failure; retry cleans up", async () => {
  candidate("reject");
  BUCKET.failDelete = true;
  assert.equal((await (await action("reject", "reject")).json()).cleanupPending, true);
  assert.equal((await photo("reject")).status, 404);
  BUCKET.failDelete = false;
  assert.equal((await action("reject", "reject")).status, 200);
  assert.equal(BUCKET.objects.has("pending/dad/reject"), false);
  assert.equal((await action("reject", "approve")).status, 409);
});

test("concurrent opposite decisions have one winner", async () => {
  candidate("race");
  const responses = await Promise.all([action("race", "approve"), action("race", "reject")]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
});

test("keyset pagination remains complete when earlier candidates are reviewed", async () => {
  for (let i=0; i<205; i++) candidate("queue-" + i.toString().padStart(3, "0"));
  const first = await (await review.GET(new Request("https://family.example/fathers/api/candidates?dad=dad"))).json();
  assert.equal(first.candidates.length, 200);
  assert.ok(first.nextCursor);
  await action(first.candidates[0].id, "reject");
  const second = await (await review.GET(new Request("https://family.example/fathers/api/candidates?dad=dad&cursor=" + first.nextCursor))).json();
  const ids = new Set([...first.candidates, ...second.candidates].map((c) => c.id));
  for (let i=0; i<205; i++) assert.ok(ids.has("queue-" + i.toString().padStart(3, "0")));
  assert.equal(second.nextCursor, null);
  const publicPage = await (await gallery.GET(new Request("https://family.example/fathers/api/photos?dad=dad"))).json();
  assert.ok(publicPage.photos.every((photo) => photo.url.startsWith("/fathers/api/photos/file?")));
  assert.ok(!publicPage.photos.some((photo) => photo.key.includes("queue-")));
});
