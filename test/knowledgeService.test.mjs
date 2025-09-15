import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from '../dist/db/database.js';
import KnowledgeService from '../dist/services/knowledgeService.js';
import { HashEmbedder } from '../dist/embedding/embeddings.js';

let tmpDir, db, ks, emb;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tfa-ks-'));
  db = new Database({ dbFile: join(tmpDir, 'kr.sqlite'), vectorDir: join(tmpDir, 'vec') });
  await db.init();
  emb = new HashEmbedder(256);
  ks = new KnowledgeService(db, emb);
});

after(async () => {
  await db.persist();
  await rm(tmpDir, { recursive: true, force: true });
});

test('knowledge service: add + embed + search', async () => {
  const a = await ks.addAtom({ type: 'Entity', text_or_payload: 'User profile page', origin: 'manual', tags: ['domain:users'] });
  const b = await ks.addAtom({ type: 'Entity', text_or_payload: 'Order checkout flow', origin: 'manual', tags: ['domain:orders'] });

  const hits = await ks.searchText('User profile page', { topK: 2 });
  assert.ok(hits.length >= 1);
  const atoms = ks.listAtoms();
  const map = Object.fromEntries(atoms.map(x => [x.id, x.text_or_payload]));
  const texts = hits.map(h => map[h.subjectId]);
  assert.ok(texts.includes('User profile page'));
});

test('knowledge service: reembed single', async () => {
  const id = await ks.addAtom({ type: 'Entity', text_or_payload: 'Shopping cart', origin: 'manual' });
  const res = await ks.reembedAtom(id);
  assert.equal(res.subjectId, id);
});

test('knowledge service: bulk add + sql query', async () => {
  const ids = await ks.addAtoms([
    { type: 'Entity', text_or_payload: 'Billing page', origin: 'manual', tags: ['domain:billing'] },
    { type: 'Entity', text_or_payload: 'Invoices list', origin: 'manual', tags: ['domain:billing'] },
  ]);
  assert.equal(ids.length, 2);
  const rows = ks.query('SELECT id, type, text_or_payload FROM atoms WHERE text_or_payload LIKE $p', { $p: '%Billing%' });
  assert.ok(rows.length >= 1);
});
