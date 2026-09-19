import { describe, expect, it } from "vitest";
import { validateReport, findForbiddenAssertions, type ReportSections, type ValidationErrorCode } from "../src/validator.js";
import { toBundle } from "../src/evidence.js";
import { coffeeProfile } from "../src/fixtures/profile.js";
import { coffeeEvidence } from "../src/fixtures/evidence.js";
import { fakeCollaboration, fakeCompetitors, fakeSwotActions } from "../src/fixtures/outputs.js";

const bundle = toBundle(coffeeProfile, coffeeEvidence);
const clone = <T>(x: T): T => structuredClone(x);
const good = (): ReportSections => ({
  collaboration: clone(fakeCollaboration.candidates),
  competitors: clone(fakeCompetitors.competitors),
  themes: clone(fakeCompetitors.themes),
  swot: clone(fakeSwotActions.swot),
  actions: clone(fakeSwotActions.actions),
});
const codes = (r: ReportSections) => validateReport(r, bundle).map((e) => e.code);

describe("validateReport", () => {
  it("passes the well-formed fixture report", () => {
    expect(validateReport(good(), bundle)).toEqual([]);
  });

  it("validates whatever sections are present", () => {
    expect(validateReport({}, bundle)).toEqual([]);
    expect(validateReport({ swot: good().swot }, bundle)).toEqual([]);
  });

  it("rejects unknown evidence ids, with the offending id and path", () => {
    const r = good();
    r.swot!.strengths[0]!.evidence_ids.push("ev_999");
    const errs = validateReport(r, bundle);
    expect(errs).toEqual([expect.objectContaining({ code: "UNKNOWN_EVIDENCE_ID", path: "swot.strengths[0]", evidence_id: "ev_999" })]);
  });

  it("rejects unknown ids in contradicting_evidence_ids too", () => {
    const r = good();
    r.themes![0]!.contradicting_evidence_ids = ["ev_404"];
    expect(codes(r)).toEqual(["UNKNOWN_EVIDENCE_ID"]);
  });

  it("rejects claims with empty evidence_ids", () => {
    const r = good();
    r.collaboration![0]!.evidence_ids = [];
    expect(codes(r)).toEqual(["EMPTY_EVIDENCE_IDS"]);
  });

  it("allows empty evidence_ids only with insufficient_evidence + low confidence", () => {
    const r = good();
    Object.assign(r.competitors![3]!, { evidence_ids: [], insufficient_evidence: true, confidence: "low" });
    expect(codes(r)).toEqual([]);
    r.competitors![3]!.confidence = "high";
    expect(codes(r)).toEqual(["INSUFFICIENT_BUT_CONFIDENT"]);
  });

  it("rejects inferences without an explanation (null, empty, whitespace)", () => {
    for (const explanation of [null, "", "   "]) {
      const r = good();
      r.swot!.opportunities[0]!.explanation = explanation;
      expect(codes(r)).toEqual(["MISSING_EXPLANATION"]);
    }
  });

  describe("revenue / traffic / market-share assertions", () => {
    const cases: [string, string][] = [
      ["Northline has an estimated $4M in annual revenue.", "FORBIDDEN_ASSERTION"],
      ["Tidewater generates most of its revenue from subscriptions.", "FORBIDDEN_ASSERTION"],
      ["Brewbox gets 200,000 monthly visitors.", "FORBIDDEN_ASSERTION"],
      ["Northline enjoys high-traffic product pages.", "FORBIDDEN_ASSERTION"],
      ["Northline holds a large market share among roasters.", "FORBIDDEN_ASSERTION"],
      ["Tidewater is the market leader in Atlantic Canada.", "FORBIDDEN_ASSERTION"],
      ["About 30% of the market prefers medium roast.", "FORBIDDEN_ASSERTION"],
    ];
    it.each(cases)("rejects: %s", (text) => {
      const r = good();
      r.competitors![0]!.claim = text;
      expect(codes(r)).toEqual(["FORBIDDEN_ASSERTION"]);
    });

    it("scans every text field, not just claim", () => {
      const r = good();
      r.collaboration![0]!.value_for_partner = "Gains access to a share of the specialty market.";
      const [e] = validateReport(r, bundle);
      expect(e).toMatchObject({ code: "FORBIDDEN_ASSERTION", path: "collaboration[0].value_for_partner" });
    });

    it("allows negated caveats and ordinary uses of the words", () => {
      expect(findForbiddenAssertions("Mention counts do not imply market share.")).toEqual([]);
      expect(findForbiddenAssertions("Revenue data is unavailable, so no ranking is implied.")).toEqual([]);
      expect(findForbiddenAssertions("Measure waitlist sign-ups per 1,000 visitors and orders per email.")).toEqual([]);
      expect(findForbiddenAssertions("Falsified if the attach rate is under 5%.")).toEqual([]);
    });
  });

  it("rejects duplicate items across SWOT quadrants", () => {
    const r = good();
    r.swot!.threats[0] = { ...r.swot!.threats[0]!, claim: r.swot!.strengths[1]!.claim + " Indeed." };
    const errs = validateReport(r, bundle);
    expect(errs).toEqual([expect.objectContaining({ code: "DUPLICATE_SWOT_ITEM", path: "swot.threats[0]" })]);
    expect(errs[0]!.message).toContain("swot.strengths[1]");
  });

  describe("SWOT strengths/weaknesses must concern the merchant", () => {
    it("rejects subject=market in a strength", () => {
      const r = good();
      r.swot!.strengths[0]!.subject = "market";
      expect(codes(r)).toEqual(["SWOT_NOT_ABOUT_MERCHANT"]);
    });

    it("rejects a weakness that is really about a competitor", () => {
      const r = good();
      Object.assign(r.swot!.weaknesses[0]!, {
        claim: "Northline ships slowly to British Columbia.",
        evidence_ids: ["ev_018"],
      });
      const errs = validateReport(r, bundle);
      expect(errs).toEqual([expect.objectContaining({ code: "SWOT_NOT_ABOUT_MERCHANT", path: "swot.weaknesses[0]" })]);
    });

    it("accepts a claim that cites merchant-owned evidence without naming the brand", () => {
      const r = good();
      Object.assign(r.swot!.weaknesses[2]!, { claim: "Only light to medium roasts are offered.", evidence_ids: ["ev_002"] });
      expect(codes(r)).toEqual([]);
    });

    it("does not apply to opportunities/threats", () => {
      const r = good();
      r.swot!.threats[0]!.claim = "Brewbox lets shoppers sample several roasters at once.";
      expect(codes(r)).toEqual([]);
    });
  });

  describe("extra structural rules", () => {
    it("rejects discourse themes that cite the merchant's own marketing copy", () => {
      const r = good();
      r.themes![0]!.evidence_ids.push("ev_001");
      const [e] = validateReport(r, bundle);
      expect(e).toMatchObject({ code: "FIRST_PARTY_IN_DISCOURSE", evidence_id: "ev_001" });
    });

    it("rejects direct substitutes without an explicit conflict note", () => {
      const r = good();
      Object.assign(r.collaboration![0]!, { is_direct_substitute: true, conflict_note: null });
      expect(codes(r)).toEqual(["SUBSTITUTE_WITHOUT_CONFLICT"]);
      r.collaboration![0]!.conflict_note = "Also sells hand grinders similar to our own.";
      expect(codes(r)).toEqual([]);
    });

    it("rejects duplicate ids and duplicate entities", () => {
      const r = good();
      r.collaboration![1]!.id = r.collaboration![0]!.id;
      r.competitors![1]!.entity_key = r.competitors![0]!.entity_key;
      expect(codes(r).sort()).toEqual(["DUPLICATE_ENTITY", "DUPLICATE_ID"]);
    });

    it("rejects a collaboration partner listed as a competitor (seen live: Kiln & Kettle, Hale, Crumb & Co)", () => {
      const r = good();
      Object.assign(r.competitors![5]!, { name: "Kiln & Kettle", entity_key: null });
      const complements = [{ entity_key: "kilnandkettle.example", name: "Kiln & Kettle" }];
      expect(validateReport(r, bundle, { complements })).toEqual([expect.objectContaining({ code: "COMPLEMENT_LISTED_AS_COMPETITOR", path: "competitors[5]" })]);
      r.competitors![5]!.entity_key = "kilnandkettle.example"; // matched by key too
      r.competitors![5]!.name = "K&K";
      expect(validateReport(r, bundle, { complements }).map((e) => e.code)).toEqual(["COMPLEMENT_LISTED_AS_COMPETITOR"]);
      expect(validateReport(good(), bundle, { complements })).toEqual([]);
    });

    it("requires all four discourse theme kinds", () => {
      const r = good();
      r.themes = r.themes!.filter((t) => t.theme_kind !== "unmet_need");
      expect(codes(r)).toEqual(["MISSING_THEME_KIND"]);
    });
  });
});
