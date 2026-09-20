/** Isolated rehearsal composition. Real public product recordings; never live demand. */
import { readFile } from 'node:fs/promises';
import {
  DemandEventSchema,
  IntentBriefSchema,
  type MerchantDemandSummary,
  newId,
  ProductOfferSchema,
} from '@sei/contracts';
import { createDemandAggregator } from '@sei/enrich';
import {
  createIntentInterpreter,
  createOpenAiIntentModel,
  type IntentModel,
  mapVisionDraft,
  VisionDraftSchema,
} from '@sei/reason';
import { type AppProviders, defaultProviders } from '../providers';
import { DemandProjectionService } from '../services/demand-projection';
import { InterpreterIntentDraftService } from '../services/intake';
import { createMerchantResearch, researchCategory } from '../services/merchant-research';

export const DEMO_ENV = {
  MILESTONES: 's1,s2,s3,s4',
  VISION_PROVIDER: 'fake',
  CATALOG_PROVIDER: 'fake',
  MERCHANT_CATALOG_PROVIDER: 'live',
  IMAGE_NORMALIZER: 'sips',
};
export async function createDemoProviders(
  apiKey: string,
  model: string,
  options: { intentModel?: IntentModel; inMemory?: boolean } = {},
): Promise<{ providers: AppProviders; metadata: Record<string, unknown> }> {
  const recording = JSON.parse(
    await readFile(new URL('../../../../demo/allbirds-recording.json', import.meta.url), 'utf8'),
  );
  const offers = ProductOfferSchema.array().parse(recording.offers);
  if (offers.some((p) => p.sampleOrigin !== 'replay'))
    throw new Error('Demo requires replay-only inventory');
  const recordedVision = VisionDraftSchema.parse(
    JSON.parse(
      await readFile(new URL('../../../../demo/vision-recording.json', import.meta.url), 'utf8'),
    ).draft,
  );
  const anchor = offers.filter((p) => p.merchant.domain === recording.anchor);
  const canonical = (category: string, description: string) =>
    /socks?/i.test(description) ? 'socks' : researchCategory(category);
  const rawModel = options.intentModel ?? createOpenAiIntentModel({ apiKey, model });
  const intent = new InterpreterIntentDraftService(
    createIntentInterpreter({
      model: {
        async draft(request, context) {
          const result = await rawModel.draft(request, context);
          return {
            ...result,
            slots: result.slots.map((s) => ({
              ...s,
              category: canonical(s.category, s.description),
            })),
          };
        },
      },
    }),
    'replay',
  );
  const providers = defaultProviders(
    {
      ...DEMO_ENV,
      STORE: options.inMemory ? 'memory' : 'sqlite',
      DATABASE_PATH: new URL('../../../../.data/allbirds-demo.sqlite', import.meta.url).pathname,
    },
    {
      overrides: {
        intent,
        catalog: (brief) => ({
          close: async () => {},
          search: async (query) => {
            const slot = brief.slots.find((s) => s.id === query.slotId);
            if (!slot) return [];
            const category = canonical(slot.category, slot.description);
            return offers.filter(
              (p) =>
                p.category === category &&
                p.price?.currency === brief.currency &&
                (category !== 'footwear' || p.merchant.domain === recording.anchor),
            );
          },
        }),
        merchantCatalog: {
          async profileMerchant(url) {
            if (new URL(url).hostname.replace(/^www\./, '') !== 'allbirds.com')
              throw new Error('This rehearsal is scoped to Allbirds.');
            return {
              merchant: anchor[0]!.merchant,
              offers: anchor,
              captureHash: 'recorded-demo',
              sourceUrl: 'https://www.allbirds.com/',
              shopifySignalsPresent: true,
              merchantClaims: [],
            };
          },
        },
        merchantResearch: createMerchantResearch(
          {},
          {
            recordedOffers: offers,
            openCatalog: () => ({
              close: async () => {},
              search: async (q) => offers.filter((p) => p.category === q.text),
            }),
            planner: async () => ({
              domain: 'outfit',
              competitor: {
                query: 'everyday knit sneakers',
                reason: 'Comparable casual footwear; sampled products, not a full brand ranking.',
              },
              ideas: [
                {
                  category: 'socks',
                  query: 'running socks',
                  reason: 'A practical companion to everyday trainers.',
                },
                {
                  category: 'bag',
                  query: 'compact daypack',
                  reason: 'Carry everyday essentials alongside a walking outfit.',
                },
                {
                  category: 'bottle',
                  query: 'reusable water bottle',
                  reason: 'Hydration for walks and everyday outings.',
                },
              ],
            }),
          },
        ),
      },
    },
  );
  class ReplayProjection extends DemandProjectionService {
    override async merchantSummaries(): Promise<MerchantDemandSummary[]> {
      return (await this.refresh('replay')).filter((s) => s.status === 'available');
    }
  }
  providers.demandProjection = new ReplayProjection({
    ledger: providers.demand,
    briefs: (ids) => providers.intake.findBriefs(ids),
    aggregator: createDemandAggregator(),
    minimumSessions: 5,
    retentionDays: 30,
    snapshotMinutes: 15,
    now: providers.now,
  });
  // Four explicitly synthetic rehearsal sessions. The actual demo selection is the fifth.
  for (let index = 0; index < 4; index++) {
    const owner = `sess_demo_baseline_${index}`;
    if (await providers.demand.getConsent(owner)) continue;
    const now = providers.now();
    const mapped = mapVisionDraft(
      {
        ...recordedVision,
        slots: recordedVision.slots.map((s) => ({
          ...s,
          category: canonical(s.category, s.description),
        })),
      },
      {
        domain: 'outfit',
        input: {
          kind: 'text',
          text: 'Synthetic rehearsal baseline: sneakers, socks and a daypack.',
        },
        country: 'US',
        currency: 'USD',
        sampleOrigin: 'replay',
        createdAt: now,
      },
    );
    if (!mapped.ok) throw new Error('Invalid demo baseline');
    const brief = IntentBriefSchema.parse({ ...mapped.brief, status: 'confirmed' });
    providers.intake.saveBrief(owner, brief, null);
    await providers.demand.setConsent(
      { sessionId: owner, version: 1, state: 'granted', updatedAt: now.toISOString() },
      null,
    );
    const selections = brief.slots.flatMap((slot) => {
      const offer = offers.find((p) => p.category === slot.category && p.price?.currency === 'USD');
      return offer ? [{ slotId: slot.id, offerId: offer.id, merchantId: offer.merchant.id }] : [];
    });
    await providers.demand.append(
      DemandEventSchema.parse({
        id: newId('evt_'),
        sessionId: owner,
        briefId: brief.id,
        briefRevision: brief.revision,
        consentVersion: 1,
        occurredAt: now.toISOString(),
        sampleOrigin: 'replay',
        kind: 'collection_saved',
        matchId: newId('match_'),
        selections,
        rejectionReason: null,
      }),
      `demo-baseline-${index}`,
    );
  }
  return {
    providers,
    metadata: {
      enabled: true,
      storeUrl: 'https://www.allbirds.com/',
      capturedAt: recording.capturedAt,
      merchantNames: Object.fromEntries(offers.map((p) => [p.merchant.id, p.merchant.name])),
      notice:
        'Rehearsal: live image interpretation + recorded Shopify products. Four synthetic baseline sessions; no purchases or real customer demand.',
    },
  };
}
