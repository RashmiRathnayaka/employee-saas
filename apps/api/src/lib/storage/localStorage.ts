import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PutMeta, StorageService } from "./StorageService.js";
import { signFileToken } from "./fileToken.js";

export type LocalDownload = {
  stream: fs.ReadStream;
  contentType: string;
};

/**
 * Dev/test storage driver - writes under a root directory on local disk
 * (gitignored, outside any public folder). Download URLs point back at
 * this API's own /files/download route rather than at the filesystem
 * directly, carrying an HMAC-signed token (see fileToken.ts) so the route
 * can verify the request without a DB round trip.
 */
export class LocalStorageService implements StorageService {
  constructor(private readonly root: string) {}

  private resolvePath(key: string): string {
    const rootResolved = path.resolve(this.root);
    const resolved = path.resolve(rootResolved, key);
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
      throw new Error(`Refusing to access a path outside the storage root: ${key}`);
    }
    return resolved;
  }

  async put(key: string, stream: Readable, meta: PutMeta): Promise<void> {
    const filePath = this.resolvePath(key);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(stream, fs.createWriteStream(filePath));
    await fsp.writeFile(`${filePath}.meta.json`, JSON.stringify(meta));
  }

  async getDownloadUrl(key: string, filename: string): Promise<string> {
    const token = signFileToken({ key, filename });
    return `/api/v1/files/download?token=${encodeURIComponent(token)}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await fsp.rm(filePath, { force: true });
    await fsp.rm(`${filePath}.meta.json`, { force: true });
  }

  /** Used only by GET /files/download - resolves a verified token's key
   * back to a readable stream + its original content type. */
  async readForDownload(key: string): Promise<LocalDownload | null> {
    const filePath = this.resolvePath(key);
    try {
      const metaRaw = await fsp.readFile(`${filePath}.meta.json`, "utf8");
      const meta: PutMeta = JSON.parse(metaRaw);
      await fsp.access(filePath, fs.constants.R_OK);
      return { stream: fs.createReadStream(filePath), contentType: meta.contentType };
    } catch {
      return null;
    }
  }
}
