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
  import type { Request, RequestHandler } from 'express';
  import type { Readable } from 'node:stream';

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

  // File handed to a storage engine by multer 2.4.0 (lib/make-middleware.js).
  // The stream is only present while _handleFile runs.
  interface StorageEngineFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    stream: Readable;
  }

  interface StoredFileInfo {
    buffer?: Buffer;
    size?: number;
  }

  interface TypedStorageEngine {
    _handleFile(
      req: Request,
      file: StorageEngineFile,
      callback: (error: Error | null, info?: StoredFileInfo) => void,
    ): void;
    _removeFile(req: Request, file: StorageEngineFile & StoredFileInfo, callback: (error: Error | null) => void): void;
  }

  interface TypedOptions {
    storage?: TypedStorageEngine;
    limits?: { fileSize?: number; files?: number; fields?: number; fieldSize?: number; parts?: number };
  }

  type MulterErrorCode =
    | 'LIMIT_PART_COUNT'
    | 'LIMIT_FILE_SIZE'
    | 'LIMIT_FILE_COUNT'
    | 'LIMIT_FIELD_KEY'
    | 'LIMIT_FIELD_VALUE'
    | 'LIMIT_FIELD_COUNT'
    | 'LIMIT_UNEXPECTED_FILE'
    | 'MISSING_FIELD_NAME'
    | 'LIMIT_FIELD_NESTING'
    | 'LIMIT_FIELD_ARRAY_INDEX'
    | 'STREAM_DESTROYED'
    | 'INVALID_FIELD_NAME';

  interface MulterErrorInstance extends Error {
    code: MulterErrorCode;
    field?: string;
    filename?: string;
  }

  interface MulterFactory {
    (options?: MulterOptions): MulterInstance;
    memoryStorage(): StorageEngine;
    diskStorage(opts: Record<string, unknown>): StorageEngine;
    MulterError: new (code: MulterErrorCode, field?: string, filename?: string) => MulterErrorInstance;
  }

  namespace multer {
    type File = MulterFile;
    type Multer = MulterInstance;
    type StorageEngine = TypedStorageEngine;
    type Options = TypedOptions;
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

// Optional proprietary telemetry module (Signalyr relay). Present only in
// enterprise builds. Callers narrow at the load site (see telemetryLoader.ts).
declare module '@meetropolis/telemetry-node' {
  const mod: unknown;
  export default mod;
}

// Optional proprietary transcription module. Present only in enterprise builds.
// Callers narrow at the load site (see transcriptionLoader.ts).
declare module '@meetropolis/transcription' {
  const mod: unknown;
  export default mod;
}
