import { describe, expect, it } from 'vitest';
import { type DemandDecisionDto, decisionRequestBody } from './decisions';

/**
 * The server's decision schema is strict and owns identity, time, origin and each
 * selection's merchant. Spreading the DTO sent briefId and merchantId, so every decision
 * made in the app failed with 400 while API-level tests kept passing.
 */
describe('decisionRequestBody', () => {
  const dto: DemandDecisionDto = {
    briefId: 'brief_test',
    briefRevision: 2,
    matchId: 'match_test',
    kind: 'collection_saved',
    selections: [{ slotId: 'slot_1', offerId: 'offer_1', merchantId: 'mer_1' }],
    rejectionReason: null,
  };

  it('sends only the fields the server accepts', () => {
    const body = decisionRequestBody(dto, 'run_test', 'key-0001');

    expect(Object.keys(body).sort()).toEqual([
      'briefRevision',
      'idempotencyKey',
      'kind',
      'matchId',
      'rejectionReason',
      'runId',
      'selections',
    ]);
    expect(body.selections).toEqual([{ slotId: 'slot_1', offerId: 'offer_1' }]);
    expect(body.selections[0]).not.toHaveProperty('merchantId');
  });

  it('carries the key it is given, so each action can retry without colliding', () => {
    const first = decisionRequestBody(dto, 'run_test', 'key-accept-1');
    const second = decisionRequestBody(dto, 'run_test', 'key-accept-2');

    // Identical choices must be able to use different keys: accept, reject, accept again.
    expect(first.idempotencyKey).toBe('key-accept-1');
    expect(second.idempotencyKey).toBe('key-accept-2');
  });
});
