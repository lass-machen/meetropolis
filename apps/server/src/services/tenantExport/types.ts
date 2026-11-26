/**
 * Shared contract of the operator tenant export.
 *
 * The export writes one directory per tenant: `manifest.json`, `SHA256SUMS`,
 * one JSON array per table under `db/` (or `contract/` for contract and
 * billing data), one TMJ document per map under `maps/` and file copies under
 * `files/`. Secrets never leave the database: every table is exported through
 * a fixed field allowlist, and every field that is not exported is listed with
 * a reason.
 */

export type ExportRow = Record<string, unknown>;

/** One exported table: which rows belong to the tenant and which fields leave the database. */
export interface ModelExportSpec {
  /** Prisma model name, e.g. `MapChunk`. */
  model: string;
  /** Property of the Prisma client that queries the model, e.g. `mapChunk`. */
  delegate: string;
  /** POSIX path of the JSON file inside the export directory, e.g. `db/MapChunk.json`. */
  file: string;
  /** Scalar fields that are exported. */
  fields: readonly string[];
  /** Scalar fields that are not exported, each with the reason. */
  omitted: Readonly<Record<string, string>>;
  /** Unique, stable ordering used for paging. */
  orderBy: readonly string[];
  /** Prisma `where` that selects exactly the rows of this tenant. */
  where: (tenantId: string) => Record<string, unknown>;
}

/** A model that is deliberately not part of the export. */
export interface ExcludedModel {
  model: string;
  reason: string;
}

/** Writes into the export directory. All paths are POSIX paths relative to the export root. */
export interface TenantExportSink {
  /** Streams the rows as one JSON array into `relPath` and returns the row count. */
  writeJsonRows(relPath: string, rows: AsyncIterable<ExportRow> | Iterable<ExportRow>): Promise<number>;
  /** Writes a UTF-8 text file. */
  writeText(relPath: string, content: string): Promise<void>;
  /** Copies one file; returns false and records it as missing when the source does not exist. */
  copyFile(relPath: string, sourcePath: string): Promise<boolean>;
  /** Registers an exported table in the manifest. */
  recordTable(entry: { model: string; file: string; rows: number; omittedFields: readonly string[] }): void;
  /** Registers models that are deliberately not exported. */
  recordExcluded(models: readonly ExcludedModel[]): void;
}

/** Result of the optional enterprise part of the export. */
export interface EnterpriseExportResult {
  tables: number;
  rows: number;
}
