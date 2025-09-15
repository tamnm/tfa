// TaskService: thin domain layer over Database for task-list operations
// Implements selection heuristics per framework and convenience seeding

const DEFAULT_PRIORITY = [
  'Repair',
  'Bootstrap',
  // treat Analyze as same tier as Atomize when present
  'Atomize', 'Analyze',
  'Synthesize',
  'QA',
  'Publish'
];

import type { Job, Task, TaskNote } from '../types/domain.js';
import { Database } from '../db/database.js';

export class TaskService {
  db: Database;
  priorityOrder: string[];
  constructor(db: Database, opts: { priorityOrder?: string[] } = {}) {
    if (!db) throw new Error('TaskService requires a db');
    this.db = db;
    this.priorityOrder = opts.priorityOrder || DEFAULT_PRIORITY;
  }

  // Create with optional dedupe on fingerprint
  createTask({ job, type, target = 'all', fingerprint, description, dedupe = true }: { job: string; type: string; target?: string; fingerprint?: string; description?: string; dedupe?: boolean }): Task {
    return this.db.createTask({ job, type, target, fingerprint, description, dedupe });
  }

  listOpen(job?: string): Task[] {
    return this.db.getOpenTasks({ job });
  }

  getTask({ id, job }: { id?: string; job?: string } = {}): Task | null {
    return this.db.getTask({ id, job });
  }

  completeTask(id: string, result?: unknown): Task | null {
    return this.db.completeTask(id, result);
  }

  // Pick next task by priority order
  pickNext(job?: string): Task | null {
    const tasks = this.listOpen(job);
    if (!tasks.length) return null;
    const order = new Map(this.priorityOrder.map((t, i) => [t, i]));
    tasks.sort((a, b) => {
      const pa = order.has(a.type) ? order.get(a.type) : Number.MAX_SAFE_INTEGER;
      const pb = order.has(b.type) ? order.get(b.type) : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      // stable fallback by created_at then id
      if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
      return a.id.localeCompare(b.id);
    });
    return tasks[0];
  }

  updateTaskStatus(id: string, status: string): Task | null {
    return this.db.updateTaskStatus(id, status);
  }

  updateProgress(id: string, { status, cursor, note }: { status?: string; cursor?: unknown; note?: string } = {}): Task | null {
    return this.db.updateTaskProgress(id, { status, cursor, note });
  }

  setCursor(id: string, cursor: unknown): Task | null { return this.db.setTaskCursor(id, cursor); }
  getCursor(id: string): string | null { return this.db.getTaskCursor(id); }

  addNote(id: string, note: string): TaskNote { return this.db.addTaskNote(id, note); }
  listNotes(id: string, limit?: number): TaskNote[] { return this.db.listTaskNotes(id, limit); }

  // Jobs
  createJob(job: { id: string; title?: string; instructions?: string; params?: unknown; status?: string }): Job { return this.db.createJob(job); }
  getJob(id: string): Job | null { return this.db.getJob(id); }
  updateJob(id: string, updates: { title?: string; instructions?: string; params?: unknown; status?: string }): Job { return this.db.updateJob(id, updates); }
  listJobs(filter?: { status?: string }): Job[] { return this.db.listJobs(filter); }
}

export default TaskService;
