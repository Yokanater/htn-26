import type { EntitySeed } from "../contracts.js";

const collab = (entity_key: string, name: string, c: Record<string, number>, penalty = 0): EntitySeed => {
  const components = { ...c, ...(penalty ? { conflict_penalty: -penalty } : {}) };
  return {
    entity_key,
    name,
    kind: "collaboration",
    score_components: { components, total: Object.values(components).reduce((a, b) => a + b, 0) },
  };
};
const comp = (entity_key: string, name: string, c: Record<string, number>): EntitySeed => ({
  entity_key,
  name,
  kind: "competitor",
  score_components: { components: c, total: Object.values(c).reduce((a, b) => a + b, 0) },
});

/** Upstream scores (fixture stand-ins for the scoring teammate's output). */
export const coffeeSeeds: EntitySeed[] = [
  collab("burrmarkgrinders.example", "Burrmark Grinders", { complementary_job: 28, audience_overlap: 17, price_fit: 12, feasibility: 13, evidence_quality: 9, novelty: 6 }),
  collab("kilnandkettle.example", "Kiln & Kettle", { complementary_job: 26, audience_overlap: 16, price_fit: 11, feasibility: 12, evidence_quality: 9, novelty: 7 }),
  collab("halestoneware.example", "Hale Stoneware", { complementary_job: 22, audience_overlap: 15, price_fit: 13, feasibility: 14, evidence_quality: 8, novelty: 8 }),
  collab("crumbandco.example", "Crumb & Co", { complementary_job: 20, audience_overlap: 13, price_fit: 12, feasibility: 14, evidence_quality: 6, novelty: 8 }),
  collab("clearbrew.example", "Clearbrew Filters", { complementary_job: 24, audience_overlap: 14, price_fit: 12, feasibility: 11, evidence_quality: 3, novelty: 6 }),
  comp("northlineroasters.example", "Northline Roasters", { product_overlap: 28, audience_overlap: 18, price_overlap: 13, positioning_similarity: 12, discourse: 8, source_diversity: 8 }),
  comp("tidewatercoffee.example", "Tidewater Coffee Co", { product_overlap: 24, audience_overlap: 15, price_overlap: 11, positioning_similarity: 9, discourse: 7, source_diversity: 7 }),
  comp("copperleafcoffee.example", "Copperleaf Coffee", { product_overlap: 22, audience_overlap: 13, price_overlap: 10, positioning_similarity: 8, discourse: 3, source_diversity: 3 }),
  comp("brewbox.example", "Brewbox", { product_overlap: 15, audience_overlap: 14, price_overlap: 9, positioning_similarity: 11, discourse: 6, source_diversity: 7 }),
  comp("podandpour.example", "Pod & Pour", { product_overlap: 12, audience_overlap: 8, price_overlap: 6, positioning_similarity: 5, discourse: 3, source_diversity: 3 }),
  comp("cafefieldnote.example", "Cafe Fieldnote", { product_overlap: 10, audience_overlap: 9, price_overlap: 7, positioning_similarity: 6, discourse: 2, source_diversity: 3 }),
];
