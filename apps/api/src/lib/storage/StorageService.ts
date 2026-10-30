import type { Readable } from "node:stream";

export type PutMeta = {
  contentType: string;
};

/**
 * Object storage, abstracted behind one interface so the rest of the app
 * never knows whether files live on local disk (dev/test) or S3 (prod) -
 * see docs/architecture.md §6. Keys are logical paths, e.g.
 * `company/<companyId>/leave-documents/<requestId>/<uuid>`.
 */
export interface StorageService {
  put(key: string, stream: Readable, meta: PutMeta): Promise<void>;
  /** A short-lived URL (a few minutes) the client can GET to download the file. */
  getDownloadUrl(key: string, filename: string): Promise<string>;
  delete(key: string): Promise<void>;
}
