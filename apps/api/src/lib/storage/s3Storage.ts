import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type { PutMeta, StorageService } from "./StorageService.js";

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Production storage driver. Two separate S3 clients, not one, because a
 * SigV4 signature covers the request's Host header - rewriting the host of
 * an already-signed URL breaks it (SignatureDoesNotMatch). So: a main
 * client (S3_ENDPOINT) for every server-to-S3 operation, and a presigning
 * client (S3_PUBLIC_URL) used only to mint the GET URL handed to clients -
 * see docs/architecture.md §6.
 */
export class S3StorageService implements StorageService {
  constructor(
    private readonly client: S3Client,
    private readonly presignClient: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, stream: Readable, meta: PutMeta): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: meta.contentType,
      }),
    );
  }

  async getDownloadUrl(key: string, filename: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // baked into the signed URL so the browser downloads with the
      // original filename, not the opaque object key
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
