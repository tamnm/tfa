import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransformersEmbedder } from '../dist/embedding/embeddings.js';

const MODEL = process.env.TFA_EMBED_MODEL;
const CACHE = process.env.TFA_EMBED_CACHE;

if (!MODEL) {
  test('transformers embedder (skipped – set TFA_EMBED_MODEL to run)', { skip: true }, () => {});
} else {
  test('transformers embedder produces higher sim for similar text', async () => {
    const E = new TransformersEmbedder({ modelId: MODEL, cacheDir: CACHE, quantized: true, normalize: true });
    const a = await E.embed('User profile page');
    const a2 = await E.embed('Profile of the user');
    const b = await E.embed('Payment checkout flow');
    const simAA2 = cosine(a, a2);
    const simAB = cosine(a, b);
    assert.ok(simAA2 > simAB, `simAA2=${simAA2} should be > simAB=${simAB}`);
  });
}

function cosine(x, y) {
  let dot = 0, nx = 0, ny = 0;
  for (let i = 0; i < x.length; i++) { dot += x[i]*y[i]; nx += x[i]*x[i]; ny += y[i]*y[i]; }
  return dot / (Math.sqrt(nx) * Math.sqrt(ny) || 1);
}

