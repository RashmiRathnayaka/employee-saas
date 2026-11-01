import { describe, expect, it } from "@jest/globals";
import { MAX_PROOF_FILE_SIZE_BYTES, validateProofFile } from "./fileValidation";

describe("validateProofFile", () => {
  it("accepts an allowed type at or under the 5 MB limit", () => {
    expect(validateProofFile({ mimeType: "image/jpeg", sizeBytes: 1024 })).toBeNull();
    expect(validateProofFile({ mimeType: "application/pdf", sizeBytes: MAX_PROOF_FILE_SIZE_BYTES })).toBeNull();
  });

  it("rejects a file over the 5 MB limit", () => {
    expect(validateProofFile({ mimeType: "image/png", sizeBytes: MAX_PROOF_FILE_SIZE_BYTES + 1 })).toBe("tooLarge");
  });

  it("rejects a file type that isn't jpg, png, or pdf", () => {
    expect(validateProofFile({ mimeType: "application/zip", sizeBytes: 100 })).toBe("unsupportedType");
  });

  it("checks type before size, so an oversized unsupported file reports the type error", () => {
    expect(validateProofFile({ mimeType: "video/mp4", sizeBytes: MAX_PROOF_FILE_SIZE_BYTES + 1 })).toBe(
      "unsupportedType",
    );
  });
});
