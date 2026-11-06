/** The before and after values of only the fields that actually changed. A form
 * usually sends every field, so logging the whole body would hide what changed.
 * Values are compared as JSON because some fields are objects. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]) {
  const changed = fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  return {
    before: Object.fromEntries(changed.map((field) => [field, before[field]])),
    after: Object.fromEntries(changed.map((field) => [field, after[field]])),
  };
}
