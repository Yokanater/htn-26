/** Run view state. Owner: L3 (S2-L3-1). Design v3 §5.3, §8.
 * The view belongs to one brief revision and one run. Events from another brief, revision or run,
 * or out of order, are ignored, so a superseded run can never change what the shopper sees.
 */
import type { IntentBrief } from '@sei/contracts';
import type { CollectionRunEvent, CollectionRunResult, RunStage, StageStatus } from './types';

export interface CollectionRunView {
  briefId: string;
  briefRevision: number;
  runId: string | null;
  phase: 'idle' | 'running' | 'done';
  stages: Partial<Record<RunStage, StageStatus>>;
  result: CollectionRunResult | null;
  lastSeq: number;
}

export function initialRunView(
  brief: Pick<IntentBrief, 'id' | 'revision'>,
  runId: string | null,
): CollectionRunView {
  return {
    briefId: brief.id,
    briefRevision: brief.revision,
    runId,
    phase: runId ? 'running' : 'idle',
    stages: {},
    result: null,
    lastSeq: 0,
  };
}

export function applyRunEvent(
  view: CollectionRunView,
  event: CollectionRunEvent,
): CollectionRunView {
  if (
    view.runId === null ||
    event.runId !== view.runId ||
    event.briefId !== view.briefId ||
    event.briefRevision !== view.briefRevision ||
    event.seq <= view.lastSeq ||
    view.phase === 'done'
  ) {
    return view;
  }
  if (event.type === 'stage') {
    return { ...view, stages: { ...view.stages, [event.stage]: event.status }, lastSeq: event.seq };
  }
  if (
    event.result.runId !== view.runId ||
    event.result.briefId !== view.briefId ||
    event.result.briefRevision !== view.briefRevision
  ) {
    return view;
  }
  return { ...view, phase: 'done', result: event.result, lastSeq: event.seq };
}

/** Folds an event stream into the view for the current brief revision and run. */
export function deriveRunView(
  brief: Pick<IntentBrief, 'id' | 'revision'>,
  runId: string | null,
  events: readonly CollectionRunEvent[],
): CollectionRunView {
  return events.reduce(applyRunEvent, initialRunView(brief, runId));
}
