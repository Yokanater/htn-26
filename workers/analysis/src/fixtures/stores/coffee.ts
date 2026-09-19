import { coffeeEvidence, INJECTION_CANARY, INJECTION_DOC_ID } from "../evidence.js";
import { fakeCollaboration, fakeCompetitors, fakeSwotActions } from "../outputs.js";
import { coffeeProfile } from "../profile.js";
import { coffeeSeeds } from "../seeds.js";
import type { FixtureStore } from "./types.js";

/** The original coffee fixture (premium specialty coffee), wrapped as a benchmark store. */
export const coffee: FixtureStore = {
  id: "coffee",
  category: "specialty coffee",
  profile: coffeeProfile,
  evidence: coffeeEvidence,
  seeds: coffeeSeeds,
  outputs: { collaboration: fakeCollaboration, competitors: fakeCompetitors, swot: fakeSwotActions },
  injection: { doc_id: INJECTION_DOC_ID, canary: INJECTION_CANARY },
};
