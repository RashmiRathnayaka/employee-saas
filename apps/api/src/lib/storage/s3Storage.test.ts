import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3StorageService } from "./s3Storage.js";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://presigned.example.test/signed-url"),
}));

function fakeClient() {
  return { send: vi.fn().mockResolvedValue({}) } as unknown as S3Client;
}

describe("S3StorageService", () => {
  it("put() sends a PutObjectCommand with the bucket, key, body, and content type", async () => {
    const client = fakeClient();
    const presignClient = fakeClient();
    const storage = new S3StorageService(client, presignClient, "my-bucket");

    const stream = Readable.from([Buffer.from("hello")]);
    await storage.put("company/c1/leave-documents/r1/f1", stream, { contentType: "application/pdf" });

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = (client.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "my-bucket",
      Key: "company/c1/leave-documents/r1/f1",
      ContentType: "application/pdf",
      Body: stream,
    });
  });

  it("delete() sends a DeleteObjectCommand with the bucket and key", async () => {
    const client = fakeClient();
    const presignClient = fakeClient();
    const storage = new S3StorageService(client, presignClient, "my-bucket");

    await storage.delete("company/c1/leave-documents/r1/f1");

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = (client.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({ Bucket: "my-bucket", Key: "company/c1/leave-documents/r1/f1" });
  });

  it("getDownloadUrl() presigns a GetObjectCommand (with the client dedicated to presigning, not the main client) and sets the attachment filename", async () => {
    const client = fakeClient();
    const presignClient = fakeClient();
    const storage = new S3StorageService(client, presignClient, "my-bucket");

    const url = await storage.getDownloadUrl("company/c1/leave-documents/r1/f1", "medical proof.pdf");

    expect(url).toBe("https://presigned.example.test/signed-url");
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const [usedClient, command, options] = (getSignedUrl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(usedClient).toBe(presignClient);
    expect(usedClient).not.toBe(client);
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "my-bucket",
      Key: "company/c1/leave-documents/r1/f1",
      ResponseContentDisposition: 'attachment; filename="medical proof.pdf"',
    });
    expect(options).toMatchObject({ expiresIn: 5 * 60 });
  });

  it("strips double quotes out of the filename used in ResponseContentDisposition", async () => {
    const storage = new S3StorageService(fakeClient(), fakeClient(), "my-bucket");
    await storage.getDownloadUrl("key", 'evil".pdf');
    const [, command] = (getSignedUrl as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(command.input.ResponseContentDisposition).toBe('attachment; filename="evil.pdf"');
  });
});
