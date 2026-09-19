import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  phases,
  profileInput,
  terminal,
  type Profile,
  type Report,
  type Status,
} from "../../../packages/contracts/src/index";
import {
  demoProfile,
  fixtureReport,
} from "../../../packages/contracts/src/fixtures";
import { profileStorefront } from "./store-profiler";
import { researchMarket } from "./market-research";

export const LIVE_RESEARCH_LIMIT_MS = 5 * 60 * 1000;

export async function runWithResearchDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = LIVE_RESEARCH_LIMIT_MS,
  controller = new AbortController(),
) {
  const deadline = setTimeout(
    () =>
      controller.abort(
        new Error("Browserbase research reached the five-minute limit."),
      ),
    timeoutMs,
  );
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          "abort",
          () =>
            reject(
              controller.signal.reason ??
                new Error(
                  "Browserbase research reached the five-minute limit.",
                ),
            ),
          { once: true },
        ),
      ),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

type Row = {
  id: string;
  workspace_id: string;
  payload: string;
  idempotency_key: string | null;
  request_profile: string | null;
  partial: number;
};
export function createPlatform({
  databasePath = ":memory:",
  phaseMs = 1500,
  providerMode = "demo",
  profiler = profileStorefront,
  marketResearch = researchMarket,
  researchTimeoutMs = LIVE_RESEARCH_LIMIT_MS,
}: {
  databasePath?: string;
  phaseMs?: number;
  providerMode?: "demo" | "browserbase";
  profiler?: typeof profileStorefront;
  marketResearch?: typeof researchMarket;
  researchTimeoutMs?: number;
} = {}) {
  if (databasePath !== ":memory:")
    mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT, request_profile TEXT, partial INTEGER NOT NULL DEFAULT 0, UNIQUE(workspace_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS feedback (workspace_id TEXT NOT NULL, item_id TEXT NOT NULL, rating TEXT NOT NULL, PRIMARY KEY(workspace_id,item_id));
    CREATE TABLE IF NOT EXISTS saves (workspace_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY(workspace_id,item_id));`);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "24kb" }));
  app.use("/v1", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host)
      return res
        .status(403)
        .json({ error: "Use this API from the same origin as the app." });
    const token = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("grove_session="))
      ?.slice(14);
    const session = token
      ? (db
          .prepare("SELECT workspace_id FROM sessions WHERE token=?")
          .get(token) as { workspace_id: string } | undefined)
      : undefined;
    if (session) {
      res.locals.workspaceId = session.workspace_id;
      return next();
    }
    const newToken = randomBytes(32).toString("hex");
    const workspaceId = randomUUID();
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      newToken,
      workspaceId,
      Date.now(),
    );
    res.setHeader(
      "Set-Cookie",
      `grove_session=${newToken}; HttpOnly; SameSite=Strict; Path=/${req.secure ? "; Secure" : ""}`,
    );
    res.locals.workspaceId = workspaceId;
    const profile = { ...demoProfile, id: randomUUID() };
    db.prepare("INSERT INTO profiles VALUES (?,?,?)").run(
      profile.id,
      workspaceId,
      JSON.stringify(profile),
    );
    const report = fixtureReport(profile, randomUUID());
    db.prepare(
      "INSERT INTO reports(id,workspace_id,payload) VALUES (?,?,?)",
    ).run(report.id, workspaceId, JSON.stringify(report));
    next();
  });
  const reportRows = (workspace: string) =>
    db
      .prepare("SELECT * FROM reports WHERE workspace_id=? ORDER BY rowid DESC")
      .all(workspace) as unknown as Row[];
  const getReport = (id: string, workspace: string) =>
    db
      .prepare("SELECT * FROM reports WHERE id=? AND workspace_id=?")
      .get(id, workspace) as Row | undefined;
  const saveReport = (report: Report) =>
    db
      .prepare("UPDATE reports SET payload=? WHERE id=?")
      .run(JSON.stringify(report), report.id);
  const liveJobs = new Map<
    string,
    { promise: Promise<void>; controller: AbortController }
  >();
  // Repair reports created before category-aware fixtures were introduced.
  for (const row of db
    .prepare("SELECT * FROM reports")
    .all() as unknown as Row[]) {
    const report: Report = JSON.parse(row.payload);
    const footwearProfile = /footwear|shoes?|sneakers?/i.test(
      report.profile.category,
    );
    const coffeeResults = [...report.collaborators, ...report.competitors].some(
      (candidate) =>
        /coffee|brewing|tea/i.test(`${candidate.category} ${candidate.reason}`),
    );
    if (footwearProfile && coffeeResults && terminal(report.status)) {
      const repaired = fixtureReport(report.profile, report.id);
      repaired.createdAt = report.createdAt;
      repaired.updatedAt = new Date().toISOString();
      saveReport(repaired);
    }
    if (
      report.profile.mode === "browserbase" &&
      terminal(report.status) &&
      report.evidence.some((evidence) => evidence.synthetic)
    ) {
      report.status = "queued";
      report.phase = "queued";
      report.warning = null;
      report.collaborators = [];
      report.competitors = [];
      report.themes = [];
      report.actions = [];
      report.evidence = [];
      report.swot = {
        strengths: [],
        weaknesses: [],
        opportunities: [],
        threats: [],
      };
      report.updatedAt = new Date(0).toISOString();
      saveReport(report);
    }
    if (
      report.profile.mode === "browserbase" &&
      terminal(report.status) &&
      [...report.collaborators, ...report.competitors].some((candidate) =>
        /all american made|rankred|popular brands|zanniee/i.test(
          candidate.name,
        ),
      )
    ) {
      report.status = "queued";
      report.phase = "queued";
      report.warning =
        "Replacing editorial search results with verified storefronts.";
      report.collaborators = [];
      report.competitors = [];
      report.themes = [];
      report.actions = [];
      report.evidence = [];
      report.swot = {
        strengths: [],
        weaknesses: [],
        opportunities: [],
        threats: [],
      };
      report.updatedAt = new Date(0).toISOString();
      saveReport(report);
    }
    if (
      report.profile.mode === "browserbase" &&
      report.status === "partial" &&
      /429|burst rate limit/i.test(report.warning ?? "")
    ) {
      report.status = "queued";
      report.phase = "queued";
      report.warning =
        "Waiting to retry live research after provider rate limiting.";
      report.updatedAt = new Date(0).toISOString();
      saveReport(report);
    }
  }
  const ownsItem = (workspace: string, id: string) =>
    reportRows(workspace).some((row) => {
      const r: Report = JSON.parse(row.payload);
      return [
        ...r.collaborators,
        ...r.competitors,
        ...Object.values(r.swot).flat(),
      ].some((item) => item.id === id);
    });
  app.get("/v1/session", (_req, res) =>
    res.json({
      mode: providerMode,
      workspace: "Sunday studio",
      schemaVersion: "1.0.0",
    }),
  );
  app.get("/v1/reports", (_req, res) =>
    res.json(
      reportRows(res.locals.workspaceId).map((row) => JSON.parse(row.payload)),
    ),
  );
  app.get("/v1/health", (_req, res) => {
    const reports: Report[] = reportRows(res.locals.workspaceId).map((row) =>
      JSON.parse(row.payload),
    );
    res.json({
      status: "ok",
      providerMode,
      storage: "sqlite",
      running: reports.filter((r) => !terminal(r.status)).length,
      completed: reports.filter((r) => r.status === "completed").length,
      partial: reports.filter((r) => r.status === "partial").length,
    });
  });
  app.post("/v1/store-profiles", async (req, res) => {
    const parsed = profileInput.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: "Enter a store name, valid public store URL, and context.",
      });
    const url = new URL(parsed.data.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      /(^localhost$|\.local$|\.internal$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^0\.|:)/i.test(
        url.hostname,
      )
    )
      return res.status(400).json({
        error: "Enter a public HTTP or HTTPS store URL without credentials.",
      });
    let details = parsed.data;
    if (providerMode === "browserbase") {
      try {
        details = await profiler(parsed.data);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Storefront research failed.";
        return res.status(422).json({ error: message });
      }
    }
    const profile: Profile = {
      ...details,
      id: randomUUID(),
      version: 1,
      confirmed: false,
      mode: providerMode,
    };
    db.prepare("INSERT INTO profiles VALUES (?,?,?)").run(
      profile.id,
      res.locals.workspaceId,
      JSON.stringify(profile),
    );
    res.status(201).json(profile);
  });
  app.get("/v1/store-profiles/:id", (req, res) => {
    const row = db
      .prepare("SELECT payload FROM profiles WHERE id=? AND workspace_id=?")
      .get(req.params.id as string, res.locals.workspaceId) as
      { payload: string } | undefined;
    if (!row)
      return res.status(404).json({ error: "Store profile not found." });
    res.json(JSON.parse(row.payload));
  });
  app.patch("/v1/store-profiles/:id", (req, res) => {
    const row = db
      .prepare("SELECT payload FROM profiles WHERE id=? AND workspace_id=?")
      .get(req.params.id as string, res.locals.workspaceId) as
      { payload: string } | undefined;
    if (!row)
      return res.status(404).json({ error: "Store profile not found." });
    const old: Profile = JSON.parse(row.payload);
    const input = profileInput.safeParse({ ...old, ...req.body, url: old.url });
    if (!input.success)
      return res
        .status(400)
        .json({ error: "Every profile field needs a value." });
    const profile = {
      ...old,
      ...input.data,
      version: old.version + 1,
      confirmed: true,
    };
    db.prepare("UPDATE profiles SET payload=? WHERE id=?").run(
      JSON.stringify(profile),
      profile.id,
    );
    res.json(profile);
  });
  app.post("/v1/reports", (req, res) => {
    const input = z
      .object({
        profileId: z.string(),
        simulatePartial: z.boolean().default(false),
      })
      .safeParse(req.body);
    const key = req.headers["idempotency-key"];
    if (
      !input.success ||
      typeof key !== "string" ||
      key.length < 8 ||
      key.length > 160
    )
      return res.status(400).json({
        error: "Provide profileId and an Idempotency-Key (8–160 characters).",
      });
    const existing = db
      .prepare(
        "SELECT * FROM reports WHERE workspace_id=? AND idempotency_key=?",
      )
      .get(res.locals.workspaceId, key) as Row | undefined;
    if (existing) {
      if (
        existing.request_profile !== input.data.profileId ||
        !!existing.partial !== input.data.simulatePartial
      )
        return res
          .status(409)
          .json({ error: "This key was used for different report inputs." });
      return res.json(JSON.parse(existing.payload));
    }
    const row = db
      .prepare("SELECT payload FROM profiles WHERE id=? AND workspace_id=?")
      .get(input.data.profileId, res.locals.workspaceId) as
      { payload: string } | undefined;
    if (!row)
      return res.status(404).json({ error: "Store profile not found." });
    const profile: Profile = JSON.parse(row.payload);
    if (!profile.confirmed)
      return res
        .status(409)
        .json({ error: "Confirm the store profile before starting a report." });
    const report = fixtureReport(profile, randomUUID());
    report.status = "queued";
    report.phase = "queued";
    report.collaborators = [];
    report.competitors = [];
    report.themes = [];
    report.actions = [];
    report.evidence = [];
    report.swot = {
      strengths: [],
      weaknesses: [],
      opportunities: [],
      threats: [],
    };
    db.prepare("INSERT INTO reports VALUES (?,?,?,?,?,?)").run(
      report.id,
      res.locals.workspaceId,
      JSON.stringify(report),
      key,
      profile.id,
      Number(input.data.simulatePartial),
    );
    res.status(202).json(report);
  });
  app.get("/v1/reports/:id", (req, res) => {
    const row = getReport(req.params.id as string, res.locals.workspaceId);
    if (!row) return res.status(404).json({ error: "Report not found." });
    res.json(JSON.parse(row.payload));
  });
  app.post("/v1/reports/:id/cancel", (req, res) => {
    const row = getReport(req.params.id as string, res.locals.workspaceId);
    if (!row) return res.status(404).json({ error: "Report not found." });
    const report: Report = JSON.parse(row.payload);
    if (!terminal(report.status)) {
      liveJobs
        .get(report.id)
        ?.controller.abort(new Error("Live research was cancelled."));
      report.status = "cancelled";
      report.updatedAt = new Date().toISOString();
      saveReport(report);
    }
    res.json(report);
  });
  app.get("/v1/reports/:id/events", (req, res) => {
    if (!getReport(req.params.id as string, res.locals.workspaceId))
      return res.status(404).json({ error: "Report not found." });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const send = () => {
      const row = getReport(req.params.id as string, res.locals.workspaceId);
      if (!row) {
        res.end();
        return;
      }
      const report: Report = JSON.parse(row.payload);
      res.write(`data: ${JSON.stringify(report)}\n\n`);
      if (terminal(report.status)) res.end();
    };
    const interval = setInterval(send, 500);
    res.on("close", () => clearInterval(interval));
    send();
  });
  app.post("/v1/report-items/:id/feedback", (req, res) => {
    const input = z
      .object({ rating: z.enum(["useful", "not_useful"]) })
      .safeParse(req.body);
    if (!input.success)
      return res.status(400).json({ error: "Choose useful or not_useful." });
    if (!ownsItem(res.locals.workspaceId, req.params.id as string))
      return res.status(404).json({ error: "Report item not found." });
    db.prepare(
      "INSERT INTO feedback VALUES (?,?,?) ON CONFLICT(workspace_id,item_id) DO UPDATE SET rating=excluded.rating",
    ).run(res.locals.workspaceId, req.params.id as string, input.data.rating);
    res.json({ rating: input.data.rating });
  });
  app.get("/v1/feedback", (_req, res) =>
    res.json(
      Object.fromEntries(
        (
          db
            .prepare("SELECT item_id,rating FROM feedback WHERE workspace_id=?")
            .all(res.locals.workspaceId) as {
            item_id: string;
            rating: string;
          }[]
        ).map((row) => [row.item_id, row.rating]),
      ),
    ),
  );
  app.get("/v1/saved", (_req, res) =>
    res.json(
      (
        db
          .prepare("SELECT item_id FROM saves WHERE workspace_id=?")
          .all(res.locals.workspaceId) as { item_id: string }[]
      ).map((row) => row.item_id),
    ),
  );
  app.put("/v1/saved/:id", (req, res) => {
    if (!ownsItem(res.locals.workspaceId, req.params.id as string))
      return res.status(404).json({ error: "Brand not found." });
    db.prepare("INSERT OR IGNORE INTO saves VALUES (?,?)").run(
      res.locals.workspaceId,
      req.params.id as string,
    );
    res.json({ saved: true });
  });
  app.delete("/v1/saved/:id", (req, res) => {
    db.prepare("DELETE FROM saves WHERE workspace_id=? AND item_id=?").run(
      res.locals.workspaceId,
      req.params.id as string,
    );
    res.json({ saved: false });
  });
  app.use("/v1", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const badBody = error instanceof SyntaxError;
      res.status(badBody ? 400 : 500).json({
        error: badBody
          ? "Request body must be valid JSON."
          : "Something went wrong. Please try again.",
      });
    },
  );
  // A restart resumes persisted jobs. One process owns the demo queue; production uses leased Postgres jobs.
  const startLiveResearch = (report: Report) => {
    if (liveJobs.has(report.id)) return;
    report.status = "collecting";
    report.phase = "collecting";
    report.updatedAt = new Date().toISOString();
    saveReport(report);
    const controller = new AbortController();
    const job = runWithResearchDeadline(
      (signal) => marketResearch(report.profile, { signal }),
      researchTimeoutMs,
      controller,
    )
      .then((result) => {
        const currentRow = db
          .prepare("SELECT payload FROM reports WHERE id=?")
          .get(report.id) as { payload: string } | undefined;
        if (!currentRow) return;
        const current: Report = JSON.parse(currentRow.payload);
        if (current.status === "cancelled") return;
        current.collaborators = result.collaborators;
        current.competitors = result.competitors;
        current.themes = result.themes;
        current.swot = result.swot;
        current.actions = result.actions;
        current.evidence = result.evidence;
        current.warning = result.warning;
        current.phase = "synthesizing";
        current.status =
          result.collaborators.length >= 2 && result.competitors.length >= 2
            ? "completed"
            : "partial";
        current.updatedAt = new Date().toISOString();
        saveReport(current);
      })
      .catch((error: unknown) => {
        const currentRow = db
          .prepare("SELECT payload FROM reports WHERE id=?")
          .get(report.id) as { payload: string } | undefined;
        if (!currentRow) return;
        const current: Report = JSON.parse(currentRow.payload);
        if (current.status === "cancelled") return;
        current.status = "partial";
        current.warning = `Live market research failed without substituting fictional data: ${
          error instanceof Error ? error.message : "unknown provider error"
        }`;
        current.updatedAt = new Date().toISOString();
        saveReport(current);
      })
      .finally(() => {
        liveJobs.delete(report.id);
      });
    liveJobs.set(report.id, { promise: job, controller });
  };
  const tick = () => {
    const rows = db.prepare("SELECT * FROM reports").all() as unknown as Row[];
    for (const row of rows) {
      const report: Report = JSON.parse(row.payload);
      if (report.profile.mode === "browserbase") {
        if (!terminal(report.status)) startLiveResearch(report);
        continue;
      }
      if (
        terminal(report.status) ||
        Date.now() - Date.parse(report.updatedAt) < phaseMs
      )
        continue;
      const index = phases.indexOf(report.phase);
      const next: Status =
        phases[index + 1] ?? (row.partial ? "partial" : "completed");
      report.status = next;
      if (!terminal(next)) report.phase = next as Report["phase"];
      if (next === "analyzing" || terminal(next)) {
        const fixture = fixtureReport(report.profile, report.id);
        report.collaborators = fixture.collaborators;
        report.evidence = fixture.evidence;
        if (!row.partial) {
          report.competitors = fixture.competitors;
          report.themes = fixture.themes;
        }
        if (terminal(next)) {
          if (!row.partial) {
            report.swot = fixture.swot;
            report.actions = fixture.actions;
          } else
            report.warning =
              "The simulated discourse provider failed. Collaborators are available; competitor analysis and strategy need more evidence.";
        }
      }
      report.updatedAt = new Date().toISOString();
      saveReport(report);
    }
  };
  const worker = setInterval(tick, Math.min(phaseMs, 500));
  return {
    app,
    db,
    tick,
    close: () => {
      clearInterval(worker);
      for (const { controller } of liveJobs.values())
        controller.abort(new Error("Platform is shutting down."));
      db.close();
    },
  };
}
