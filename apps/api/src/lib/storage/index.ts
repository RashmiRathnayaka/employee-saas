import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../../config.js";
import type { StorageService } from "./StorageService.js";
import { LocalStorageService } from "./localStorage.js";
import { S3StorageService } from "./s3Storage.js";

export type { StorageService, PutMeta } from "./StorageService.js";
export { LocalStorageService } from "./localStorage.js";
export { S3StorageService } from "./s3Storage.js";

function buildStorageService(): StorageService {
  if (config.STORAGE_DRIVER === "s3") {
    const credentials = { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY };
    const client = new S3Client({ endpoint: config.S3_ENDPOINT, credentials, region: "us-east-1", forcePathStyle: true });
    const presignClient = new S3Client({
      endpoint: config.S3_PUBLIC_URL,
      credentials,
      region: "us-east-1",
      forcePathStyle: true,
    });
    return new S3StorageService(client, presignClient, config.S3_BUCKET);
  }

  return new LocalStorageService(config.STORAGE_LOCAL_PATH);
}

let instance: StorageService | undefined;

/** Lazily built, process-wide singleton - swap STORAGE_DRIVER to change it,
 * no code elsewhere needs to know which driver is active. */
export function getStorageService(): StorageService {
  instance ??= buildStorageService();
  return instance;
}
