function hasPrismaCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === code;
}

export function isUniqueViolation(err: unknown): boolean {
  return hasPrismaCode(err, "P2002");
}

/** The row is still referenced by another table's ON DELETE RESTRICT foreign key. */
export function isForeignKeyViolation(err: unknown): boolean {
  return hasPrismaCode(err, "P2003");
}
