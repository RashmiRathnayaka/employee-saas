import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { todayInTimezone, type AttendanceListRowDto, type AttendanceRecordDetailDto } from "@employee-saas/shared";
import { AuthProvider } from "../lib/authContext";
import { CompanyProvider } from "../lib/companyContext";
import { ToastProvider } from "../lib/toast";
import { AttendancePage } from "./AttendancePage";
import { AttendanceRecordPage } from "./AttendanceRecordPage";
import { strings } from "../strings";

function makeRow(overrides: Partial<AttendanceListRowDto> = {}): AttendanceListRowDto {
  return {
    id: "r1",
    employeeId: "e1",
    employeeName: "Alex Silva",
    employeeCode: "EMP-001",
    departmentName: "Field",
    siteName: "Head Office",
    siteVisitFlags: [],
    workDate: "2026-11-03",
    status: "LATE",
    scheduledStartAt: "2026-11-03T03:30:00.000Z", // 09:00 in Colombo
    scheduledEndAt: "2026-11-03T11:30:00.000Z", // 17:00
    checkInAt: "2026-11-03T04:00:00.000Z", // 09:30
    checkOutAt: null,
    workedMinutes: null,
    lateMinutes: 30,
    earlyLeaveMinutes: 0,
    checkInSiteId: "o1",
    checkInAccuracyM: 12,
    checkInDistanceM: 18,
    checkInWithinRadius: true,
    checkInMocked: false,
    checkOutAccuracyM: null,
    checkOutDistanceM: null,
    checkOutWithinRadius: null,
    checkOutMocked: null,
    flags: [],
    source: "MOBILE",
    autoClosedAt: null,
    isCorrected: false,
    createdAt: "2026-11-03T04:00:00.000Z",
    updatedAt: "2026-11-03T04:00:00.000Z",
    ...overrides,
  };
}

function makeDetail(overrides: Record<string, unknown> = {}, extra: Partial<AttendanceRecordDetailDto> = {}): AttendanceRecordDetailDto {
  const listOnly = ["employeeName", "employeeCode", "departmentName", "siteName", "siteVisitFlags"];
  const record = Object.fromEntries(Object.entries(makeRow(overrides)).filter(([key]) => !listOnly.includes(key))) as AttendanceRecordDetailDto["record"];
  return {
    record: { ...record, checkInLat: 6.927079, checkInLng: 79.861244, checkOutLat: null, checkOutLng: null },
    employee: { name: "Alex Silva", code: "EMP-001" },
    siteName: "Head Office",
    siteVisits: [],
    corrections: [],
    ...extra,
  };
}

let role: string;
let meEmployeeId: string;
let timezone: string;
let rows: AttendanceListRowDto[];
let urls: URL[];
let moduleOff: boolean;
let detail: AttendanceRecordDetailDto;
let corrections: unknown[];
let creates: unknown[];
let createError: { status: number; body: object } | null;
let correctError: { status: number; body: object } | null;

function list(request: Request) {
  const url = new URL(request.url);
  urls.push(url);
  if (moduleOff) {
    return HttpResponse.json({ error: { code: "MODULE_DISABLED", message: "Off", details: { module: "attendance" } } }, { status: 403 });
  }
  return HttpResponse.json({ data: rows, page: 1, pageSize: 50, total: rows.length });
}

const server = setupServer(
  http.get("/api/v1/auth/me", () =>
    HttpResponse.json({ user: { id: "u1", companyId: "c1", employeeId: meEmployeeId, email: "me@acme.test", role, mustChangePassword: false } }),
  ),
  http.get("/api/v1/company", () =>
    HttpResponse.json({ company: { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone, logoUrl: null, primaryColor: null } }),
  ),
  http.get("/api/v1/company/settings", () => HttpResponse.json({ settings: { enabledModules: { attendance: true, sites: true } } })),
  http.get("/api/v1/departments", () => HttpResponse.json({ data: [{ id: "d1", name: "Field" }] })),
  http.get("/api/v1/sites", () => HttpResponse.json({ data: [{ id: "o1", name: "Head Office" }, { id: "o2", name: "Galle Office" }], page: 1, pageSize: 100, total: 2 })),
  http.get("/api/v1/employees", () =>
    HttpResponse.json({
      data: [
        { id: "11111111-1111-4111-8111-111111111111", firstName: "Alex", lastName: "Silva", employeeCode: "EMP-001" },
        { id: "e9", firstName: "Hana", lastName: "Me", employeeCode: "EMP-009" },
      ],
    }),
  ),
  http.get("/api/v1/attendance/team", ({ request }) => list(request)),
  http.get("/api/v1/attendance", ({ request }) => list(request)),
  http.get("/api/v1/attendance/:id", () => HttpResponse.json(detail)),
  http.patch("/api/v1/attendance/:id/correct", async ({ request }) => {
    if (correctError) return HttpResponse.json(correctError.body, { status: correctError.status });
    corrections.push(await request.json());
    return HttpResponse.json({ record: detail.record });
  }),
  http.post("/api/v1/attendance", async ({ request }) => {
    if (createError) return HttpResponse.json(createError.body, { status: createError.status });
    creates.push(await request.json());
    return HttpResponse.json({ record: detail.record }, { status: 201 });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  // jsdom lacks these, and Radix's Select calls them.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  role = "HR";
  meEmployeeId = "e9";
  timezone = "Asia/Colombo";
  rows = [];
  urls = [];
  moduleOff = false;
  detail = makeDetail();
  corrections = [];
  creates = [];
  createError = null;
  correctError = null;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AuthProvider>
            <CompanyProvider>
              <Routes>
                <Route path="/attendance" element={<AttendancePage />} />
                <Route path="/attendance/:id" element={<AttendanceRecordPage />} />
              </Routes>
              <Where />
            </CompanyProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const renderPage = () => renderAt("/attendance");

const box = (scope: HTMLElement, label: string, part: string) => within(scope).getByLabelText(`${label}: ${part}`) as HTMLInputElement;

describe("AttendancePage", () => {
  describe.each([
    ["MANAGER", "/api/v1/attendance/team"],
    ["HR", "/api/v1/attendance"],
    ["COMPANY_ADMIN", "/api/v1/attendance"],
  ])("as %s", (asRole, path) => {
    it(`asks ${path}, and nothing wider`, async () => {
      role = asRole;
      rows = [makeRow()];
      renderPage();

      await screen.findByText("Alex Silva");

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => url.pathname === path)).toBe(true);
    });
  });

  it("opens on today in the company's timezone, not the browser's", async () => {
    timezone = "Pacific/Auckland";
    renderPage();

    await waitFor(() => expect(urls.at(-1)?.searchParams.get("date")).toBe(todayInTimezone("Pacific/Auckland")));
  });

  it("shows status, company-time times, the office and the flags in plain words", async () => {
    rows = [makeRow({ checkOutAt: "2026-11-03T11:30:00.000Z", workedMinutes: 450, flags: ["LOW_ACCURACY", "ON_APPROVED_LEAVE"] })];
    renderPage();

    expect(await screen.findByText("Alex Silva")).toBeTruthy();
    expect(screen.getByText("EMP-001, Field")).toBeTruthy();
    expect(screen.getByText("LATE")).toBeTruthy();
    expect(screen.getByText("09:00 - 17:00")).toBeTruthy();
    expect(screen.getByText("09:30")).toBeTruthy();
    expect(screen.getByText("17:00")).toBeTruthy();
    expect(screen.getByText("7h 30m")).toBeTruthy();
    expect(screen.getByText("Head Office")).toBeTruthy();
    expect(screen.getByText(strings.attendance.flags.LOW_ACCURACY)).toBeTruthy();
    expect(screen.getByText(strings.attendance.flags.ON_APPROVED_LEAVE)).toBeTruthy();
    expect(screen.queryByText("LOW_ACCURACY")).toBeNull();
  });

  it("an ABSENT row with a visit that day stands out, so HR can correct it", async () => {
    rows = [makeRow({ status: "ABSENT", checkInAt: null, lateMinutes: 0, siteVisitFlags: ["ON_ABSENT_DAY"] })];
    renderPage();

    expect(await screen.findByText(strings.attendance.siteVisitFlags.ON_ABSENT_DAY)).toBeTruthy();
    expect(screen.getByText("ABSENT")).toBeTruthy();
  });

  it("marks a corrected row", async () => {
    rows = [makeRow({ isCorrected: true })];
    renderPage();

    expect(await screen.findByText(strings.attendance.corrected)).toBeTruthy();
  });

  it("filters by date, status and department on the server", async () => {
    rows = [makeRow()];
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alex Silva");

    fireEvent.change(screen.getByLabelText(strings.attendance.date), { target: { value: "2026-11-02" } });
    await waitFor(() => expect(urls.at(-1)!.searchParams.get("date")).toBe("2026-11-02"));

    await user.click(screen.getByRole("combobox", { name: strings.attendance.status }));
    await user.click(await screen.findByRole("option", { name: strings.attendance.statuses.ABSENT }));
    await waitFor(() => expect(urls.at(-1)!.searchParams.get("status")).toBe("ABSENT"));

    await user.click(screen.getByRole("combobox", { name: strings.table.department }));
    await user.click(await screen.findByRole("option", { name: "Field" }));
    await waitFor(() => expect(urls.at(-1)!.searchParams.get("departmentId")).toBe("d1"));
  });

  it("nothing yet, and nothing matching, say different things", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(strings.attendance.noRecords)).toBeTruthy();

    await user.click(screen.getByRole("combobox", { name: strings.attendance.status }));
    await user.click(await screen.findByRole("option", { name: strings.attendance.statuses.LATE }));

    expect(await screen.findByText(strings.attendance.noMatches)).toBeTruthy();
  });

  it("with the module off: one clear message", async () => {
    moduleOff = true;
    renderPage();

    expect(await screen.findByText(strings.attendance.moduleOff)).toBeTruthy();
  });

  it("Details opens the record", async () => {
    rows = [makeRow()];
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: `${strings.attendance.details}: Alex Silva` }));

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/attendance/r1"));
  });

  describe("as a manager", () => {
    beforeEach(() => {
      role = "MANAGER";
      meEmployeeId = "m1";
      rows = [makeRow()];
    });

    it("has no way to add a record", async () => {
      renderPage();
      await screen.findByText("Alex Silva");

      expect(screen.queryByRole("button", { name: strings.attendance.addRecord })).toBeNull();
      expect(screen.getByText(strings.attendance.teamTitle)).toBeTruthy();
    });

    it("the list shows no position, even if one reached it", async () => {
      rows = [{ ...makeRow(), checkInLat: 6.927079, checkInLng: 79.861244 } as AttendanceListRowDto];
      const { container } = renderPage();

      await screen.findByText("Alex Silva");

      expect(container.textContent).not.toContain("79.86");
    });
  });

  describe("adding a missing record", () => {
    const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: strings.attendance.addRecord }));
      return screen.findByRole("dialog");
    };

    async function fill(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
      await user.click(within(dialog).getByRole("combobox", { name: strings.attendance.employee }));
      await user.click(await screen.findByRole("option", { name: "Alex Silva (EMP-001)" }));
      fireEvent.change(within(dialog).getByLabelText(strings.attendance.workDate), { target: { value: "2026-11-02" } });
      fireEvent.change(box(dialog, strings.attendance.checkIn, strings.corrections.time), { target: { value: "09:05" } });
      fireEvent.change(box(dialog, strings.attendance.checkOut, strings.corrections.time), { target: { value: "17:00" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Phone was broken");
    }

    it("sends the day in company time, with the reason", async () => {
      const user = userEvent.setup();
      renderPage();
      const dialog = await openDialog(user);

      await fill(user, dialog);
      await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

      await waitFor(() => expect(creates).toHaveLength(1));
      expect(creates[0]).toEqual({
        employeeId: "11111111-1111-4111-8111-111111111111",
        workDate: "2026-11-02",
        checkInAt: "2026-11-02T03:35:00.000Z",
        checkOutAt: "2026-11-02T11:30:00.000Z",
        reason: "Phone was broken",
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("doesn't offer HR themselves", async () => {
      const user = userEvent.setup();
      renderPage();
      const dialog = await openDialog(user);

      await user.click(within(dialog).getByRole("combobox", { name: strings.attendance.employee }));

      await screen.findByRole("option", { name: "Alex Silva (EMP-001)" });
      expect(screen.queryByRole("option", { name: "Hana Me (EMP-009)" })).toBeNull();
    });

    it("explains what's missing, and sends nothing", async () => {
      const user = userEvent.setup();
      renderPage();
      const dialog = await openDialog(user);

      await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

      expect(await within(dialog).findByText(strings.attendance.employeeRequired)).toBeTruthy();
      expect(within(dialog).getByText(strings.corrections.incompleteTime)).toBeTruthy();
      expect(creates).toHaveLength(0);
    });

    it("a day that already has a record offers to open it", async () => {
      createError = { status: 409, body: { error: { code: "ATTENDANCE_RECORD_EXISTS", message: "x", details: { recordId: "r7" } } } };
      const user = userEvent.setup();
      renderPage();
      const dialog = await openDialog(user);

      await fill(user, dialog);
      await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

      const link = await within(dialog).findByRole("link", { name: strings.attendance.openExisting });
      expect(link.getAttribute("href")).toBe("/attendance/r7");
    });
  });
});

describe("AttendanceRecordPage", () => {
  it("shows the day, the schedule and the times in company time", async () => {
    renderAt("/attendance/r1");

    expect(await screen.findByText("Alex Silva, 03 Nov 2026")).toBeTruthy();
    expect(screen.getByText("09:00 - 17:00")).toBeTruthy();
    expect(screen.getByText("09:30")).toBeTruthy();
    expect(screen.getByText("Head Office")).toBeTruthy();
    expect(screen.getByText(strings.attendance.sources.MOBILE)).toBeTruthy();
  });

  describe.each(["HR", "COMPANY_ADMIN"])("as %s", (asRole) => {
    it("sees exact positions and a Google Maps link", async () => {
      role = asRole;
      renderAt("/attendance/r1");

      expect(await screen.findByText("6.927079, 79.861244")).toBeTruthy();
      const link = screen.getByRole("link", { name: strings.position.openInMaps });
      expect(link.getAttribute("href")).toContain("query=6.927079,79.861244");
    });
  });

  describe("as a manager", () => {
    beforeEach(() => {
      role = "MANAGER";
      meEmployeeId = "m1";
      const positions = ["checkInLat", "checkInLng", "checkOutLat", "checkOutLng"];
      const noPosition = Object.fromEntries(Object.entries(detail.record).filter(([key]) => !positions.includes(key)));
      detail = { ...detail, record: noPosition as AttendanceRecordDetailDto["record"] };
    });

    it("sees the distance, no position section, and no Correct button", async () => {
      const { container } = renderAt("/attendance/r1");

      await screen.findByText("Alex Silva, 03 Nov 2026");

      expect(screen.getByText(`18 m, ${strings.siteVisits.within}`)).toBeTruthy();
      expect(screen.queryByText(strings.position.checkInTitle)).toBeNull();
      expect(screen.queryByRole("link", { name: strings.position.openInMaps })).toBeNull();
      expect(screen.queryByRole("button", { name: strings.attendance.correct })).toBeNull();
      expect(container.textContent).not.toContain("79.86");
    });

    it("even a response that wrongly had a position shows none", async () => {
      detail = makeDetail();
      const { container } = renderAt("/attendance/r1");

      await screen.findByText("Alex Silva, 03 Nov 2026");

      expect(container.textContent).not.toContain("79.86");
    });

    it("a visit that day has no Details button", async () => {
      detail = {
        ...detail,
        siteVisits: [
          {
            id: "v1",
            employeeId: "e1",
            employeeName: "Alex Silva",
            employeeCode: "EMP-001",
            siteId: "s1",
            siteName: "Warehouse",
            attendanceRecordId: "r1",
            workDate: "2026-11-03",
            status: "CLOSED",
            checkInAt: "2026-11-03T05:12:00.000Z",
            checkOutAt: "2026-11-03T06:42:00.000Z",
            durationMinutes: 90,
            checkInAccuracyM: 10,
            checkInDistanceM: 120,
            checkInWithinRadius: true,
            checkInMocked: false,
            checkOutAccuracyM: null,
            checkOutDistanceM: null,
            checkOutWithinRadius: null,
            checkOutMocked: null,
            flags: ["AFTER_HOURS"],
            note: null,
            isCorrected: false,
            createdAt: "2026-11-03T05:12:00.000Z",
            updatedAt: "2026-11-03T05:12:00.000Z",
          },
        ],
      };
      renderAt("/attendance/r1");

      expect(await screen.findByText("Warehouse")).toBeTruthy();
      expect(screen.getByText(strings.siteVisits.flags.AFTER_HOURS)).toBeTruthy();
      expect(screen.queryByRole("button", { name: `${strings.siteVisits.details}: Warehouse` })).toBeNull();
    });
  });

  it("an employee opening their own from a notification gets no Correct button or way back", async () => {
    role = "EMPLOYEE";
    meEmployeeId = "e1";
    renderAt("/attendance/r1");

    await screen.findByText("Alex Silva, 03 Nov 2026");

    expect(screen.queryByRole("button", { name: strings.attendance.correct })).toBeNull();
    expect(screen.queryByRole("link", { name: strings.attendance.back })).toBeNull();
  });

  it("HR's own record: no Correct button, and says who to ask", async () => {
    meEmployeeId = "e1";
    renderAt("/attendance/r1");

    expect(await screen.findByText(strings.attendance.ownRecord)).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.attendance.correct })).toBeNull();
  });

  it("shows the correction history, by whom and why", async () => {
    detail = makeDetail(
      { isCorrected: true },
      {
        corrections: [
          {
            id: "c1",
            correctedByName: "Hana Fernando",
            reason: "Forgot to tap on arrival",
            before: { checkInAt: "2026-11-03T04:00:00.000Z", status: "LATE" },
            after: { checkInAt: "2026-11-03T03:25:00.000Z", status: "PRESENT" },
            createdAt: "2026-11-03T10:00:00.000Z",
          },
        ],
      },
    );
    renderAt("/attendance/r1");

    expect(await screen.findByText("Forgot to tap on arrival")).toBeTruthy();
    expect(screen.getByText(/Hana Fernando, 03 Nov 2026/)).toBeTruthy();
    expect(screen.getByText(`${strings.corrections.checkIn}: 09:30 → 08:55`)).toBeTruthy();
    expect(screen.getByText(`${strings.corrections.status}: Late → Present`)).toBeTruthy();
  });

  it("a record HR created says so, with no 'before'", async () => {
    detail = makeDetail(
      {},
      {
        corrections: [
          {
            id: "c1",
            correctedByName: null,
            reason: "Phone was broken",
            before: null,
            after: { checkInAt: "2026-11-03T03:35:00.000Z", checkOutAt: null, status: "PRESENT", siteName: null },
            createdAt: "2026-11-03T10:00:00.000Z",
          },
        ],
      },
    );
    renderAt("/attendance/r1");

    expect(await screen.findByText(strings.corrections.created)).toBeTruthy();
    expect(screen.getByText(`${strings.corrections.checkIn}: 09:05`)).toBeTruthy();
    expect(screen.getByText(/An administrator/)).toBeTruthy();
  });

  it("a record out of reach says it can't be found", async () => {
    server.use(http.get("/api/v1/attendance/:id", () => HttpResponse.json({ error: { code: "NOT_FOUND", message: "x" } }, { status: 404 })));
    renderAt("/attendance/r1");

    expect(await screen.findByText(strings.notFound.title)).toBeTruthy();
  });

  describe("correcting", () => {
    const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: strings.attendance.correct }));
      return screen.findByRole("dialog");
    };
    const save = (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => user.click(within(dialog).getByRole("button", { name: strings.common.save }));

    it("the plan's example: moves the check-in to 08:55, sending only that", async () => {
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      const checkInTime = box(dialog, strings.attendance.checkIn, strings.corrections.time);
      expect(checkInTime.value).toBe("09:30");
      fireEvent.change(checkInTime, { target: { value: "08:55" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Forgot to tap on arrival");
      await save(user, dialog);

      await waitFor(() => expect(corrections).toHaveLength(1));
      expect(corrections[0]).toEqual({ checkInAt: "2026-11-03T03:25:00.000Z", reason: "Forgot to tap on arrival" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("uses the company's timezone, whatever the browser's is", async () => {
      timezone = "America/New_York";
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      // 04:00 UTC is 23:00 the evening before in New York.
      const date = box(dialog, strings.attendance.checkIn, strings.corrections.date);
      const time = box(dialog, strings.attendance.checkIn, strings.corrections.time);
      expect(date.value).toBe("2026-11-02");
      expect(time.value).toBe("23:00");
      fireEvent.change(time, { target: { value: "22:30" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Forgot to tap");
      await save(user, dialog);

      await waitFor(() => expect(corrections).toHaveLength(1));
      expect(corrections[0]).toEqual({ checkInAt: "2026-11-03T03:30:00.000Z", reason: "Forgot to tap" });
    });

    it("a check-out on the next day, for a night shift", async () => {
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      fireEvent.change(box(dialog, strings.attendance.checkOut, strings.corrections.date), { target: { value: "2026-11-04" } });
      fireEvent.change(box(dialog, strings.attendance.checkOut, strings.corrections.time), { target: { value: "06:30" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Left without tapping");
      await save(user, dialog);

      await waitFor(() => expect(corrections).toHaveLength(1));
      expect(corrections[0]).toEqual({ checkOutAt: "2026-11-04T01:00:00.000Z", reason: "Left without tapping" });
    });

    it("can change the office, and clear it", async () => {
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      await user.click(within(dialog).getByRole("combobox", { name: strings.attendance.office }));
      await user.click(await screen.findByRole("option", { name: strings.attendance.noOffice }));
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Wasn't at an office");
      await save(user, dialog);

      await waitFor(() => expect(corrections).toHaveLength(1));
      expect(corrections[0]).toEqual({ siteId: null, reason: "Wasn't at an office" });
    });

    it("an ABSENT row starts with the work date and empty times", async () => {
      detail = makeDetail({ status: "ABSENT", checkInAt: null, lateMinutes: 0, checkInSiteId: null });
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      expect(box(dialog, strings.attendance.checkIn, strings.corrections.date).value).toBe("2026-11-03");
      expect(box(dialog, strings.attendance.checkIn, strings.corrections.time).value).toBe("");

      fireEvent.change(box(dialog, strings.attendance.checkIn, strings.corrections.time), { target: { value: "09:00" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Was at the site all day");
      await save(user, dialog);

      await waitFor(() => expect(corrections).toHaveLength(1));
      expect(corrections[0]).toEqual({ checkInAt: "2026-11-03T03:30:00.000Z", reason: "Was at the site all day" });
    });

    it("a stored time can't be blanked", async () => {
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      fireEvent.change(box(dialog, strings.attendance.checkIn, strings.corrections.time), { target: { value: "" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Forgot to tap");
      await save(user, dialog);

      expect(await within(dialog).findByText(strings.corrections.incompleteTime)).toBeTruthy();
      expect(corrections).toHaveLength(0);
    });

    it("needs a reason, and a change", async () => {
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      await save(user, dialog);
      expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);

      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "A good reason");
      await save(user, dialog);
      expect(await within(dialog).findByText(strings.corrections.needsChange)).toBeTruthy();
      expect(corrections).toHaveLength(0);
    });

    it("shows the server's refusal, on the field and in plain words", async () => {
      correctError = { status: 400, body: { error: { code: "VALIDATION_ERROR", message: "x", details: { formErrors: [], fieldErrors: { checkInAt: ["Check-in must be on 03 Nov 2026"] } } } } };
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      fireEvent.change(box(dialog, strings.attendance.checkIn, strings.corrections.time), { target: { value: "08:00" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Forgot to tap");
      await save(user, dialog);

      expect(await within(dialog).findByText("Check-in must be on 03 Nov 2026")).toBeTruthy();
    });

    it.each([
      ["CANNOT_CORRECT_OWN_ATTENDANCE", strings.errors.CANNOT_CORRECT_OWN_ATTENDANCE],
      ["RECORD_CHANGED", strings.errors.RECORD_CHANGED],
      ["NOTHING_TO_CORRECT", strings.errors.NOTHING_TO_CORRECT],
    ])("explains %s", async (code, message) => {
      correctError = { status: code === "RECORD_CHANGED" ? 409 : 400, body: { error: { code, message: "x" } } };
      const user = userEvent.setup();
      renderAt("/attendance/r1");
      const dialog = await openDialog(user);

      fireEvent.change(box(dialog, strings.attendance.checkIn, strings.corrections.time), { target: { value: "08:00" } });
      await user.type(within(dialog).getByLabelText(strings.corrections.reason), "Forgot to tap");
      await save(user, dialog);

      expect(await within(dialog).findByText(message)).toBeTruthy();
    });
  });
});
