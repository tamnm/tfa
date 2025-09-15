import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from '../dist/db/database.js';

let tmpDir, db;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tfa-dbq-'));
  db = new Database({ dbFile: join(tmpDir, 'kr.sqlite'), vectorDir: join(tmpDir, 'vec') });
  await db.init();
  // Seed atoms and tags
  const a1 = db.insertAtom({ type: 'Entity', text_or_payload: 'Billing page', origin: 'manual' });
  const a2 = db.insertAtom({ type: 'Entity', text_or_payload: 'Invoices list', origin: 'manual' });
  const a3 = db.insertAtom({ type: 'Fact', text_or_payload: 'Uses OAuth', origin: 'manual' });
  db.addTags(a1, ['domain:billing']);
  db.addTags(a2, ['domain:billing']);
  db.addTags(a3, ['domain:auth']);
});

after(async () => {
  await db.persist();
  await rm(tmpDir, { recursive: true, force: true });
});

test('db.query: basic select with params', async () => {
  const rows = db.query('SELECT id, type FROM atoms WHERE type = $t', { $t: 'Entity' });
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length >= 2);
  for (const r of rows) {
    assert.equal(r.type, 'Entity');
    assert.ok(typeof r.id === 'string');
  }
});

test('db.query: LIKE with parameter', async () => {
  const rows = db.query('SELECT id, text_or_payload FROM atoms WHERE text_or_payload LIKE $p', { $p: '%Billing%' });
  assert.ok(rows.length >= 1);
  const texts = rows.map(r => r.text_or_payload);
  assert.ok(texts.some(t => /Billing/.test(t)));
});

test('db.query: join with tags', async () => {
  const rows = db.query(
    'SELECT a.id, a.type FROM atoms a JOIN atom_tags t ON t.atom_id=a.id WHERE t.tag=$tag',
    { $tag: 'domain:billing' }
  );
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.ok(typeof r.id === 'string');
});

test('db.query: rejects non-SELECT', async () => {
  assert.throws(() => db.query('DELETE FROM atoms WHERE 1=1')), /Only SELECT/;
});

