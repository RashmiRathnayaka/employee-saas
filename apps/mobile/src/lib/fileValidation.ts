export const MAX_PROOF_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_PROOF_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export type ProofFileCandidate = { mimeType: string; sizeBytes: number };
export type ProofFileValidationError = "unsupportedType" | "tooLarge";

/** Mirrors the API's own checks (apps/api/src/modules/leaveDocuments) so a
 * bad file is rejected before the user waits on an upload that will fail. */
export function validateProofFile(file: ProofFileCandidate): ProofFileValidationError | null {
  if (!ALLOWED_PROOF_CONTENT_TYPES.has(file.mimeType)) {
    return "unsupportedType";
  }
  if (file.sizeBytes > MAX_PROOF_FILE_SIZE_BYTES) {
    return "tooLarge";
  }
  return null;
}
