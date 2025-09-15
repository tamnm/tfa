import type { AtomRow, EmbeddingSummary, KnnHit } from '../types/domain.js';
import { Database } from '../db/database.js';
import type { EmbeddingsGenerator } from '../embedding/embeddings.js';

export interface AddAtomInput {
  id?: string;
  type: string;
  text_or_payload?: string | null;
  source?: string | null;
  locator?: string | null;
  timestamp?: string | null;
  confidence?: number | null;
  origin?: string | null;
  target?: string | null;
  subject_atom_id?: string | null;
  predicate?: string | null;
  object_atom_id?: string | null;
  evidence_json?: string[] | null;
  refutes_atom_id?: string | null;
  tags?: string[];
}

export interface SearchOptions {
  model?: string;
  topK?: number;
  prefilter?: { type?: string; tags?: string[]; sourceLike?: string; origin?: string; target?: string };
}

export class KnowledgeService {
  private db: Database;
  private embedder: EmbeddingsGenerator;
  private autoEmbed: boolean;

  constructor(db: Database, embedder: EmbeddingsGenerator, opts: { autoEmbed?: boolean } = {}) {
    this.db = db;
    this.embedder = embedder;
    this.autoEmbed = opts.autoEmbed !== false; // default true
  }

  async addAtom(input: AddAtomInput): Promise<string> {
    const id = this.db.insertAtom(input as any);
    if (this.autoEmbed) {
      const rowHint: Partial<AtomRow> = {
        id,
        type: input.type,
        text_or_payload: input.text_or_payload ?? null,
        subject_atom_id: input.subject_atom_id ?? null,
        predicate: input.predicate ?? null,
        object_atom_id: input.object_atom_id ?? null
      };
      const text = this._deriveAtomText(id, input.text_or_payload ?? undefined, rowHint as AtomRow);
      const vec = await this.embedder.embed(text);
      const contentHash = this._hashText(text);
      await this.db.upsertEmbedding({ subjectId: id, model: this.embedder.modelId, vector: vec, contentHash });
    }
    return id;
  }

  async addAtoms(inputs: AddAtomInput[]): Promise<string[]> {
    const ids: string[] = [];
    const hints: Partial<AtomRow>[] = [];
    for (const input of inputs) {
      const id = this.db.insertAtom(input as any);
      ids.push(id);
      hints.push({
        id,
        type: input.type,
        text_or_payload: input.text_or_payload ?? null,
        subject_atom_id: input.subject_atom_id ?? null,
        predicate: input.predicate ?? null,
        object_atom_id: input.object_atom_id ?? null
      });
    }
    if (this.autoEmbed && ids.length) {
      const texts = ids.map((id, i) => this._deriveAtomText(id, inputs[i].text_or_payload ?? undefined, hints[i] as AtomRow));
      const vectors = await this.embedder.embedBatch(texts);
      for (let i = 0; i < ids.length; i++) {
        const contentHash = this._hashText(texts[i]);
        await this.db.upsertEmbedding({ subjectId: ids[i], model: this.embedder.modelId, vector: vectors[i], contentHash });
      }
    }
    return ids;
  }

  addTags(atomId: string, tags: string[]): void {
    this.db.addTags(atomId, tags);
  }

  async embedAtom(atomId: string, overrideText?: string): Promise<EmbeddingSummary> {
    const text = overrideText ?? this._deriveAtomText(atomId);
    const vec = await this.embedder.embed(text);
    const contentHash = this._hashText(text);
    return await this.db.upsertEmbedding({ subjectId: atomId, model: this.embedder.modelId, vector: vec, contentHash });
  }

  async embedAtomsBatch(atomIds: string[], overrideTexts?: (string | undefined)[]): Promise<EmbeddingSummary[]> {
    const texts = atomIds.map((id, i) => overrideTexts?.[i] ?? this._deriveAtomText(id));
    const vectors = await this.embedder.embedBatch(texts);
    const res: EmbeddingSummary[] = [];
    for (let i = 0; i < atomIds.length; i++) {
      const contentHash = this._hashText(texts[i]);
      const s = await this.db.upsertEmbedding({ subjectId: atomIds[i], model: this.embedder.modelId, vector: vectors[i], contentHash });
      res.push(s);
    }
    return res;
  }

  async searchText(query: string, opts: SearchOptions = {}): Promise<KnnHit[]> {
    const model = opts.model ?? this.embedder.modelId;
    const qvec = await this.embedder.embed(query);
    return await this.db.searchEmbeddings({ model, vector: qvec, topK: opts.topK ?? 20, prefilter: opts.prefilter });
  }

  listAtoms(filter?: { type?: string; tags?: string[]; sourceLike?: string; origin?: string; target?: string }): AtomRow[] {
    return this.db.listAtoms(filter);
  }

  // SQL query passthrough (read-only)
  query<T = any>(sql: string, params?: Record<string, unknown>): T[] {
    return this.db.query<T>(sql, params);
  }

  async reembedAtom(atomId: string, overrideText?: string): Promise<EmbeddingSummary> {
    return this.embedAtom(atomId, overrideText);
  }

  async reembedAll(filter?: { type?: string; tags?: string[]; sourceLike?: string; origin?: string; target?: string }): Promise<EmbeddingSummary[]> {
    const atoms = this.db.listAtoms(filter);
    const ids = atoms.map(a => a.id);
    const texts = atoms.map(a => this._deriveAtomText(a.id, a.text_or_payload ?? undefined, a));
    return this.embedAtomsBatch(ids, texts);
  }

  private _deriveAtomText(atomId: string, provided?: string, rowHint?: Partial<AtomRow>): string {
    // Basic approach: fetch the atom row and use text_or_payload; if not found, fallback to id
    const atom = rowHint && rowHint.id === atomId ? rowHint as AtomRow : this.db.listAtoms().find(r => r.id === atomId);
    if (!atom) return atomId;
    if (provided) return provided;
    if (atom.text_or_payload) return atom.text_or_payload;
    // For Relations, compose a simple triple
    if (atom.type === 'Relation' && atom.predicate) {
      return `${atom.subject_atom_id ?? 'subject'} ${atom.predicate} ${atom.object_atom_id ?? 'object'}`;
    }
    return atom.id;
  }

  private _hashText(text: string): string {
    // Simple FNV-1a 32-bit then base36 encode
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fnv1a-${(h >>> 0).toString(36)}`;
  }
}

export default KnowledgeService;
