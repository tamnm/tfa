import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from '../dist/db/database.js';
import { HashEmbedder } from '../dist/embedding/embeddings.js';

let tmpDir, db;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tfa-emb-'));
  db = new Database({ dbDir: tmpDir });
  await db.init();
});

after(async () => {
  await db.persist();
  await rm(tmpDir, { recursive: true, force: true });
});

test('hash embedder: similar texts rank higher', async () => {
  const E = new HashEmbedder(32);
  const a = db.insertAtom({ type: 'Entity', text_or_payload: 'User list endpoint', origin: 'manual' });
  const b = db.insertAtom({ type: 'Entity', text_or_payload: 'Payment checkout flow', origin: 'manual' });
  const va = await E.embed('List users');
  const vb = await E.embed('Checkout shopping cart');
  await db.upsertEmbedding({ subjectId: a, model: E.modelId, vector: va });
  await db.upsertEmbedding({ subjectId: b, model: E.modelId, vector: vb });

  const q = await E.embed('List all users');
  const res = await db.searchEmbeddings({ model: E.modelId, vector: q, topK: 2 });
  assert.equal(res.length, 2);
  assert.equal(res[0].subjectId, a);
});
