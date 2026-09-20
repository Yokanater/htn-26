/** One explicitly authorized vision capture; never loaded in production or tests. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createOpenAiIntentModel } from '@sei/reason';
import { loadRootEnv } from '../env';

loadRootEnv();
const bytes = await readFile(new URL('../../../web/public/demo/inspiration.png', import.meta.url));
const model = createOpenAiIntentModel({ model: process.env.OPENAI_MODEL_VISION || 'gpt-4.1-mini' });
const draft = await model.draft(
  {
    domain: 'outfit',
    source: { kind: 'image', mimeType: 'image/png', bytes },
    repairFeedback: null,
  },
  { signal: AbortSignal.timeout(60000) },
);
await writeFile(
  new URL('../../../../demo/vision-recording.json', import.meta.url),
  JSON.stringify(
    {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      capturedAt: new Date().toISOString(),
      model: process.env.OPENAI_MODEL_VISION || 'gpt-4.1-mini',
      draft,
    },
    null,
    2,
  ),
);
console.log(
  'Recorded vision categories:',
  draft.slots.map((s) => s.category),
);
