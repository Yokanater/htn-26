/**
 * Records confirmed briefs as consented observations. Owner: L4 (S3).
 *
 * §6.2 counts every consented session with a confirmed brief, not only those that chose a
 * product. A confirmation becomes eligible the moment both facts hold, which happens either
 * way round: a shopper may confirm and then opt in, or opt in and then confirm another
 * revision. Both routes call this, so neither ordering is lost from the denominator.
 */
import { type ConsentRecord, DemandEventSchema, type IntentBrief, newId } from '@sei/contracts';
import type { PrivateDemandLedger } from './demand';

/** One observation per brief revision per consent version; a re-grant is a new contribution. */
export async function recordConfirmation(
  ledger: PrivateDemandLedger,
  sessionId: string,
  brief: IntentBrief,
  consent: ConsentRecord,
  occurredAt: string,
): Promise<void> {
  if (consent.state !== 'granted' || brief.status !== 'confirmed') return;
  const event = DemandEventSchema.parse({
    id: newId('evt_'),
    sessionId,
    briefId: brief.id,
    briefRevision: brief.revision,
    consentVersion: consent.version,
    occurredAt,
    sampleOrigin: brief.sampleOrigin,
    kind: 'brief_confirmed',
    matchId: null,
    selections: [],
    rejectionReason: null,
  });
  await ledger.append(event, `brief_confirmed:${brief.id}:${brief.revision}:${consent.version}`);
}
