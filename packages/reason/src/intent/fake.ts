/** Deterministic IntentModel for tests and offline demos. Owner: L3. No provider calls.
 * Default drafts mirror fixtures/seed/{outfit,setup}/brief.json; text and image get the same draft.
 */
import type { ShoppingDomain } from '@sei/contracts';
import {
  type IntentModel,
  type IntentModelCallContext,
  IntentModelError,
  type IntentModelRequest,
  type VisionDraft,
} from './ports';

const FAKE_DRAFTS: Record<ShoppingDomain, VisionDraft> = {
  outfit: {
    slots: [
      {
        category: 'top',
        description: 'neutral top matching the inspiration',
        visualAttributes: ['neutral', 'relaxed fit'],
        requiredSuggested: true,
        confidence: 'high',
        region: null,
      },
      {
        category: 'bag',
        description: 'neutral bag matching the inspiration',
        visualAttributes: ['neutral', 'structured'],
        requiredSuggested: true,
        confidence: 'medium',
        region: null,
      },
    ],
    ambiguityNote: null,
  },
  setup: {
    slots: [
      {
        category: 'desk',
        description: 'neutral desk matching the inspiration',
        visualAttributes: ['neutral', 'light wood'],
        requiredSuggested: true,
        confidence: 'high',
        region: null,
      },
      {
        category: 'lighting',
        description: 'neutral lighting matching the inspiration',
        visualAttributes: ['neutral', 'warm light'],
        requiredSuggested: true,
        confidence: 'medium',
        region: null,
      },
    ],
    ambiguityNote: null,
  },
};

/** Fresh copy of the default draft for a domain. */
export function fakeVisionDraft(domain: ShoppingDomain): VisionDraft {
  return structuredClone(FAKE_DRAFTS[domain]);
}

/** One scripted response; `unknown` lets tests return output that violates the strict schema. */
export type FakeIntentStep =
  | { kind: 'draft'; draft: unknown }
  | { kind: 'error'; error: IntentModelError }
  | { kind: 'hang' };

export class FakeIntentModel implements IntentModel {
  readonly requests: IntentModelRequest[] = [];
  private readonly script: FakeIntentStep[];

  /** Steps are consumed in order; afterwards every call returns the domain's default draft. */
  constructor(script: readonly FakeIntentStep[] = []) {
    this.script = [...script];
  }

  async draft(request: IntentModelRequest, context: IntentModelCallContext): Promise<VisionDraft> {
    this.requests.push(request);
    if (context.signal.aborted) throw new IntentModelError('aborted', 'Model call aborted');
    const step = this.script.shift();
    if (!step) return fakeVisionDraft(request.domain);
    switch (step.kind) {
      case 'draft':
        return structuredClone(step.draft) as VisionDraft;
      case 'error':
        throw step.error;
      case 'hang':
        return new Promise<VisionDraft>((_, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new IntentModelError('aborted', 'Model call aborted')),
            { once: true },
          );
        });
    }
  }
}
