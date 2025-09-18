// Portable metadata DB (sql.js) + vector search (brute-force)
// Schema matches simple v1 ERD (atoms/tags/embeddings + tasks)

import { promises as fs } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createLogger, Logger } from '../utils/logger.js';
import type { AtomRow, EmbeddingSummary, Job, KnnHit, Task, TaskNote } from '../types/domain.js';

const requireCJS = createRequire(import.meta.url);

function nowIso() { return new Date().toISOString(); }

function ensureFloat32(arr: unknown): Float32Array {
  if (arr instanceof Float32Array) return arr;
  if (Array.isArray(arr) || ArrayBuffer.isView(arr)) return new Float32Array(arr as any);
  throw new Error('vector must be Float32Array or array-like');
}

function l2Norm(vec: Float32Array) {
  let s = 0.0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  return Math.sqrt(s);
}

function cosineSim(a: Float32Array, b: Float32Array, normA: number, normB: number) {
  let dot = 0.0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (normA * normB);
}

export class Database {
  dbFile: string;
  sql: any;
  SQL: any;
  private logger: Logger;

  constructor(opts: { dbDir?:string; logger?: Logger } = {}) {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = resolve(moduleDir, '..', '..');
    const configuredDir = opts.dbDir;
    const dir = configuredDir
      ? (isAbsolute(configuredDir) ? configuredDir : resolve(projectRoot, configuredDir))
      : resolve(projectRoot, '.tfa', 'data');
    this.dbFile =  resolve(dir, 'db.sqlite' );
    this.sql = null; // SQL.js Database instance
    this.SQL = null; // SQL.js module
    this.logger = opts.logger ?? createLogger('Database');
    this.logger.info(`using data directory: ${dir}`);
    this.logger.info(`SQLite path resolved to: ${this.dbFile}`);
  }

  async init() {
    await fs.mkdir(dirname(this.dbFile), { recursive: true });

    const initSqlJs: any = (await import('sql.js')).default;
    this.SQL = await initSqlJs({
      locateFile: (file) => requireCJS.resolve('sql.js/dist/' + file)
    });

    // load existing db or create new
    try {
      const buf = await fs.readFile(this.dbFile);
      this.sql = new this.SQL.Database(new Uint8Array(buf));
    } catch (e) {
      this.sql = new this.SQL.Database();
      this._migrate();
      await this.persist();
    }

    // try to set pragmas helpful for performance
    try { this.sql.exec('PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF;'); } catch {}
  }

  _migrate() {
    const stmts = [
      // jobs
      `CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT,
        instructions TEXT,
        params_json TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);`,
      // tasks
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        job TEXT NOT NULL,
        type TEXT NOT NULL,
        target TEXT DEFAULT 'all',
        fingerprint TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        current_cursor TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(job, type, target, fingerprint) ON CONFLICT IGNORE
      );`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks(status, created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_job ON tasks(job, created_at);`,

      // task notes
      `CREATE TABLE IF NOT EXISTS task_notes (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id, created_at);`,

      // atoms
      `CREATE TABLE IF NOT EXISTS atoms (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        text_or_payload TEXT,
        source TEXT,
        locator TEXT,
        timestamp TEXT,
        confidence REAL DEFAULT 1.0,
        origin TEXT,
        target TEXT,
        subject_atom_id TEXT,
        predicate TEXT,
        object_atom_id TEXT,
        evidence_json TEXT,
        refutes_atom_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_atoms_type ON atoms(type);`,
      `CREATE INDEX IF NOT EXISTS idx_atoms_source ON atoms(source);`,
      `CREATE INDEX IF NOT EXISTS idx_atoms_origin ON atoms(origin);`,

      // tags
      `CREATE TABLE IF NOT EXISTS atom_tags (
        atom_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY(atom_id, tag)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_atom_tags_tag ON atom_tags(tag);`,

      // embeddings (store vectors for rebuilds / fallback scoring)
      `CREATE TABLE IF NOT EXISTS embeddings (
        subject_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector BLOB NOT NULL,
        norm REAL NOT NULL,
        content_hash TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(subject_id, model)
      );`
    ];
    this.sql.exec('BEGIN');
    for (const s of stmts) this.sql.exec(s);
    this.sql.exec('COMMIT');
    // Backfill migration: add result_json if missing
    try { this.sql.exec(`ALTER TABLE tasks ADD COLUMN result_json TEXT;`); } catch {}
    // Backfill migration: add current_cursor
    try { this.sql.exec(`ALTER TABLE tasks ADD COLUMN current_cursor TEXT;`); } catch {}
  }

  async persist() {
    const data = this.sql.export();
    await fs.writeFile(this.dbFile, Buffer.from(data as any));
  }

  // ---------- Task-list (4 ops) ----------
  createTask({ job, type, target = 'all', fingerprint = null, description = null, dedupe = true }: { job: string; type: string; target?: string; fingerprint?: string | null; description?: string | null; dedupe?: boolean }): Task {
    if (!job || !type) throw new Error('job and type are required');
    const now = nowIso();
    const id = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    // ensure job exists (auto-create minimal)
    const j = this.sql.exec(`SELECT id FROM jobs WHERE id=$id;`, { $id: job });
    if (!j[0]?.values?.length) {
      this.sql.exec(`INSERT INTO jobs(id, status, created_at, updated_at) VALUES ($id, 'PENDING', $now, $now);`, { $id: job, $now: now });
    }
    const stmt = this.sql.prepare(`
      INSERT OR IGNORE INTO tasks (id, job, type, target, fingerprint, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?);
    `);
    stmt.run([id, job, type, target, fingerprint, description, now, now]);
    stmt.free();
    if (dedupe && fingerprint) {
      const dup = this.sql.exec(`SELECT * FROM tasks WHERE status!='SUCCEEDED' AND job=$job AND type=$type AND target=$target AND fingerprint=$fp LIMIT 1;`, {
        $job: job, $type: type, $target: target, $fp: fingerprint
      });
      if (dup[0]?.values?.length) return rowToObject<Task>(dup[0]);
    }
    const row = this.sql.exec(`SELECT * FROM tasks WHERE id=$id;`, { $id: id });
    return rowToObject<Task>(row[0]);
  }

  getOpenTasks({ job }: { job?: string } = {}): Task[] {
    const where = job ? `WHERE status!='SUCCEEDED' AND job=$job` : `WHERE status!='SUCCEEDED'`;
    const res = this.sql.exec(`SELECT * FROM tasks ${where} ORDER BY created_at ASC;`, job ? { $job: job } : undefined);
    return tableToObjects<Task>(res[0]);
  }

  getTask({ id, job }: { id?: string; job?: string } = {}): Task | null {
    if (id) {
      const res = this.sql.exec(`SELECT * FROM tasks WHERE id=$id;`, { $id: id });
      return res[0]?.values?.length ? rowToObject<Task>(res[0]) : null;
    }
    const where = job ? `WHERE status!='SUCCEEDED' AND job=$job` : `WHERE status!='SUCCEEDED'`;
    const res = this.sql.exec(`SELECT * FROM tasks ${where} ORDER BY created_at ASC LIMIT 1;`, job ? { $job: job } : undefined);
    return res[0]?.values?.length ? rowToObject<Task>(res[0]) : null;
  }

  completeTask(id: string, result?: unknown): Task | null {
    const now = nowIso();
    let resultJson = null;
    if (typeof result !== 'undefined') {
      try { resultJson = JSON.stringify(result); } catch { resultJson = String(result); }
    }
    this.sql.exec(`UPDATE tasks SET status='SUCCEEDED', result_json=$res, updated_at=$now WHERE id=$id;`, { $id: id, $now: now, $res: resultJson });
    const res = this.sql.exec(`SELECT * FROM tasks WHERE id=$id;`, { $id: id });
    return res[0]?.values?.length ? rowToObject<Task>(res[0]) : null;
  }

  updateTaskStatus(id: string, status: string): Task | null {
    if (!id || !status) throw new Error('id and status are required');
    const now = nowIso();
    this.sql.exec(`UPDATE tasks SET status=$st, updated_at=$now WHERE id=$id;`, { $id: id, $st: status, $now: now });
    const res = this.sql.exec(`SELECT * FROM tasks WHERE id=$id;`, { $id: id });
    return res[0]?.values?.length ? rowToObject<Task>(res[0]) : null;
  }

  setTaskCursor(id: string, cursor: unknown): Task | null {
    const now = nowIso();
    const cur = cursor == null ? null : (typeof cursor === 'string' ? cursor : JSON.stringify(cursor));
    this.sql.exec(`UPDATE tasks SET current_cursor=$cur, updated_at=$now WHERE id=$id;`, { $id: id, $cur: cur, $now: now });
    const res = this.sql.exec(`SELECT * FROM tasks WHERE id=$id;`, { $id: id });
    return res[0]?.values?.length ? rowToObject<Task>(res[0]) : null;
  }

  getTaskCursor(id: string): string | null {
    const res = this.sql.exec(`SELECT current_cursor FROM tasks WHERE id=$id;`, { $id: id });
    if (!res[0]?.values?.length) return null;
    const obj: any = rowToObject(res[0]);
    return obj.current_cursor as string | null;
  }

  addTaskNote(taskId: string, note: string): TaskNote {
    const now = nowIso();
    const id = `tn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    const stmt = this.sql.prepare(`INSERT INTO task_notes(id, task_id, note, created_at) VALUES (?, ?, ?, ?);`);
    stmt.run([id, taskId, String(note ?? '') , now]);
    stmt.free();
    return { id, task_id: taskId, note: String(note ?? ''), created_at: now };
  }

  listTaskNotes(taskId: string, limit = 50): TaskNote[] {
    const res = this.sql.exec(`SELECT * FROM task_notes WHERE task_id=$id ORDER BY created_at DESC LIMIT $lim;`, { $id: taskId, $lim: limit });
    return tableToObjects<TaskNote>(res[0]);
  }

  updateTaskProgress(id: string, { status, cursor, note }: { status?: string; cursor?: unknown; note?: string } = {}): Task | null {
    // single call to update status/cursor and append a note if provided
    this.sql.exec('BEGIN');
    try {
      let updated = null;
      if (status) updated = this.updateTaskStatus(id, status);
      if (typeof cursor !== 'undefined') updated = this.setTaskCursor(id, cursor);
      if (note) this.addTaskNote(id, note);
      this.sql.exec('COMMIT');
      return updated || this.getTask({ id });
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- Jobs CRUD ----------
  createJob({ id, title, instructions, params, status = 'PENDING' }: { id: string; title?: string; instructions?: string; params?: unknown; status?: string }): Job {
    if (!id) throw new Error('job id is required');
    const now = nowIso();
    const paramsJson = params == null ? null : JSON.stringify(params);
    this.sql.exec(`INSERT OR IGNORE INTO jobs(id, title, instructions, params_json, status, created_at, updated_at) VALUES ($id, $title, $ins, $params, $st, $now, $now);`, {
      $id: id, $title: title ?? null, $ins: instructions ?? null, $params: paramsJson, $st: status, $now: now
    });
    const res = this.sql.exec(`SELECT * FROM jobs WHERE id=$id;`, { $id: id });
    return rowToObject<Job>(res[0]);
  }

  getJob(id: string): Job | null {
    const res = this.sql.exec(`SELECT * FROM jobs WHERE id=$id;`, { $id: id });
    return res[0]?.values?.length ? rowToObject<Job>(res[0]) : null;
  }

  updateJob(id: string, { title, instructions, params, status }: { title?: string; instructions?: string; params?: unknown; status?: string } = {}): Job {
    const now = nowIso();
    const parts: string[] = [];
    const paramsObj: any = { $id: id, $now: now };
    if (typeof title !== 'undefined') { parts.push('title=$title'); paramsObj.$title = title; }
    if (typeof instructions !== 'undefined') { parts.push('instructions=$ins'); paramsObj.$ins = instructions; }
    if (typeof status !== 'undefined') { parts.push('status=$st'); paramsObj.$st = status; }
    if (typeof params !== 'undefined') { parts.push('params_json=$params'); paramsObj.$params = JSON.stringify(params); }
    if (!parts.length) return this.getJob(id);
    this.sql.exec(`UPDATE jobs SET ${parts.join(', ')}, updated_at=$now WHERE id=$id;`, paramsObj);
    return this.getJob(id)!;
  }

  listJobs({ status }: { status?: string } = {}): Job[] {
    const where = status ? 'WHERE status=$st' : '';
    const res = this.sql.exec(`SELECT * FROM jobs ${where} ORDER BY created_at DESC;`, status ? { $st: status } : undefined);
    return tableToObjects<Job>(res[0]);
  }

  // ---------- Raw SQL query (read-only) ----------
  query<T = any>(sql: string, params?: Record<string, unknown>): T[] {
    // Safety: allow only a single SELECT statement
    const trimmed = sql.trim().toLowerCase();
    if (!trimmed.startsWith('select')) throw new Error('Only SELECT queries are allowed');
    const res = this.sql.exec(sql, params as any);
    return tableToObjects<T>(res[0]);
  }

  // ---------- Knowledge (atoms/tags) ----------
  insertAtom(atom: any): string {
    const now = nowIso();
    const id = atom.id || `atom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    const stmt = this.sql.prepare(`
      INSERT INTO atoms (
        id, type, text_or_payload, source, locator, timestamp, confidence,
        origin, target, subject_atom_id, predicate, object_atom_id,
        evidence_json, refutes_atom_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run([
      id, atom.type, atom.text_or_payload ?? null, atom.source ?? null, atom.locator ?? null,
      atom.timestamp ?? null, atom.confidence ?? 1.0, atom.origin ?? null, atom.target ?? null,
      atom.subject_atom_id ?? null, atom.predicate ?? null, atom.object_atom_id ?? null,
      atom.evidence_json ? JSON.stringify(atom.evidence_json) : null,
      atom.refutes_atom_id ?? null,
      now, now
    ]);
    stmt.free();
    if (Array.isArray(atom.tags) && atom.tags.length) this.addTags(id, atom.tags);
    return id;
  }

  addTags(atomId: string, tags: string[]): void {
    if (!tags?.length) return;
    const stmt = this.sql.prepare(`INSERT OR IGNORE INTO atom_tags(atom_id, tag) VALUES (?, ?);`);
    for (const t of tags) stmt.run([atomId, String(t)]);
    stmt.free();
  }

  listAtoms({ type, tags, sourceLike, origin, target }: { type?: string; tags?: string[]; sourceLike?: string; origin?: string; target?: string } = {}): AtomRow[] {
    let sql = `SELECT a.* FROM atoms a`;
    const params: any = {};
    // No join needed; use subquery to require all tags when provided
    const where = [];
    if (type) { where.push(`a.type=$type`); params.$type = type; }
    if (origin) { where.push(`a.origin=$origin`); params.$origin = origin; }
    if (target) { where.push(`a.target=$target`); params.$target = target; }
    if (sourceLike) { where.push(`a.source LIKE $src`); params.$src = sourceLike; }
    if (tags?.length) {
      // require all tags
      const placeholders = tags.map((_, i) => `$tag${i}`);
      tags.forEach((t, i) => { params[`$tag${i}`] = String(t); });
      sql += ` WHERE a.id IN (
        SELECT atom_id FROM atom_tags WHERE tag IN (${placeholders.join(',')})
        GROUP BY atom_id HAVING COUNT(DISTINCT tag) = ${tags.length}
      )`;
      if (where.length) sql += ` AND ` + where.join(' AND ');
    } else if (where.length) {
      sql += ` WHERE ` + where.join(' AND ');
    }
    sql += ` ORDER BY a.created_at ASC;`;
    const res = this.sql.exec(sql, params);
    return tableToObjects<AtomRow>(res[0]);
  }

  insertRelation({ subjectId, predicate, objectId, source, locator, origin, target }: { subjectId: string; predicate: string; objectId: string; source?: string; locator?: string; origin?: string; target?: string }): string {
    return this.insertAtom({
      type: 'Relation', subject_atom_id: subjectId, predicate, object_atom_id: objectId,
      source, locator, origin, target
    });
  }

  // ---------- Embeddings (sql.js store + brute-force search) ----------
  async upsertEmbedding({ subjectId, model, vector, contentHash }: { subjectId: string; model: string; vector: Float32Array | number[]; contentHash?: string }): Promise<EmbeddingSummary> {
    if (!subjectId || !model) throw new Error('subjectId and model are required');
    const vec = ensureFloat32(vector);
    const dim = vec.length;
    const norm = l2Norm(vec) || 1e-12;
    // write to SQL for durability
    const stmt = this.sql.prepare(`
      INSERT INTO embeddings(subject_id, model, dim, vector, norm, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(subject_id, model) DO UPDATE SET dim=excluded.dim, vector=excluded.vector, norm=excluded.norm, content_hash=excluded.content_hash;
    `);
    stmt.run([subjectId, model, dim, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), norm, contentHash ?? null, nowIso()]);
    stmt.free();
    await this.persist();
    return { subjectId, model, dim, norm };
  }

  async searchEmbeddings({ model, vector, topK = 20, prefilter }: { model: string; vector: Float32Array | number[]; topK?: number; prefilter?: { type?: string; tags?: string[]; sourceLike?: string; origin?: string; target?: string } } = { model: '', vector: new Float32Array() }): Promise<KnnHit[]> {
    if (!model) throw new Error('model is required');
    const vec = ensureFloat32(vector);
    
    // Use brute-force search
    let candidates = await this._bruteForceKnn(model, vec, topK * 5);

    // Optional SQL prefiltering
    if (prefilter && candidates.length) {
      const ids = candidates.map(c => c.subjectId);
      const placeholders = ids.map((_, i) => `$id${i}`).join(',');
      const params = Object.fromEntries(ids.map((v, i) => [ `$id${i}`, v ]));
      let sql = `SELECT DISTINCT a.id FROM atoms a WHERE a.id IN (${placeholders})`;
      if (prefilter.type) { sql += ` AND a.type=$type`; params.$type = prefilter.type; }
      if (prefilter.origin) { sql += ` AND a.origin=$origin`; params.$origin = prefilter.origin; }
      if (prefilter.target) { sql += ` AND a.target=$target`; params.$target = prefilter.target; }
      if (prefilter.sourceLike) { sql += ` AND a.source LIKE $src`; params.$src = prefilter.sourceLike; }
      if (prefilter.tags?.length) {
        const tagPh = prefilter.tags.map((_, i) => `$tg${i}`).join(',');
        prefilter.tags.forEach((t, i) => params[`$tg${i}`] = String(t));
        sql += ` AND a.id IN (SELECT atom_id FROM atom_tags WHERE tag IN (${tagPh}) GROUP BY atom_id HAVING COUNT(DISTINCT tag)=${prefilter.tags.length})`;
      }
      const res = this.sql.exec(sql, params);
      const allowed = new Set(tableToObjects(res[0]).map(r => r.id));
      candidates = candidates.filter(c => allowed.has(c.subjectId));
    }

    // take topK by score
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, topK);
  }

  async deleteEmbeddings({ subjectId, model }: { subjectId: string; model?: string }): Promise<void> {
    if (!subjectId) throw new Error('subjectId is required');
    if (model) {
      this.sql.exec(`DELETE FROM embeddings WHERE subject_id=$id AND model=$m;`, { $id: subjectId, $m: model });
    } else {
      this.sql.exec(`DELETE FROM embeddings WHERE subject_id=$id;`, { $id: subjectId });
    }
    await this.persist();
  }



  async _bruteForceKnn(model: string, queryVec: Float32Array, k: number): Promise<KnnHit[]> {
    const res = this.sql.exec(`SELECT subject_id, dim, vector, norm FROM embeddings WHERE model=$m;`, { $m: model });
    const rows = tableToObjects(res[0]);
    const qnorm = l2Norm(queryVec) || 1e-12;
    const sims = [];
    for (const r of rows) {
      const v = new Float32Array(Buffer.from(r.vector).buffer, 0, r.dim);
      const sim = cosineSim(queryVec, v, qnorm, r.norm || l2Norm(v) || 1e-12);
      sims.push({ subjectId: r.subject_id, score: sim });
    }
    sims.sort((a, b) => b.score - a.score);
    return sims.slice(0, k);
  }


}

function rowToObject<T = any>(table: any): T {
  const cols: string[] = table.columns;
  const row: any[] = table.values[0];
  const obj: Record<string, any> = {};
  for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
  return obj as T;
}

function tableToObjects<T = any>(table: any): T[] {
  if (!table) return [] as T[];
  const cols: string[] = table.columns;
  return table.values.map((r: any[]) => {
    const o: Record<string, any> = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i];
    return o as T;
  });
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export default Database;
