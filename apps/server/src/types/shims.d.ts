declare module 'unzipper' {
  export interface ZipEntry {
    path?: string;
    fileName?: string;
    type?: string;
    buffer(): Promise<Buffer>;
  }
  export interface CentralDirectory {
    files: ZipEntry[];
  }
  const Open: {
    buffer(buf: Buffer): Promise<CentralDirectory>;
    file(filePath: string): Promise<CentralDirectory>;
  };
  const mod: { Open: typeof Open };
  export { Open };
  export default mod;
}

declare module 'multer' {
  import type { RequestHandler } from 'express';

  interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }

  interface StorageEngine {
    _handleFile?: unknown;
    _removeFile?: unknown;
  }

  interface MulterOptions {
    storage?: StorageEngine;
    limits?: { fileSize?: number; files?: number; fields?: number; parts?: number };
    fileFilter?: (req: unknown, file: MulterFile, cb: (err: Error | null, accept: boolean) => void) => void;
  }

  interface MulterInstance {
    single(field: string): RequestHandler;
    array(field: string, maxCount?: number): RequestHandler;
    fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
    none(): RequestHandler;
    any(): RequestHandler;
  }

  interface MulterFactory {
    (options?: MulterOptions): MulterInstance;
    memoryStorage(): StorageEngine;
    diskStorage(opts: Record<string, unknown>): StorageEngine;
  }

  namespace multer {
    type File = MulterFile;
  }

  const multer: MulterFactory;
  export default multer;
}

// Optional proprietary tenancy module. Present only in enterprise builds.
// Callers narrow at the load site (see tenancyLoader.ts).
declare module '@meetropolis/tenancy' {
  const mod: unknown;
  export default mod;
}

// Optional proprietary billing module. Present only in enterprise builds.
// Callers narrow at the load site (see billingLoader.ts).
declare module '@meetropolis/billing' {
  const mod: unknown;
  export default mod;
}
