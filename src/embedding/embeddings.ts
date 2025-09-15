import type { KnnHit } from '../types/domain.js';
import { env } from '@xenova/transformers';

export interface EmbeddingsConfig {
  modelId: string;
  cacheDir?: string;
  normalize?: boolean;
  quantized?: boolean;
}

export interface EmbeddingsGenerator {
  readonly modelId: string;
  getDim(): Promise<number>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export class TransformersEmbedder implements EmbeddingsGenerator {
  modelId: string;
  normalize: boolean;
  quantized: boolean;
  private extractorPromise: Promise<any> | null = null;
  private dim: number | null = null;

  constructor(cfg: EmbeddingsConfig) {
    this.modelId = cfg.modelId;
    this.normalize = cfg.normalize !== false;
    this.quantized = cfg.quantized !== false; // prefer quantized default
    if (cfg.cacheDir) {
      // @xenova/transformers uses env.LOCAL_MODEL_DIR for local path
      // and env.CACHE_DIR for hub cache. Set both for portability.
      (env as any).CACHE_DIR = cfg.cacheDir;
      (env as any).LOCAL_MODEL_DIR = cfg.cacheDir;
    }
  }

  private async getExtractor() {
    if (!this.extractorPromise) {
      const { pipeline } = await import('@xenova/transformers');
      this.extractorPromise = pipeline('feature-extraction', this.modelId, { quantized: this.quantized });
    }
    return this.extractorPromise;
  }

  async getDim(): Promise<number> {
    if (this.dim) return this.dim;
    const v = await this.embed('test');
    this.dim = v.length;
    return this.dim;
  }

  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.getExtractor();
    // Many models support pooling + normalize in the pipeline call
    const out = await extractor(text, { pooling: 'mean', normalize: this.normalize });
    // Ensure Float32Array
    const data: number[] | Float32Array = out?.data || out;
    return data instanceof Float32Array ? data : new Float32Array(data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getExtractor();
    const out = await extractor(texts, { pooling: 'mean', normalize: this.normalize });
    const arr = out?.data || out;
    if (Array.isArray(arr)) {
      return arr.map((row: any) => row instanceof Float32Array ? row : new Float32Array(row));
    }
    // Single vector fallback
    const v = arr instanceof Float32Array ? arr : new Float32Array(arr);
    return [v];
  }
}

// Deterministic hash-based fallback embedder (no external models)
export class HashEmbedder implements EmbeddingsGenerator {
  modelId: string;
  private dim: number;
  private normalize: boolean;
  constructor(dim = 64, normalize = true) { this.modelId = `hash-${dim}`; this.dim = dim; this.normalize = normalize; }
  async getDim() { return this.dim; }
  async embed(text: string) { return this._hash(text); }
  async embedBatch(texts: string[]) { return texts.map(t => this._hash(t)); }
  private _hash(text: string): Float32Array {
    const v = new Float32Array(this.dim);
    let h1 = 2166136261 >>> 0; // FNV-1a
    for (let i = 0; i < text.length; i++) {
      h1 ^= text.charCodeAt(i);
      h1 = Math.imul(h1, 16777619);
      const idx = h1 % this.dim >>> 0;
      v[idx] += 1;
    }
    if (this.normalize) {
      let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
      const n = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= n;
    }
    return v;
  }
}

