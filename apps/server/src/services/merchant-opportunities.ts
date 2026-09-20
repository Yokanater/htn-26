/**
 * Fixture-backed merchant opportunities. Owner: L4 (S4-L4-1).
 * Observed pairs clone seed JSON; newcomers get inferred supply fit with a complementary seed partner.
 */
import { readFileSync } from 'node:fs';
import {
  type MerchantIdentity,
  type MerchantOpportunity,
  MerchantOpportunitySchema,
  type ProductOffer,
  type ShoppingDomain,
} from '@sei/contracts';
import { SHOPPING_DOMAINS } from '@sei/core';

const OUTFIT_CATEGORIES = new Set(['bag', 'top', 'bottom', 'footwear']);
const SETUP_CATEGORIES = new Set(['desk', 'lighting', ...SHOPPING_DOMAINS.setup.exampleCategories]);

export interface SeedPair {
  domain: ShoppingDomain;
  opportunity: MerchantOpportunity;
  merchants: Array<{ identity: MerchantIdentity; category: string; offers: ProductOffer[] }>;
}

export function loadSeedOpportunities(offers: readonly ProductOffer[]): SeedPair[] {
  return (Object.keys(SHOPPING_DOMAINS) as ShoppingDomain[]).map((domain) => {
    const opportunity = MerchantOpportunitySchema.parse(
      JSON.parse(
        readFileSync(
          new URL(`../../../../fixtures/seed/${domain}/opportunity.json`, import.meta.url),
          'utf8',
        ),
      ),
    );
    const merchants = opportunity.merchants.map((identity) => {
      const merchantOffers = offers.filter((offer) => offer.merchant.id === identity.id);
      const category = merchantOffers[0]?.category ?? opportunity.demand.cohort.categories[0]!;
      return { identity, category, offers: merchantOffers };
    });
    return { domain, opportunity, merchants };
  });
}

export function validateOpportunity(value: MerchantOpportunity): MerchantOpportunity {
  return MerchantOpportunitySchema.parse(structuredClone(value));
}

export function observedOpportunityFor(
  merchantId: string,
  pairs: readonly SeedPair[],
): MerchantOpportunity | null {
  for (const pair of pairs) {
    if (pair.opportunity.merchants.some((merchant) => merchant.id === merchantId)) {
      return validateOpportunity(pair.opportunity);
    }
  }
  return null;
}

export function inferOpportunity(
  newcomer: MerchantIdentity,
  newcomerOffers: readonly ProductOffer[],
  pairs: readonly SeedPair[],
): MerchantOpportunity {
  const categories = [...new Set(newcomerOffers.map((offer) => offer.category))];
  const domain = selectDomain(categories);
  const pair = pairs.find((item) => item.domain === domain) ?? pairs[0]!;
  const partner = selectPartner(newcomer, categories, pair);
  const partnerOffers =
    pair.merchants.find((item) => item.identity.id === partner.id)?.offers ?? [];
  const evidenceIds = [
    ...new Set([
      ...newcomerOffers.flatMap((offer) => offer.evidence.map((item) => item.id)),
      ...partnerOffers.flatMap((offer) => offer.evidence.map((item) => item.id)),
    ]),
  ].sort();
  const demand = structuredClone(pair.opportunity.demand);
  return validateOpportunity({
    id: `opp_inferred_${newcomer.id}_${partner.id}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 80),
    merchants: [structuredClone(newcomer), structuredClone(partner)],
    basis: 'inferred_supply_fit',
    demand: { ...demand, sampleOrigin: 'seed', status: 'available' },
    observedPairSupport: null,
    productEvidenceIds: evidenceIds,
    proposedExperiment: pair.opportunity.proposedExperiment,
    uncertainties: [
      'Inferred supply fit only; shoppers have not selected this pairing',
      ...pair.opportunity.uncertainties,
    ],
  });
}

function selectDomain(categories: readonly string[]): ShoppingDomain {
  const outfitHits = categories.filter((category) => OUTFIT_CATEGORIES.has(category)).length;
  const setupHits = categories.filter((category) => SETUP_CATEGORIES.has(category)).length;
  if (setupHits > outfitHits) return 'setup';
  return 'outfit';
}

function selectPartner(
  newcomer: MerchantIdentity,
  newcomerCategories: readonly string[],
  pair: SeedPair,
): MerchantIdentity {
  const covered = new Set(newcomerCategories);
  const complementary = pair.merchants.find(
    (merchant) => merchant.identity.id !== newcomer.id && !covered.has(merchant.category),
  );
  if (complementary) return complementary.identity;
  const fallback = [...pair.merchants]
    .filter((merchant) => merchant.identity.id !== newcomer.id)
    .sort((a, b) => a.identity.id.localeCompare(b.identity.id))[0];
  return fallback?.identity ?? pair.merchants[0]!.identity;
}
