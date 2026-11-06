import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanyDto, CompanySettingsDto } from "@employee-saas/shared";
import { ToastProvider } from "../lib/toast";
import { CompanySettingsPage } from "./CompanySettingsPage";
import { strings } from "../strings";

const company: CompanyDto = {
  id: "c1",
  name: "Acme",
  code: "ACME",
  status: "ACTIVE",
  timezone: "Asia/Colombo",
  logoUrl: null,
  primaryColor: "#4F46E5",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const defaults: CompanySettingsDto = {
  companyId: "c1",
  leaveApprovalWorkflow: "MANAGER_ONLY",
  sickLeaveProofDeadlineDays: 3,
  gpsCheckinEnabledDefault: false,
  gpsRadiusMeters: 200,
  employeeIdPrefix: "EMP-",
  employeeIdNextNumber: 1,
  enabledModules: {},
  workingDays: { mon: "FULL", tue: "FULL", wed: "FULL", thu: "FULL", fri: "FULL", sat: "HALF", sun: "OFF" },
  workStartTime: "09:00",
  workEndTime: "17:00",
  halfDayEndTime: "13:00",
  lateGraceMinutes: 10,
  autoCheckoutAfterMinutes: 240,
  checkinReminderEnabled: true,
  checkinReminderOffsetMinutes: 0,
  proofRemindersEnabled: true,
  dailyReminderTime: "09:00",
  gpsMaxAccuracyMeters: 100,
  gpsRetentionDays: 90,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let stored: CompanySettingsDto;
let patches: Record<string, unknown>[];

const server = setupServer(
  http.get("/api/v1/company", () => HttpResponse.json({ company })),
  http.get("/api/v1/company/settings", () => HttpResponse.json({ settings: stored })),
  http.patch("/api/v1/company/settings", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    patches.push(body);
    stored = { ...stored, ...body } as CompanySettingsDto;
    return HttpResponse.json({ settings: stored });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  stored = { ...defaults };
  patches = [];
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CompanySettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** The cards' Save buttons, in page order: profile, settings, modules, attendance. */
async function saveButton(card: "modules" | "attendance") {
  const buttons = await screen.findAllByRole("button", { name: strings.settings.save });
  return buttons[card === "modules" ? 2 : 3]!;
}

describe("CompanySettingsPage", () => {
  it("shows modules off by default, and sends the chosen switches when saved", async () => {
    renderPage();
    const user = userEvent.setup();

    const attendance = await screen.findByRole("checkbox", { name: strings.settings.moduleAttendance });
    expect(attendance).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: strings.settings.moduleSites })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: strings.settings.moduleTasks })).not.toBeChecked();

    await user.click(attendance);
    await user.click(screen.getByRole("checkbox", { name: strings.settings.moduleTasks }));
    await user.click(await saveButton("modules"));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ enabledModules: { attendance: true, sites: false, tasks: true } });
  });

  it("shows saved values again after a reload", async () => {
    stored = {
      ...defaults,
      enabledModules: { attendance: true, sites: false },
      workStartTime: "08:30",
      gpsRetentionDays: 120,
      checkinReminderEnabled: false,
    };
    renderPage();

    expect(await screen.findByRole("checkbox", { name: strings.settings.moduleAttendance })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: strings.settings.moduleSites })).not.toBeChecked();
    expect(screen.getByLabelText(strings.settings.workStartTime)).toHaveValue("08:30");
    expect(screen.getByLabelText(strings.settings.gpsRetentionDays)).toHaveValue(120);
    expect(screen.getByRole("checkbox", { name: strings.settings.checkinReminderEnabled })).not.toBeChecked();
  });

  it("saves the attendance card without touching modules or leave settings", async () => {
    renderPage();
    const user = userEvent.setup();

    fireEvent.change(await screen.findByLabelText(strings.settings.workEndTime), { target: { value: "18:15" } });
    fireEvent.change(screen.getByLabelText(strings.settings.lateGraceMinutes), { target: { value: "20" } });
    await user.click(screen.getByRole("checkbox", { name: strings.settings.proofRemindersEnabled }));
    await user.click(await saveButton("attendance"));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      workStartTime: "09:00",
      workEndTime: "18:15",
      halfDayEndTime: "13:00",
      lateGraceMinutes: 20,
      autoCheckoutAfterMinutes: 240,
      checkinReminderEnabled: true,
      checkinReminderOffsetMinutes: 0,
      proofRemindersEnabled: false,
      dailyReminderTime: "09:00",
      gpsMaxAccuracyMeters: 100,
      gpsRetentionDays: 90,
    });
    expect(await screen.findByText(strings.settings.saved)).toBeInTheDocument();
  });

  it("shows an out-of-range error next to the field and doesn't send anything", async () => {
    renderPage();
    const user = userEvent.setup();

    fireEvent.change(await screen.findByLabelText(strings.settings.gpsRetentionDays), { target: { value: "10" } });
    await user.click(await saveButton("attendance"));

    expect(await screen.findByText("Must be between 30 and 365")).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  it("shows an error for an emptied number or time field instead of doing nothing", async () => {
    renderPage();
    const user = userEvent.setup();

    fireEvent.change(await screen.findByLabelText(strings.settings.lateGraceMinutes), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(strings.settings.workStartTime), { target: { value: "" } });
    await user.click(await saveButton("attendance"));

    expect(await screen.findByText("Must be between 0 and 240")).toBeInTheDocument();
    expect(await screen.findByText("Use 24-hour time, like 09:00")).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  it("puts a server validation error on its field", async () => {
    server.use(
      http.patch("/api/v1/company/settings", () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed",
              details: { fieldErrors: { gpsMaxAccuracyMeters: ["Rejected by the server"] } },
            },
          },
          { status: 400 },
        ),
      ),
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByLabelText(strings.settings.gpsMaxAccuracyMeters);
    await user.click(await saveButton("attendance"));

    expect(await screen.findByText("Rejected by the server")).toBeInTheDocument();
  });

  it("shows a toast for any other server error", async () => {
    server.use(
      http.patch("/api/v1/company/settings", () =>
        HttpResponse.json({ error: { code: "FORBIDDEN", message: "No" } }, { status: 403 }),
      ),
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByRole("checkbox", { name: strings.settings.moduleSites });
    await user.click(await saveButton("modules"));

    expect(await screen.findByText(strings.errors.FORBIDDEN)).toBeInTheDocument();
  });
});
