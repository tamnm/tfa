import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from '../dist/db/database.js';
import TaskService from '../dist/services/taskService.js';

let tmpDir, db, svc;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tfa-tsvc-'));
  db = new Database({ dbDir: tmpDir });
  await db.init();
  svc = new TaskService(db);
});

after(async () => {
  await db.persist();
  await rm(tmpDir, { recursive: true, force: true });
});

test('pickNext honors priority with manual tasks', async () => {
  const job = 'JOB:test-priority';
  // Ensure job exists
  svc.createJob({ id: job, title: 'Priority Test' });
  svc.createTask({ job, type: 'Atomize', target: 'u1', fingerprint: 'u1' });
  svc.createTask({ job, type: 'Synthesize', target: 'all', fingerprint: 'syn' });
  svc.createTask({ job, type: 'Bootstrap', target: 'all', fingerprint: 'boot' });
  const next = svc.pickNext(job);
  assert.equal(next.type, 'Bootstrap');
});

test('create/complete via service with result payload', async () => {
  const job = 'JOB:svc';
  svc.createJob({ id: job, title: 'Svc' });
  const t = svc.createTask({ job, type: 'Atomize', target: 'unit-X', fingerprint: 'fp-x', description: 'x', dedupe: true });
  assert.equal(t.job, job);
  const picked = svc.pickNext(job);
  assert.ok(picked);
  const done = svc.completeTask(t.id, { ok: true, processed: 10 });
  assert.equal(done.status, 'SUCCEEDED');
  assert.ok(done.result_json && done.result_json.includes('processed'));
});

test('updateProgress sets status, cursor and notes', async () => {
  const job = 'JOB:progress';
  svc.createJob({ id: job });
  const t = svc.createTask({ job, type: 'Atomize', target: 'u1', fingerprint: 'p1' });
  const upd = svc.updateProgress(t.id, { status: 'RUNNING', cursor: { offset: 10 }, note: 'started' });
  assert.equal(upd.status, 'RUNNING');
  assert.ok(svc.getCursor(t.id).includes('offset'));
  const notes = svc.listNotes(t.id, 10);
  assert.ok(notes.find(n => n.note === 'started'));
});
