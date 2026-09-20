/** Separate local demo server. No production provider or database is changed. */
import { serve } from '@hono/node-server';
import { createApp } from '../app';
import { loadRootEnv } from '../env';
import { createDemoProviders, DEMO_ENV } from './providers';

loadRootEnv();
if (!process.env.OPENAI_API_KEY)
  throw new Error('Configure OPENAI_API_KEY before the live-image demo.');
const { providers, metadata } = await createDemoProviders(
  process.env.OPENAI_API_KEY,
  process.env.OPENAI_MODEL_VISION || 'gpt-4.1-mini',
);
const app = createApp(DEMO_ENV, providers);
app.get('/api/demo', (c) => c.json(metadata));
serve(
  { fetch: app.fetch, port: Number(process.env.DEMO_PORT || 3002), hostname: '127.0.0.1' },
  (info) => console.log(`Allbirds rehearsal server: http://127.0.0.1:${info.port}`),
);
