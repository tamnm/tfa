import './setupLogger.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransformersEmbedder } from '../dist/embedding/embeddings.js';

test('transformers embedder respects injected pipeline factory', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'tfa-xform-'));
  let initCount = 0;

  const embedder = new TransformersEmbedder({
    modelId: 'mock-model',
    cacheDir,
    quantized: true,
    normalize: true,
    pipelineFactory: async () => {
      initCount += 1;
      return async (text) => ({ data: vectorFor(text) });
    }
  });

  t.after(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  const profile = await embedder.embed('User profile page');
  const profile2 = await embedder.embed('Profile of the user');
  const checkout = await embedder.embed('Payment checkout flow');

  const batch = await embedder.embedBatch(['Another profile page', 'Checkout sequence']);
  assert.equal(batch.length, 2);
  assert.equal(initCount, 1, 'pipeline factory should be invoked once');

  const simProfile = TransformersEmbedder.cosineSimilarity(profile, profile2);
  const simCheckout = TransformersEmbedder.cosineSimilarity(profile, checkout);

  assert.ok(simProfile > simCheckout, `expected profile similarity (${simProfile}) to exceed checkout similarity (${simCheckout})`);
});

const MODEL = process.env.TFA_EMBED_MODEL;
const CACHE = process.env.TFA_EMBED_CACHE;

if (!MODEL) {
  test('transformers embedder integration (requires TFA_EMBED_MODEL)', { skip: true }, () => {});
} else {
  test('transformers embedder integration similarity check', async () => {
    const E = new TransformersEmbedder({ modelId: MODEL, cacheDir: CACHE, quantized: true, normalize: true });
    const a = await E.embed('User profile page');
    const a2 = await E.embed('Profile of the user');
    const b = await E.embed('Payment checkout flow');
    const simAA2 = TransformersEmbedder.cosineSimilarity(a, a2);
    const simAB = TransformersEmbedder.cosineSimilarity(a, b);
    assert.ok(simAA2 > simAB, `simAA2=${simAA2} should be > simAB=${simAB}`);
  });
}

function vectorFor(text) {
  const isProfile = /profile/i.test(text);
  return Float32Array.from(
    isProfile ? [0.9, 0.05, 0.05] : [0.05, 0.05, 0.9]
  );
}
