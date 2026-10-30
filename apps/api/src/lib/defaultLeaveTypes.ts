export type DefaultLeaveType = {
  name: string;
  code: string;
  defaultAnnualDays: number;
  requiresProof: boolean;
  carryForwardAllowed: boolean;
  allowPastDates: boolean;
};

/** Seeded for every new company - via the seed script and via POST /companies. */
export const DEFAULT_LEAVE_TYPES: DefaultLeaveType[] = [
  {
    name: "Annual Leave",
    code: "ANNUAL",
    defaultAnnualDays: 14,
    requiresProof: false,
    carryForwardAllowed: true,
    allowPastDates: false,
  },
  {
    name: "Casual Leave",
    code: "CASUAL",
    defaultAnnualDays: 7,
    requiresProof: false,
    carryForwardAllowed: false,
    allowPastDates: false,
  },
  {
    name: "Sick Leave",
    code: "SICK",
    defaultAnnualDays: 7,
    requiresProof: true,
    carryForwardAllowed: false,
    allowPastDates: true,
  },
];
