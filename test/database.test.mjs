import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from '../dist/db/database.js';

let tmpDir;
let dbFile;
let vecDir;
let db;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tfa-db-'));
  dbFile = join(tmpDir, 'kr.sqlite');
  vecDir = join(tmpDir, 'vectors');
  db = new Database({ dbFile, vectorDir: vecDir });
  await db.init();
});

after(async () => {
  await db.persist();
  await rm(tmpDir, { recursive: true, force: true });
});

test('tasks: create, dedupe, get, complete', async () => {
  // create
  const t1 = db.createTask({ job: 'JOB:demo', type: 'Bootstrap', target: 'all', fingerprint: 'abc', description: 'first', dedupe: true });
  assert.equal(t1.job, 'JOB:demo');
  assert.equal(t1.status, 'PENDING');

  // dedupe by same fp
  const t2 = db.createTask({ job: 'JOB:demo', type: 'Bootstrap', target: 'all', fingerprint: 'abc', description: 'dup', dedupe: true });
  assert.equal(t2.id, t1.id);

  // another task different fp
  const t3 = db.createTask({ job: 'JOB:demo', type: 'Atomize', target: 'u1', fingerprint: 'def', description: 'u1' });
  assert.notEqual(t3.id, t1.id);

  // getOpenTasks
  const openAll = db.getOpenTasks();
  assert.ok(openAll.length >= 2);
  const openJob = db.getOpenTasks({ job: 'JOB:demo' });
  assert.ok(openJob.length >= 2);

  // getTask by id
  const g1 = db.getTask({ id: t3.id });
  assert.equal(g1.id, t3.id);

  // complete
  const done = db.completeTask(t3.id);
  assert.equal(done.status, 'SUCCEEDED');
  const stillOpen = db.getOpenTasks({ job: 'JOB:demo' });
  assert.ok(stillOpen.find(x => x.id === t1.id));
  assert.ok(!stillOpen.find(x => x.id === t3.id));
});

test('atoms: insert, tag, list filters', async () => {
  const a1 = db.insertAtom({ type: 'Entity', text_or_payload: 'getUsers', source: 'src/api/user.ts', locator: 'L10-L20', origin: 'session:1', target: 'all', tags: ['kind:function', 'domain:users'] });
  const a2 = db.insertAtom({ type: 'Fact', text_or_payload: 'GET /users exists', source: 'src/api/user.ts', locator: 'L20-L30', origin: 'session:1', target: 'all', tags: ['layer:api', 'domain:users'] });
  assert.ok(a1 && a2);

  // type filter
  const ents = db.listAtoms({ type: 'Entity' });
  assert.ok(ents.find(x => x.id === a1));
  assert.ok(!ents.find(x => x.id === a2));

  // tag filter (all tags must match)
  const users = db.listAtoms({ tags: ['domain:users'] });
  assert.ok(users.length >= 2);
  const both = db.listAtoms({ tags: ['domain:users', 'layer:api'] });
  assert.ok(both.length === 1 && both[0].id === a2);

  // sourceLike filter
  const fromApi = db.listAtoms({ sourceLike: 'src/api/%' });
  assert.ok(fromApi.length >= 2);
});

test('relations: insertRelation creates Relation atom', async () => {
  const subj = db.insertAtom({ type: 'Entity', text_or_payload: 'A', source: 'src/a.ts', origin: 'manual' });
  const obj = db.insertAtom({ type: 'Entity', text_or_payload: 'B', source: 'src/b.ts', origin: 'manual' });
  const rel = db.insertRelation({ subjectId: subj, predicate: 'calls', objectId: obj, source: 'src/a.ts', origin: 'manual' });
  const rels = db.listAtoms({ type: 'Relation' });
  assert.ok(rels.find(r => r.id === rel));
});

test('embeddings: upsert and search (brute-force fallback valid)', async () => {
  // Two atoms and embeddings
  const id1 = db.insertAtom({ type: 'Entity', text_or_payload: 'Vec1', origin: 'manual' });
  const id2 = db.insertAtom({ type: 'Entity', text_or_payload: 'Vec2', origin: 'manual' });
  const v1 = new Float32Array([1, 0, 0, 0]);
  const v2 = new Float32Array([0, 1, 0, 0]);
  await db.upsertEmbedding({ subjectId: id1, model: 'm0', vector: v1 });
  await db.upsertEmbedding({ subjectId: id2, model: 'm0', vector: v2 });

  const q = new Float32Array([1, 0, 0, 0]);
  const res = await db.searchEmbeddings({ model: 'm0', vector: q, topK: 1 });
  assert.equal(res.length, 1);
  assert.equal(res[0].subjectId, id1);
});
