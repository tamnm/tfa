import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import * as fs from 'fs';
import * as path from 'path';

export interface EmbeddingsConfig {
  modelId: string;
  cacheDir?: string;
  normalize?: boolean;
  quantized?: boolean;
  pipelineFactory?: typeof pipeline;
}

export interface EmbeddingsGenerator {
  readonly modelId: string;
  getDim(): Promise<number>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export class TransformersEmbedder implements EmbeddingsGenerator {
  modelId: string;
  private extractor: FeatureExtractionPipeline | null = null;
  private initialized: boolean = false;
  private cacheDir: string;
  private quantized: boolean;
  private normalize: boolean;
  private pipelineFactory: typeof pipeline;

  constructor(cfg: EmbeddingsConfig) {
    this.modelId = cfg.modelId || 'Xenova/all-MiniLM-L6-v2';
    this.cacheDir = cfg.cacheDir || '.tfa/models';
    this.quantized = cfg.quantized !== false;
    this.normalize = cfg.normalize !== false;
    this.pipelineFactory = cfg.pipelineFactory ?? pipeline;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    try {
      console.log(`initializing model: ${this.modelId} into ${this.cacheDir}`);
      
      this.extractor = await this.pipelineFactory(
        'feature-extraction',
        this.modelId,
        {
          quantized: this.quantized,
          cache_dir: this.cacheDir
        }
      );
    } catch (error) {
      console.warn(`Pipeline fetch failed: ${error.message}`);
      console.log('Attempting direct download...');
      
      await this.downloadModelDirect();
      
      // Retry pipeline with local files
      this.extractor = await this.pipelineFactory(
        'feature-extraction',
        this.modelId,
        {
          quantized: this.quantized,
          cache_dir: this.cacheDir,
          local_files_only: true
        }
      );
    }
    
    this.initialized = true;
  }

  private async downloadModelDirect(): Promise<void> {
    const modelPath = path.join(this.cacheDir, this.modelId);
    if (!fs.existsSync(modelPath)) {
      fs.mkdirSync(modelPath, { recursive: true });
    }

    // Pre-configured URLs for all-MiniLM-L6-v2
    const baseUrl = process.env.TFA_MODEL_BASE_URL || 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main';
    const files = [
      'config.json',
      'tokenizer.json', 
      'tokenizer_config.json',
      this.quantized ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx'
    ];

    for (const file of files) {
      const filePath = path.join(modelPath, file);
      const fileDir = path.dirname(filePath);
      
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }
      
      if (!fs.existsSync(filePath)) {
        console.log(`Downloading ${file}...`);
        await this.downloadFile(`${baseUrl}/${file}`, filePath);
      }
    }
  }

  private async downloadFile(url: string, filePath: string): Promise<void> {
    const https = await import('https');
    const http = await import('http');
    
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      
      const request = client.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          return this.downloadFile(response.headers.location!, filePath)
            .then(resolve)
            .catch(reject);
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        const writeStream = fs.createWriteStream(filePath);
        response.pipe(writeStream);
        
        writeStream.on('finish', () => {
          writeStream.close();
          resolve();
        });
        
        writeStream.on('error', reject);
      });
      
      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  async getDim(): Promise<number> {
    if (!this.initialized) await this.init();
    const result = await this.extractor!('test', { pooling: 'mean', normalize: this.normalize });
    return Array.from(result.data).length;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.initialized) await this.init();
    
    const result = await this.extractor!(text, {
      pooling: 'mean',
      normalize: this.normalize
    });
    
    return new Float32Array(Array.from(result.data));
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.initialized) await this.init();
    
    const embeddings: Float32Array[] = [];
    for (const text of texts) {
      const embedding = await this.embed(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  static cosineSimilarity(vecA: Float32Array | number[], vecB: Float32Array | number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
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
