export type TaskStatus = 'PENDING' | 'RUNNING' | 'BLOCKED' | 'SUCCEEDED';

export interface Task {
  id: string;
  job: string;
  type: string;
  target: string | null;
  fingerprint: string | null;
  description: string | null;
  status: TaskStatus;
  current_cursor: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

export type JobStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface Job {
  id: string;
  title: string | null;
  instructions: string | null;
  params_json: string | null;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskNote {
  id: string;
  task_id: string;
  note: string;
  created_at: string;
}

export type AtomType = 'Fact' | 'Entity' | 'Relation' | 'Metric' | 'Quote' | 'Event' | 'Insight' | 'Decision';

export interface AtomRow {
  id: string;
  type: AtomType | string;
  text_or_payload: string | null;
  source: string | null;
  locator: string | null;
  timestamp: string | null;
  confidence: number | null;
  origin: string | null;
  target: string | null;
  subject_atom_id: string | null;
  predicate: string | null;
  object_atom_id: string | null;
  evidence_json: string | null;
  refutes_atom_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmbeddingSummary {
  subjectId: string;
  model: string;
  dim: number;
  norm: number;
}

export interface KnnHit {
  subjectId: string;
  score: number;
}

