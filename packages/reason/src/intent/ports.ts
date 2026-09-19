/** Seam between the intent interpreter and model adapters. Owner: L3. Do not edit during S1-L3-1. */
import type { ShoppingDomain } from '@sei/contracts';
import { z } from 'zod';

/** Strict LLM schema: nullable required fields only. Length bounds are enforced by the mapper. */
export const VisionSlotDraftSchema = z.strictObject({
  category: z.string(),
  description: z.string(),
  visualAttributes: z.array(z.string()),
  requiredSuggested: z.boolean(),
  confidence: z.enum(['low', 'medium', 'high']),
  region: z
    .strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
});
export const VisionDraftSchema = z.strictObject({
  slots: z.array(VisionSlotDraftSchema),
  ambiguityNote: z.string().nullable(),
});
export type VisionDraft = z.infer<typeof VisionDraftSchema>;

export type IntentModelSource =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Uint8Array };

export interface IntentModelRequest {
  domain: ShoppingDomain;
  source: IntentModelSource;
  /** Schema-issue messages for a repair attempt (already escaped and capped). Null on attempt 1. */
  repairFeedback: string | null;
}
export interface IntentModelCallContext {
  signal: AbortSignal;
}

export type IntentModelErrorKind =
  | 'refusal' | 'incomplete' | 'invalid_output' | 'transport' | 'timeout' | 'aborted';

export class IntentModelError extends Error {
  readonly kind: IntentModelErrorKind;
  readonly issues: readonly string[];
  constructor(kind: IntentModelErrorKind, message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'IntentModelError';
    this.kind = kind;
    this.issues = issues;
  }
}

export interface IntentModel {
  /** One logical model call; transport retries are the adapter's business. Throws IntentModelError. */
  draft(request: IntentModelRequest, context: IntentModelCallContext): Promise<VisionDraft>;
}
