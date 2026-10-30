import crypto from "node:crypto";
import { config } from "../../config.js";

export type FileTokenPayload = {
  key: string;
  filename: string;
  exp: number;
};

const TOKEN_TTL_MS = 5 * 60 * 1000;

function sign(payloadBase64: string): string {
  return crypto.createHmac("sha256", config.FILE_TOKEN_SECRET).update(payloadBase64).digest("hex");
}

/** Signs {key, filename, exp} into "<payload>.<signature>" - used by the
 * local storage driver's getDownloadUrl() and verified by GET /files/download. */
export function signFileToken(params: { key: string; filename: string }): string {
  const payload: FileTokenPayload = { ...params, exp: Date.now() + TOKEN_TTL_MS };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadBase64}.${sign(payloadBase64)}`;
}

/** Returns the payload if the token's signature is valid and it hasn't
 * expired; null otherwise (never throws - this is a boundary with
 * attacker-controlled input). */
export function verifyFileToken(token: string): FileTokenPayload | null {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = sign(payloadBase64);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  let payload: FileTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return null;
  }

  return payload;
}
