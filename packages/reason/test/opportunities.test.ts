import { readFileSync } from 'node:fs';
import { MerchantOpportunitySchema } from '@sei/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createCollaborationComposer } from '../src/opportunities';

describe.each(['outfit', 'setup'])('%s collaboration copy', (domain) => {
  const opportunity = MerchantOpportunitySchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../fixtures/seed/${domain}/opportunity.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
  it('cites the aggregate and source IDs, leaves terms unknown', async () => {
    const draft = await createCollaborationComposer().compose(
      opportunity,
      new AbortController().signal,
    );
    expect(draft.hypothesis).toContain('Synthetic demonstration');
    expect(draft.outreach).toContain(opportunity.productEvidenceIds[0]);
    expect(draft.hypothesis).toContain(`${opportunity.demand.aggregateId} v1`);
    expect(draft.outreach).toContain('would need agreement');
  });
  it('uses Baseten for a validated experiment with no free-form factual claims', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                mechanism: 'opt_in_interest_test',
                evidenceIds: opportunity.productEvidenceIds,
                aggregateId: opportunity.demand.aggregateId,
              }),
            },
          },
        ],
      }),
    );
    const draft = await createCollaborationComposer({
      apiKey: 'test',
      model: 'test',
      fetch,
    }).compose(opportunity, new AbortController().signal);
    expect(draft.generatedBy).toBe('baseten');
    expect(draft.experiment).toContain('expression of interest');
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('sessionId');
  });
  it('rejects private prompt fields and falls back on invented citations', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                mechanism: 'joint_style_guide',
                evidenceIds: ['ev_forged'],
                aggregateId: opportunity.demand.aggregateId,
              }),
            },
          },
        ],
      }),
    );
    const composer = createCollaborationComposer({ apiKey: 'test', model: 'test', fetch });
    await expect(
      composer.compose(
        { ...opportunity, sessionId: 'private' } as typeof opportunity,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect((await composer.compose(opportunity, new AbortController().signal)).generatedBy).toBe(
      'template',
    );
  });
});
