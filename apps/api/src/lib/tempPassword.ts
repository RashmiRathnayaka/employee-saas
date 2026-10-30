import crypto from "node:crypto";

/** A one-time password for a freshly created login - shown once in the API
 * response, never stored anywhere but as an argon2 hash, paired with
 * users.mustChangePassword = true so the recipient must set their own. */
export function generateTempPassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}
