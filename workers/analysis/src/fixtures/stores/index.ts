import { FakeLlmClient } from "../../llm/fake.js";
import { candles } from "./candles.js";
import { coffee } from "./coffee.js";
import { pets } from "./pets.js";
import { running } from "./running.js";
import { skincare } from "./skincare.js";
import type { FixtureStore } from "./types.js";

export type { FixtureStore } from "./types.js";

/** The benchmark. Design-doc target is 30 stores balanced across categories and price positions. */
export const FIXTURE_STORES: FixtureStore[] = [coffee, pets, skincare, running, candles];

export function findStore(id: string): FixtureStore {
  const s = FIXTURE_STORES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown fixture store "${id}" (have: ${FIXTURE_STORES.map((x) => x.id).join(", ")})`);
  return s;
}

type Scripted = Partial<Record<"CollaborationOutput" | "CompetitorDiscourseOutput" | "SwotActionsOutput", unknown[]>>;

/**
 * Fake client that answers with this store's hand-written outputs (twice each, so a retry gets the same answer).
 * `override` replaces a workflow's queue, e.g. to script a section that fails validation.
 */
export function fixtureClient(store: FixtureStore, override: Scripted = {}): FakeLlmClient {
  const o = store.outputs;
  return new FakeLlmClient({
    scripted: {
      CollaborationOutput: override.CollaborationOutput ?? [o.collaboration, o.collaboration],
      CompetitorDiscourseOutput: override.CompetitorDiscourseOutput ?? [o.competitors, o.competitors],
      SwotActionsOutput: override.SwotActionsOutput ?? [o.swot, o.swot],
    },
  });
}
