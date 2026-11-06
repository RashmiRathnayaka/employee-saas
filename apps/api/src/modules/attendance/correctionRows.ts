import type { Prisma } from "@prisma/client";
import type { AttendanceCorrectionDto, CorrectedFieldsDto } from "@employee-saas/shared";

/** Reading the correction history, which both a record and a visit show. */

export const CORRECTION_INCLUDE = {
  correctedBy: { select: { employee: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.AttendanceCorrectionInclude;

type CorrectionRow = Prisma.AttendanceCorrectionGetPayload<{ include: typeof CORRECTION_INCLUDE }>;

export function toCorrectionDto(row: CorrectionRow): AttendanceCorrectionDto {
  const person = row.correctedBy.employee;
  return {
    id: row.id,
    correctedByName: person ? `${person.firstName} ${person.lastName}` : null,
    reason: row.reason,
    before: row.before as CorrectedFieldsDto | null,
    after: row.after as CorrectedFieldsDto,
    createdAt: row.createdAt.toISOString(),
  };
}
