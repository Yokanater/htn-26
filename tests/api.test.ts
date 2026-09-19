import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPlatform,
  LIVE_RESEARCH_LIMIT_MS,
  runWithResearchDeadline,
} from "../apps/api/src/platform";
import { type Report } from "../packages/contracts/src/index";
import { demoProfile, fixtureReport } from "../packages/contracts/src/fixtures";
import { assertPublicUrl } from "../apps/api/src/url-safety";
import {
  buildEvidenceLedStrategy,
  hasStorefrontCommerceEvidence,
  isCompatibleCandidate,
  isValidFootwearCollaborator,
  marketSegment,
} from "../apps/api/src/market-research";

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
test("network URL validation rejects literal private and reserved addresses", async () => {
  for (const url of [
    "http://10.0.0.1",
    "http://100.64.0.1",
    "http://169.254.169.254",
    "http://172.31.0.1",
    "http://192.168.0.1",
    "http://224.0.0.1",
  ])
    await assert.rejects(() => assertPublicUrl(url));
});
test("browserbase mode stores profiler suggestions and provenance", async () => {
  const live = createPlatform({
    providerMode: "browserbase",
    profiler: async (input) => ({
      ...input,
      name: "Extracted Store",
      category: "Outdoor footwear",
      research: {
        sessionId: "session-test",
        shopifyConfidence: 85,
        shopifySignals: ["Shopify browser runtime or CDN assets"],
        pagesVisited: 2,
        products: ["Trail Runner"],
        sources: [
          {
            url: input.url,
            title: "Extracted Store",
            span: "Outdoor shoes for everyday adventures.",
            sourceType: "storefront",
            fetchedAt: "2026-09-19T00:00:00.000Z",
            contentHash: "abc123",
          },
        ],
      },
    }),
  });
  const liveServer = live.app.listen(0, "127.0.0.1");
  try {
    if (!liveServer.listening)
      await new Promise<void>((resolve) =>
        liveServer.once("listening", resolve),
      );
    const liveBase = `http://127.0.0.1:${(liveServer.address() as { port: number }).port}`;
    const response = await fetch(`${liveBase}/v1/store-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Submitted Store",
        url: "https://example.com",
      }),
    });
    assert.equal(response.status, 201);
    const profile = await response.json();
    assert.equal(profile.mode, "browserbase");
    assert.equal(profile.name, "Extracted Store");
    assert.equal(profile.research.sessionId, "session-test");
    assert.equal(profile.research.sources.length, 1);
  } finally {
    await new Promise<void>((resolve) => liveServer.close(() => resolve()));
    live.close();
  }
});
test("a footwear profile never receives the coffee fixture", () => {
  const report = fixtureReport({
    ...demoProfile,
    mode: "browserbase",
    name: "Allbirds",
    category: "Footwear & apparel",
    audience: "People looking for comfortable natural-material shoes",
  });
  const rendered = JSON.stringify(report).toLowerCase();
  assert.equal(report.collaborators.length, 6);
  assert.equal(report.competitors.length, 5);
  assert.match(rendered, /footwear|shoe/);
  assert.doesNotMatch(
    rendered,
    /home brewer|coffee subscription|specialty coffee/,
  );
});
test("editorial brand lists cannot pass as candidate storefronts", () => {
  assert.equal(
    hasStorefrontCommerceEvidence({
      title: "100+ Clothing Brands Worth Your Money",
      description: "Our master list of leading American clothing brands.",
      productLinks: 0,
      productSchema: false,
      addToCart: false,
    }),
    false,
  );
  assert.equal(
    hasStorefrontCommerceEvidence({
      title: "Independent Clothing Brand",
      description: "Vintage-inspired dresses made in small batches.",
      productLinks: 8,
      productSchema: true,
      addToCart: true,
    }),
    true,
  );
});
test("footwear collaborators exclude other footwear assortments", () => {
  assert.equal(
    isValidFootwearCollaborator(
      "Shop our women's leather shoes, boots, sandals, and new arrivals.",
    ),
    false,
  );
  assert.equal(
    isValidFootwearCollaborator(
      "Independent sneaker brand designing responsible footwear.",
    ),
    false,
  );
  assert.equal(
    isValidFootwearCollaborator(
      "Plant-based shoe care, cleaning kits, laces, and protective insoles.",
    ),
    true,
  );
  assert.equal(
    isValidFootwearCollaborator("Recycled bags for commuting and travel."),
    true,
  );
});
test("activewear discovery rejects random lifestyle brands and duplicate apparel", () => {
  const profile = {
    ...demoProfile,
    name: "Gymshark",
    category: "Apparel",
    audience: "People who train in the gym",
    research: {
      sessionId: "activewear-profile",
      shopifyConfidence: 80,
      shopifySignals: ["Shopify runtime"],
      pagesVisited: 2,
      products: ["Training Leggings", "Sports Bra"],
      sources: [],
    },
  };
  assert.equal(marketSegment(profile), "activewear");
  assert.equal(
    isCompatibleCandidate(
      profile,
      "Hand-poured soy candles and home fragrance diffusers",
      "collaborator",
    ),
    false,
  );
  assert.equal(
    isCompatibleCandidate(
      profile,
      "Women's leggings and performance gymwear for every workout",
      "collaborator",
    ),
    false,
  );
  assert.equal(
    isCompatibleCandidate(
      profile,
      "Massage devices for workout recovery and mobility",
      "collaborator",
    ),
    true,
  );
  assert.equal(
    isCompatibleCandidate(
      profile,
      "Performance activewear, leggings and sports bras",
      "competitor",
    ),
    true,
  );
});
test("live SWOT contains evidenced observations, gaps, opportunities, and threats", () => {
  const profile = {
    ...demoProfile,
    category: "Activewear & fitness apparel",
    research: {
      sessionId: "strategy-profile",
      shopifyConfidence: 85,
      shopifySignals: ["Product structured data"],
      pagesVisited: 1,
      products: ["Training Leggings"],
      sources: [],
    },
  };
  const evidence = {
    id: "store_live_0",
    title: "Store",
    sourceType: "Live merchant storefront",
    span: "Performance apparel for the conditioning community.",
    publishedAt: "2026-09-19",
    url: "https://example.com",
    synthetic: false,
  };
  const collaborator = {
    ...fixtureReport(profile).collaborators[0],
    id: "recovery",
    name: "Recovery Co",
    category: "Recovery & mobility",
    evidenceIds: ["recovery_source"],
  };
  const competitor = {
    ...fixtureReport(profile).competitors[0],
    id: "active-rival",
    name: "Active Rival",
    evidenceIds: ["rival_source"],
  };
  const strategy = buildEvidenceLedStrategy(
    profile,
    [collaborator],
    [competitor],
    [evidence],
  );
  assert.ok(strategy.swot.strengths.length >= 2);
  assert.ok(strategy.swot.weaknesses.length >= 2);
  assert.equal(strategy.swot.opportunities.length, 1);
  assert.equal(strategy.swot.threats.length, 1);
  for (const item of Object.values(strategy.swot).flat())
    assert.ok(item.evidenceIds.length > 0);
  assert.equal(strategy.actions.length, 3);
});
test("live Browserbase research is capped at five minutes", async () => {
  assert.equal(LIVE_RESEARCH_LIMIT_MS, 300_000);
  let observedAbort = false;
  await assert.rejects(
    () =>
      runWithResearchDeadline(
        (signal) =>
          new Promise<never>((_, reject) =>
            signal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                reject(signal.reason);
              },
              { once: true },
            ),
          ),
        10,
      ),
    /five-minute limit/,
  );
  assert.equal(observedAbort, true);
});
test("browserbase reports use live research instead of fixture progression", async () => {
  const live = createPlatform({
    phaseMs: 5,
    providerMode: "browserbase",
    profiler: async (input) => ({
      ...input,
      name: "Live Shoe Store",
      category: "Footwear & apparel",
      research: {
        sessionId: "profile-session",
        shopifyConfidence: 80,
        shopifySignals: ["Shopify browser runtime or CDN assets"],
        pagesVisited: 1,
        products: ["Leather loafer"],
        sources: [],
      },
    }),
    marketResearch: async (profile) => {
      const fixture = fixtureReport(profile);
      return {
        collaborators: fixture.collaborators.slice(0, 2).map((candidate) => ({
          ...candidate,
          name: `Live ${candidate.name}`,
          domain: `${candidate.id}.com`,
        })),
        competitors: fixture.competitors.slice(0, 2).map((candidate) => ({
          ...candidate,
          name: `Live ${candidate.name}`,
          domain: `${candidate.id}.com`,
        })),
        evidence: fixture.evidence.slice(0, 4).map((evidence) => ({
          ...evidence,
          url: "https://example.com",
          synthetic: false,
        })),
        themes: [],
        swot: fixture.swot,
        actions: [],
        warning: "Captured live.",
      };
    },
  });
  const liveServer = live.app.listen(0, "127.0.0.1");
  try {
    if (!liveServer.listening)
      await new Promise<void>((resolve) =>
        liveServer.once("listening", resolve),
      );
    const liveBase = `http://127.0.0.1:${(liveServer.address() as { port: number }).port}`;
    const sessionResponse = await fetch(`${liveBase}/v1/session`);
    const liveCookie = sessionResponse.headers.get("set-cookie")!.split(";")[0];
    const call = (path: string, method = "GET", body?: unknown, headers = {}) =>
      fetch(`${liveBase}/v1${path}`, {
        method,
        headers: {
          cookie: liveCookie,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const profile = await (
      await call("/store-profiles", "POST", {
        name: "Submitted",
        url: "https://example.com",
      })
    ).json();
    await call(`/store-profiles/${profile.id}`, "PATCH", {});
    const report = await (
      await call(
        "/reports",
        "POST",
        { profileId: profile.id },
        { "Idempotency-Key": "live-market-research" },
      )
    ).json();
    live.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const completed = await (await call(`/reports/${report.id}`)).json();
    assert.equal(completed.status, "completed");
    assert.match(completed.collaborators[0].name, /^Live /);
    assert.ok(
      completed.evidence.every(
        (item: { synthetic: boolean }) => !item.synthetic,
      ),
    );
  } finally {
    await new Promise<void>((resolve) => liveServer.close(() => resolve()));
    live.close();
  }
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
