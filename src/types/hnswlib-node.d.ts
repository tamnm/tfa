declare module 'hnswlib-node' {
  export class HierarchicalNSW<T extends 'cosine' | 'l2' | 'ip'> {
    constructor(spaceName: T, dim: number);
    initIndex(maxElements: number): void;
    readIndex(path: string, dim: number): void;
    writeIndex(path: string): void;
    addPoint(vec: Float32Array, label: number): void;
    markDeleted(label: number): void;
    searchKnn(vec: Float32Array, k: number): { neighbors: number[]; distances: number[] };
  }
}

