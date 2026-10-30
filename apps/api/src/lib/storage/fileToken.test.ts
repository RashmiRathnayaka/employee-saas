import { describe, expect, it, vi } from "vitest";
import { signFileToken, verifyFileToken } from "./fileToken.js";

describe("file download tokens", () => {
  it("round-trips a valid token", () => {
    const token = signFileToken({ key: "company/c1/leave-documents/r1/f1", filename: "proof.pdf" });
    const payload = verifyFileToken(token);
    expect(payload).toMatchObject({ key: "company/c1/leave-documents/r1/f1", filename: "proof.pdf" });
  });

  it("rejects a tampered token", () => {
    const token = signFileToken({ key: "k", filename: "f.pdf" });
    const [payload] = token.split(".");
    const tampered = `${payload}.0000000000000000000000000000000000000000000000000000000000000000`;
    expect(verifyFileToken(tampered)).toBeNull();
  });

  it("rejects a token whose payload was altered (signature no longer matches)", () => {
    const token = signFileToken({ key: "k", filename: "f.pdf" });
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ key: "other-key", filename: "f.pdf", exp: Date.now() + 100000 })).toString(
      "base64url",
    );
    expect(verifyFileToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    const token = signFileToken({ key: "k", filename: "f.pdf" });
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(verifyFileToken(token)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects garbage input", () => {
    expect(verifyFileToken("not-a-token")).toBeNull();
    expect(verifyFileToken("")).toBeNull();
    expect(verifyFileToken("a.b.c")).toBeNull();
  });
});
