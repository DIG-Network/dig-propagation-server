import { Transform, TransformCallback } from 'stream';
import * as crypto from 'crypto';

export class HashingStream extends Transform {
    private hash: crypto.Hash;
    public digest: string | null = null;
  
    constructor(algorithm: string) {
      super();
      this.hash = crypto.createHash(algorithm);
    }
  
    _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
      this.hash.update(chunk);
      this.push(chunk);
      callback();
    }
  
    _flush(callback: TransformCallback) {
      this.digest = this.hash.digest('hex');
      callback();
    }
  }