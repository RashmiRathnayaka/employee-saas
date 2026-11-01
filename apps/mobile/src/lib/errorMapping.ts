import type { FieldValues, UseFormSetError } from "react-hook-form";
import { ApiClientError } from "./apiClient";
import { strings } from "../strings";

type ZodFlattenedDetails = {
  fieldErrors?: Record<string, string[] | undefined>;
  formErrors?: string[];
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    const known = (strings.errors as Record<string, string | undefined>)[error.code];
    if (known) return known;
    if (error.code === "NETWORK_ERROR") return strings.errors.network;
    return error.message || strings.common.somethingWentWrong;
  }
  if (error instanceof Error) return error.message;
  return strings.common.somethingWentWrong;
}

/**
 * Applies a VALIDATION_ERROR's field-level details (Zod's `.flatten()` shape)
 * onto a react-hook-form instance. Returns true if any field errors were set,
 * so the caller knows whether to also show a form-level error.
 */
export function applyApiErrorToForm<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>): boolean {
  if (!(error instanceof ApiClientError) || error.code !== "VALIDATION_ERROR") {
    return false;
  }
  const details = error.details as ZodFlattenedDetails | undefined;
  const fieldErrors = details?.fieldErrors ?? {};
  let applied = false;
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) {
      setError(field as never, { type: "server", message: messages[0] });
      applied = true;
    }
  }
  return applied;
}
