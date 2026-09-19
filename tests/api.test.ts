import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../apps/api/src/platform";
import { type Report } from "../packages/contracts/src/index";

const platform = createPlatform({ phaseMs: 10 });
const server = platform.app.listen(0, "127.0.0.1");
let base: string;
let cookie: string;
before(async () => {
  if (!server.listening)
    await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cookie = (await fetch(`${base}/v1/session`)).headers
    .get("set-cookie")!
    .split(";")[0];
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  platform.close();
});
const request = (path: string, method = "GET", body?: unknown, headers = {}) =>
  fetch(`${base}/v1${path}`, {
    method,
    headers: { cookie, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
async function newProfile(confirm = true) {
  const response = await request("/store-profiles", "POST", {
    name: "Test Coffee",
    url: "test-coffee.example",
  });
  assert.equal(response.status, 201);
  const profile = await response.json();
  if (confirm)
    assert.equal(
      (
        await request(`/store-profiles/${profile.id}`, "PATCH", {
          audience: "Home brewers",
        })
      ).status,
      200,
    );
  return profile;
}
async function finish(id: string): Promise<Report> {
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 12));
    platform.tick();
    const report = await (await request(`/reports/${id}`)).json();
    if (["completed", "partial", "cancelled"].includes(report.status))
      return report;
  }
  throw new Error("Report did not reach a terminal state");
}

test("each session gets an isolated, explicitly fictional seed with resolvable claim evidence", async () => {
  const reports: Report[] = await (await request("/reports")).json();
  assert.equal(reports.length, 1);
  const report = reports[0];
  assert.equal(report.mode, "demo");
  const known = new Set(report.evidence.map((e) => e.id));
  const claims = [
    ...report.collaborators,
    ...report.competitors,
    ...Object.values(report.swot).flat(),
    ...report.actions,
  ];
  for (const claim of claims) {
    assert.ok(claim.evidenceIds.length);
    claim.evidenceIds.forEach((id) => assert.ok(known.has(id)));
  }
  assert.ok(report.evidence.every((e) => e.synthetic && e.url === null));
  const otherCookie = (await fetch(`${base}/v1/session`)).headers
    .get("set-cookie")!
    .split(";")[0];
  const forbidden = await request(`/reports/${report.id}`, "GET", undefined, {
    cookie: otherCookie,
  });
  assert.equal(forbidden.status, 404);
  assert.equal(
    (
      await request(
        `/store-profiles/${report.profile.id}`,
        "PATCH",
        { name: "Hijack" },
        { cookie: otherCookie },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/reports/${report.id}/events`, "GET", undefined, {
        cookie: otherCookie,
      })
    ).status,
    404,
  );
});
test("unconfirmed profiles cannot start research; corrections produce a new version", async () => {
  const profile = await newProfile(false);
  const response = await request(
    "/reports",
    "POST",
    { profileId: profile.id },
    { "Idempotency-Key": "unconfirmed-profile" },
  );
  assert.equal(response.status, 409);
  const updated = await (
    await request(`/store-profiles/${profile.id}`, "PATCH", {
      category: "Coffee & tea",
    })
  ).json();
  assert.equal(updated.version, 2);
  assert.equal(updated.category, "Coffee & tea");
  assert.equal(updated.confirmed, true);
});
test("idempotency returns the same report, rejects changed inputs, and snapshots the profile", async () => {
  const profile = await newProfile();
  const headers = { "Idempotency-Key": "test-idempotency" };
  const body = { profileId: profile.id };
  const created = await (
    await request("/reports", "POST", body, headers)
  ).json();
  const retry = await (await request("/reports", "POST", body, headers)).json();
  assert.equal(created.id, retry.id);
  assert.equal(
    (
      await request(
        "/reports",
        "POST",
        { ...body, simulatePartial: true },
        headers,
      )
    ).status,
    409,
  );
  await request(`/store-profiles/${profile.id}`, "PATCH", {
    name: "Changed name",
  });
  const complete = await finish(created.id);
  assert.equal(complete.status, "completed");
  assert.equal(complete.profile.name, "Test Coffee");
  assert.equal(complete.collaborators.length, 6);
  assert.equal(complete.competitors.length, 5);
  assert.equal(complete.swot.strengths.length, 3);
});
test("partial failure preserves collaborators and avoids unsupported strategy", async () => {
  const profile = await newProfile();
  const created = await (
    await request(
      "/reports",
      "POST",
      { profileId: profile.id, simulatePartial: true },
      { "Idempotency-Key": "partial-report" },
    )
  ).json();
  const partial = await finish(created.id);
  assert.equal(partial.status, "partial");
  assert.equal(partial.collaborators.length, 6);
  assert.equal(partial.competitors.length, 0);
  assert.equal(partial.swot.strengths.length, 0);
  assert.ok(partial.warning);
});
test("cancellation is terminal and idempotent", async () => {
  const profile = await newProfile();
  const created = await (
    await request(
      "/reports",
      "POST",
      { profileId: profile.id },
      { "Idempotency-Key": "cancel-report" },
    )
  ).json();
  await request(`/reports/${created.id}/cancel`, "POST");
  const cancelled = await finish(created.id);
  assert.equal(cancelled.status, "cancelled");
  const retry = await (
    await request(`/reports/${created.id}/cancel`, "POST")
  ).json();
  assert.equal(retry.updatedAt, cancelled.updatedAt);
});
test("saved brands and feedback survive reload; invalid items are rejected", async () => {
  assert.equal((await request("/saved/form", "PUT")).status, 200);
  assert.ok((await (await request("/saved")).json()).includes("form"));
  assert.equal(
    (await request("/report-items/form/feedback", "POST", { rating: "useful" }))
      .status,
    200,
  );
  assert.equal((await (await request("/feedback")).json()).form, "useful");
  assert.equal((await request("/saved/unknown-brand", "PUT")).status, 404);
  assert.equal(
    (await request("/report-items/form/feedback", "POST", { rating: "bogus" }))
      .status,
    400,
  );
  await request("/saved/form", "DELETE");
  assert.ok(!(await (await request("/saved")).json()).includes("form"));
});
test("public URL validation and same-origin mutations reject invalid requests", async () => {
  for (const url of [
    "http://localhost/",
    "http://127.0.0.1",
    "http://192.168.1.1",
    "http://user:pass@example.com",
    "http://[::1]",
  ])
    assert.equal(
      (await request("/store-profiles", "POST", { name: "Bad URL", url }))
        .status,
      400,
      url,
    );
  assert.equal(
    (
      await request(
        "/store-profiles",
        "POST",
        { name: "X", url: "https://example.com" },
        { origin: "https://unrelated.example" },
      )
    ).status,
    403,
  );
  const malformed = await fetch(`${base}/v1/store-profiles`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});
test("SSE resolves a completed report and closes the stream", async () => {
  const reports: Report[] = await (await request("/reports")).json();
  const report = reports.find((r) => r.status === "completed")!;
  const response = await request(`/reports/${report.id}/events`);
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  const body = await response.text();
  assert.match(body, /data: /);
  assert.equal(JSON.parse(body.slice(6).trim()).id, report.id);
});
test("persisted queued work resumes after a process restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "grove-test-"));
  const path = join(directory, "test.sqlite");
  let first = createPlatform({ databasePath: path, phaseMs: 10000 });
  const fixture = (await (await request("/reports")).json()).find(
    (r: Report) => r.status === "completed",
  );
  fixture.status = "queued";
  fixture.phase = "queued";
  fixture.updatedAt = "2020-01-01T00:00:00.000Z";
  first.db
    .prepare("INSERT INTO reports (id,workspace_id,payload) VALUES (?,?,?)")
    .run(
      "restart-test",
      "workspace",
      JSON.stringify({ ...fixture, id: "restart-test" }),
    );
  first.close();
  const second = createPlatform({ databasePath: path, phaseMs: 1 });
  try {
    second.tick();
    const row = second.db
      .prepare("SELECT payload FROM reports WHERE id=?")
      .get("restart-test") as { payload: string };
    assert.equal(JSON.parse(row.payload).status, "profiling");
  } finally {
    second.close();
    rmSync(directory, { recursive: true });
  }
});
