/**
 * Guard for the repo-wide zod decision (AGENTS.md "Zod decision"): zod 4.4.3, the exact version
 * @browserbasehq/stagehand depends on, must keep working with openai's `zodTextFormat`
 * (OpenAIReasoner, design §6.3). No network. Owner after bootstrap: L3.
 */
import { zodTextFormat } from 'openai/helpers/zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('zod x openai/helpers/zod', () => {
  it('builds a strict text format for a schema with nullable fields', () => {
    const format = zodTextFormat(z.object({ a: z.string().nullable() }), 'x');
    expect(format.type).toBe('json_schema');
    expect(format.name).toBe('x');
    expect(format.strict).toBe(true);
    expect(format.schema).toMatchObject({
      type: 'object',
      required: ['a'],
      additionalProperties: false,
    });
  });

  it('handles nested objects, arrays, and enums', () => {
    const schema = z.object({
      items: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['fact', 'inference']),
          reasoning: z.string().nullable(),
        }),
      ),
    });
    const format = zodTextFormat(schema, 'nested');
    expect(format.$parseRaw('{"items":[{"id":"ev_1","kind":"fact","reasoning":null}]}')).toEqual({
      items: [{ id: 'ev_1', kind: 'fact', reasoning: null }],
    });
  });
});
