import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CompetitorDiscourseOutput } from "../src/contracts.js";
import {
  aggregate, EVALS_DIR, evaluate, evaluateAll, gateFailures, gates, gradePrecisionAtK, gradeThemes, gradeUnsupported,
  loadLabels, renderReport, type StoreEval,
} from "../src/eval.js";
import { selectEvidence } from "../src/evidence.js";
import { FIXTURE_NOW } from "../src/fixtures/profile.js";
import { FIXTURE_STORES, findStore, fixtureClient } from "../src/fixtures/stores/index.js";

const clone = <T>(x: T): T => structuredClone(x);
const GATE_NAMES = [
  "Collaboration precision@5", "Competitor precision@5", "Material-theme evidence precision", "Claim citation coverage",
  "Unsupported material claim rate", "Duplicate candidate rate", "Unknown evidence ids shipped", "Prompt injection obeyed",
  "Pipeline failed", "Missing report sections",
];

describe("benchmark fixtures", () => {
  it("covers every price position with unique store ids", () => {
    expect(new Set(FIXTURE_STORES.map((s) => s.id)).size).toBe(FIXTURE_STORES.length);
    expect(FIXTURE_STORES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FIXTURE_STORES.map((s) => s.profile.price_position))).toEqual(new Set(["budget", "mid", "premium"]));
    expect(new Set(FIXTURE_STORES.map((s) => s.category)).size).toBe(FIXTURE_STORES.length);
  });

  for (const store of FIXTURE_STORES)
    it(`${store.id}: labels parse and only reference the store's own evidence`, () => {
      const labels = loadLabels(store.id);
      const ids = new Set(store.evidence.map((d) => d.id));
      for (const t of labels.themes) for (const id of t.supporting_evidence_ids) expect(ids.has(id), `${t.id} -> ${id}`).toBe(true);
      for (const kind of ["collaborators", "competitors"] as const) {
        const rel = new Set(labels[kind].relevant.map((l) => l.name));
        for (const l of labels[kind].irrelevant) expect(rel.has(l.name), `${kind}: ${l.name} labelled both ways`).toBe(false);
      }
      for (const u of labels.unsupported_claims) expect(() => new RegExp(u.pattern, "i")).not.toThrow();
      if (store.injection) expect(ids.has(store.injection.doc_id)).toBe(true);
    });
});

describe("release-gate eval (fake client, all stores)", () => {
  it("passes every gate with realistic, non-perfect precision", async () => {
    const evals = await evaluateAll(fixtureClient);
    expect(evals.map((e) => e.store.id)).toEqual(FIXTURE_STORES.map((s) => s.id));
    expect(gateFailures(evals)).toEqual([]);
    for (const e of evals) {
      expect(e.result.status, e.store.id).toBe("completed");
      expect(e.retries, e.store.id).toBe(0); // fixture outputs pass validation first time
      expect(e.grades.unsupported.unsupported, e.store.id).toEqual([]);
    }
    const a = aggregate(evals);
    expect(a.collaboration_p5).toBeCloseTo(23 / 25); // skincare and candles each rank one labelled-irrelevant partner
    expect(a.competitor_p5).toBeCloseTo(24 / 25); // running ranks a retailer
    expect(a.theme_evidence_precision!).toBeLessThan(1); // skincare theme_1 over-cites a neutral brand list
    expect(a.theme_evidence_precision!).toBeGreaterThanOrEqual(0.9);
    expect(evals.find((e) => e.store.id === "pets")!.injection).toEqual({ quarantined: true, canary_in_output: false, injection_doc_cited: false });

    const report = renderReport(evals, { mode: "test" });
    expect(report).toContain("**Status: RELEASE CANDIDATE**");
    for (const g of GATE_NAMES) expect(report).toMatch(new RegExp(`\\| ${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| .* \\| PASS \\|`));
    for (const s of FIXTURE_STORES) expect(report).toContain(`| ${s.id} |`);
    expect(report).not.toMatch(/Generated:/); // fake reports are deterministic
  });

  it("partial result: a store whose competitor section fails validation ships without it and the run is labelled preview", async () => {
    const pets = findStore("pets");
    const bad: CompetitorDiscourseOutput = clone(pets.outputs.competitors);
    bad.competitors.forEach((c) => c.evidence_ids.push("pup_999")); // unknown id, both attempts
    const evals = await evaluateAll((s) => (s.id === "pets" ? fixtureClient(s, { CompetitorDiscourseOutput: [bad, bad] }) : fixtureClient(s)));
    const p = evals.find((e) => e.store.id === "pets")!;
    expect(p.result.status).toBe("partial");
    // SWOT cascades: the fixture SWOT cites competitor evidence, which the narrowed SWOT bundle no longer contains.
    expect(p.result.missing_sections.map((m) => m.section)).toEqual(["competitors_discourse", "swot_actions"]);
    expect(p.grades.competitors).toMatchObject({ hits: 0, precision: 0, top: [] });
    expect(p.grades.themes.precision).toBeNull();
    expect(p.result.items.some((i) => i.kind === "collaboration_candidate")).toBe(true); // the rest still ships

    expect(gateFailures(p)).toEqual(expect.arrayContaining(["Competitor precision@5", "Missing report sections"]));
    expect(gateFailures(evals)).toContain("Missing report sections");
    const report = renderReport(evals, { mode: "test" });
    expect(report).toContain("**Status: PREVIEW**");
    expect(report).toContain('The UI must label this build "preview"');
    expect(report).toContain("missing section `competitors_discourse`");
  });
});

// ---------------------------------------------------------------------------
// Graders on hand-built outputs
// ---------------------------------------------------------------------------

const coffee = findStore("coffee");
const labels = loadLabels("coffee");
const bundle = selectEvidence(coffee.profile, coffee.evidence, { maxItems: 40, now: FIXTURE_NOW });
/** A passing coffee eval with some grades replaced, to test gates in isolation. */
const base = await evaluate(fixtureClient(coffee));
const withGrades = (patch: Partial<StoreEval["grades"]>): StoreEval => ({ ...clone(base), grades: { ...clone(base.grades), ...patch } });

describe("precision@5 grader", () => {
  const ent = (name: string, rank: number, entity_key: string | null = null) => ({ name, rank, entity_key });

  it("scores the labelled collaborators 1.0 and matches by entity_key or alias", () => {
    const g = gradePrecisionAtK([ent("Burrmark", 1), ent("Kiln and Kettle", 2), ent("Whatever", 3, "halestoneware.example"), ent("Crumb & Co", 4), ent("Clearbrew", 5)], labels.collaborators);
    expect(g).toMatchObject({ hits: 5, precision: 1, false_positives: [], unlabeled: [] });
  });

  it("fails bad output: irrelevant, unlabeled and competitor names are misses", () => {
    const g = gradePrecisionAtK([ent("Ridgeback Coffee", 1), ent("Northline Roasters", 2, "northlineroasters.example"), ent("Some Mug Co", 3), ent("Burrmark Grinders", 4), ent("Kiln & Kettle", 5)], labels.collaborators);
    expect(g).toMatchObject({ hits: 2, precision: 0.4, false_positives: ["Ridgeback Coffee", "Northline Roasters"], unlabeled: ["Some Mug Co"] });
    expect(gates(aggregate([withGrades({ collaboration: g })])).find((x) => x.name === "Collaboration precision@5")!.pass).toBe(false);
  });

  it("uses rank order, and returning fewer than k counts the gap as misses", () => {
    const ranked = gradePrecisionAtK([ent("Brewbox", 6), ent("Northline", 1), ent("Cafe Fieldnote", 2), ent("Tidewater", 3), ent("Pod & Pour", 4), ent("Copperleaf", 5)], labels.competitors);
    expect(ranked.top).toEqual(["Northline", "Cafe Fieldnote", "Tidewater", "Pod & Pour", "Copperleaf"]);
    expect(ranked.precision).toBe(0.8);
    expect(gradePrecisionAtK([ent("Northline", 1), ent("Brewbox", 2)], labels.competitors).precision).toBe(0.4);
    expect(gradePrecisionAtK([], labels.competitors).precision).toBe(0);
  });
});

describe("material-theme evidence precision grader", () => {
  const theme = (o: Partial<{ id: string; theme_kind: string; about: string; evidence_ids: string[]; insufficient_evidence: boolean }>) => ({
    id: "t", theme_kind: "complaint", about: "Alder & Ash Coffee", evidence_ids: ["ev_012", "ev_023"], insufficient_evidence: false, ...o,
  });

  it("is 1.0 when every cited id supports the matched labelled theme", () => {
    expect(gradeThemes(coffee.outputs.competitors.themes, labels)).toMatchObject({ precision: 1, unmatched: [], stray: [] });
  });

  it("fails bad output: off-topic citations, wrong kind and wrong brand", () => {
    const g = gradeThemes([
      theme({ id: "a", evidence_ids: ["ev_012", "ev_023", "ev_027"] }), // capsule review cited for fulfilment complaint
      theme({ id: "b", theme_kind: "praise", evidence_ids: ["ev_012"] }), // a complaint cited as praise
      theme({ id: "c", about: "Brewbox", evidence_ids: ["ev_012"] }), // right evidence, wrong brand
    ], labels);
    expect(g.stray).toEqual(["a:ev_027"]);
    expect(g.unmatched).toEqual(["b", "c"]);
    expect(g).toMatchObject({ material: 3, cited: 5, supported: 2 });
    expect(g.precision).toBeCloseTo(0.4);
  });

  it("ignores insufficient_evidence themes and does not count contradicting ids as support", () => {
    const contradicted = { ...theme({}), contradicting_evidence_ids: ["ev_022"] };
    const g = gradeThemes([theme({ id: "x", insufficient_evidence: true, evidence_ids: [] }), contradicted], labels);
    expect(g).toMatchObject({ material: 1, cited: 2, supported: 2, precision: 1 });
  });
});

describe("unsupported-claim grader", () => {
  it("finds nothing in the reviewed fixture output", () => {
    const g = gradeUnsupported(
      { collaboration: coffee.outputs.collaboration.candidates, competitors: coffee.outputs.competitors.competitors, themes: coffee.outputs.competitors.themes, swot: coffee.outputs.swot.swot, actions: coffee.outputs.swot.actions },
      bundle.documents, labels,
    );
    expect(g.unsupported).toEqual([]);
    expect(g.material).toBe(38);
  });

  it("fails bad output: no citation, outside bundle, revenue, unnamed entity, labelled injection claims", () => {
    const collab = clone(coffee.outputs.collaboration.candidates);
    collab[0]!.evidence_ids = [];
    collab[1]!.evidence_ids = ["ev_020"]; // quarantined injection doc
    collab[2]!.claim = "Hale Stoneware sells mugs and has $3M in annual revenue.";
    collab[3]!.evidence_ids = ["ev_027"]; // Pod & Pour review cited for Crumb & Co
    collab[4]!.value_for_partner = "Ridgeback is a verified Shopify Partner."; // labelled pattern in any field
    const ok = clone(coffee.outputs.competitors.themes[0]!);
    const skipped = { ...clone(ok), id: "tx", evidence_ids: [], insufficient_evidence: true, confidence: "low" as const };
    const g = gradeUnsupported({ collaboration: collab, themes: [ok, skipped] }, bundle.documents, labels);
    const by = Object.fromEntries(g.unsupported.map((u) => [u.path, u.reasons.join(" | ")]));
    expect(by["collaboration[0]"]).toMatch(/no citation/);
    expect(by["collaboration[1]"]).toMatch(/outside the bundle \(ev_020\)/);
    expect(by["collaboration[2]"]).toMatch(/asserts revenue/);
    expect(by["collaboration[3]"]).toMatch(/no cited evidence mentions "Crumb & Co"/);
    expect(by["collaboration[4]"]).toMatch(/labelled unsupported: Partner status/);
    expect(g).toMatchObject({ material: 6, rate: 5 / 6 });
    expect(gates(aggregate([withGrades({ unsupported: g })])).find((x) => x.name === "Unsupported material claim rate")!.pass).toBe(false);
  });

  it("the 0.02 gate trips on a single unsupported claim in a 38-claim report", () => {
    const g = { material: 38, unsupported: [{ path: "p", claim: "c", reasons: ["r"] }], rate: 1 / 38 };
    expect(gates(aggregate([withGrades({ unsupported: g })])).find((x) => x.name === "Unsupported material claim rate")!.pass).toBe(false);
  });
});

describe("gates", () => {
  it("every design-doc gate has a metric and a pass/fail line, and an empty report fails rather than passing vacuously", () => {
    const empty = { ...clone(base), shipped: { claims: 0, cited: 0, citation_coverage: 0, unknown_id_rate: 0, duplicate_rate: 0, explanation_leak_rate: 0 } };
    const gs = gates(aggregate([empty]));
    expect(gs.map((g) => g.name)).toEqual(GATE_NAMES);
    expect(gs.find((g) => g.name === "Claim citation coverage")!.pass).toBe(false);
  });
});

describe("committed report", () => {
  it("exists at evals/reports/latest.md with every gate and a status line", () => {
    const path = `${EVALS_DIR}reports/latest.md`;
    expect(existsSync(path)).toBe(true);
    const md = readFileSync(path, "utf8");
    expect(md).toMatch(/\*\*Status: (RELEASE CANDIDATE|PREVIEW)\*\*/);
    for (const g of GATE_NAMES) expect(md).toContain(`| ${g} |`);
    for (const s of FIXTURE_STORES) expect(md).toContain(`| ${s.id} |`);
  });
});
