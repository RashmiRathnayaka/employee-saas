import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageService } from "./localStorage.js";
import { verifyFileToken } from "./fileToken.js";

describe("LocalStorageService", () => {
  let root: string;
  let storage: LocalStorageService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));
    storage = new LocalStorageService(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("writes a file and reads it back with the right content and content type", async () => {
    const key = "company/c1/leave-documents/r1/f1.pdf";
    await storage.put(key, Readable.from([Buffer.from("hello world")]), { contentType: "application/pdf" });

    const file = await storage.readForDownload(key);
    expect(file).not.toBeNull();
    expect(file!.contentType).toBe("application/pdf");

    const chunks: Buffer[] = [];
    for await (const chunk of file!.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello world");
  });

  it("creates nested directories as needed", async () => {
    const key = "company/c2/leave-documents/r2/deep/nested/f2.png";
    await storage.put(key, Readable.from([Buffer.from("x")]), { contentType: "image/png" });
    const file = await storage.readForDownload(key);
    expect(file).not.toBeNull();
  });

  it("getDownloadUrl returns an API URL carrying a verifiable token", async () => {
    const url = await storage.getDownloadUrl("company/c1/leave-documents/r1/f1.pdf", "proof.pdf");
    expect(url).toMatch(/^\/api\/v1\/files\/download\?token=/);

    const token = decodeURIComponent(url.split("token=")[1]!);
    const payload = verifyFileToken(token);
    expect(payload).toMatchObject({ key: "company/c1/leave-documents/r1/f1.pdf", filename: "proof.pdf" });
  });

  it("delete removes the file and its metadata, making readForDownload return null", async () => {
    const key = "company/c1/leave-documents/r1/f1.pdf";
    await storage.put(key, Readable.from([Buffer.from("x")]), { contentType: "application/pdf" });
    await storage.delete(key);
    expect(await storage.readForDownload(key)).toBeNull();
  });

  it("readForDownload returns null for a key that was never written", async () => {
    expect(await storage.readForDownload("nope")).toBeNull();
  });

  it("refuses to write outside the storage root (path traversal)", async () => {
    await expect(
      storage.put("../../etc/passwd", Readable.from([Buffer.from("x")]), { contentType: "text/plain" }),
    ).rejects.toThrow();
  });
});
