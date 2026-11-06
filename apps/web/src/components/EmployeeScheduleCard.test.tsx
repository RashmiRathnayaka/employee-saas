import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EmployeeScheduleResponse } from "@employee-saas/shared";
import { ToastProvider } from "../lib/toast";
import { EmployeeScheduleCard } from "./EmployeeScheduleCard";
import { strings } from "../strings";

const WEEK = { mon: "FULL", tue: "FULL", wed: "FULL", thu: "FULL", fri: "FULL", sat: "HALF", sun: "OFF" } as const;
const COMPANY: EmployeeScheduleResponse = {
  schedule: { source: "COMPANY", startTime: "09:00", endTime: "17:00", halfDayEndTime: "13:00", lateGraceMinutes: 10, workingDays: WEEK },
  override: null,
};
const NIGHT: EmployeeScheduleResponse = {
  schedule: { ...COMPANY.schedule, source: "OVERRIDE", startTime: "22:00", endTime: "06:00", lateGraceMinutes: 5 },
  override: { startTime: "22:00", endTime: "06:00", workingDays: null, lateGraceMinutes: 5, updatedAt: "2026-11-03T00:00:00.000Z" },
};

let modules: Record<string, boolean>;
let response: EmployeeScheduleResponse;
let puts: unknown[];
let deletes: number;
let requests: number;
let putError: { status: number; body: object } | null;

const server = setupServer(
  http.get("/api/v1/company/settings", () => HttpResponse.json({ settings: { enabledModules: modules } })),
  http.get("/api/v1/employees/:id/schedule", () => {
    requests += 1;
    return HttpResponse.json(response);
  }),
  http.put("/api/v1/employees/:id/schedule", async ({ request }) => {
    if (putError) return HttpResponse.json(putError.body, { status: putError.status });
    puts.push(await request.json());
    response = NIGHT;
    return HttpResponse.json(NIGHT);
  }),
  http.delete("/api/v1/employees/:id/schedule", () => {
    deletes += 1;
    response = COMPANY;
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  modules = { attendance: true };
  response = COMPANY;
  puts = [];
  deletes = 0;
  requests = 0;
  putError = null;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderCard(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <EmployeeScheduleCard employeeId="e1" canEdit={canEdit} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("EmployeeScheduleCard", () => {
  it("shows the company's hours, grace and week", async () => {
    renderCard();

    expect(await screen.findByText(strings.schedule.sourceCompany)).toBeTruthy();
    expect(screen.getByText("09:00 - 17:00")).toBeTruthy();
    expect(screen.getByText(strings.schedule.graceValue(10))).toBeTruthy();
    expect(screen.getByText(`${strings.schedule.days.sat}: ${strings.schedule.half}`)).toBeTruthy();
    expect(screen.getByText(`${strings.schedule.days.sun}: ${strings.schedule.off}`)).toBeTruthy();
  });

  it("a night shift says it ends the next day", async () => {
    response = NIGHT;
    renderCard();

    expect(await screen.findByText(`22:00 - 06:00 (${strings.schedule.nextDay})`)).toBeTruthy();
    expect(screen.getByText(strings.schedule.sourceOverride)).toBeTruthy();
  });

  it("with the module off, it isn't shown or asked for", async () => {
    modules = {};
    const { container } = renderCard();

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(requests).toBe(0);
  });

  it("a manager reads it, with no way to change it", async () => {
    response = NIGHT;
    renderCard(false);

    await screen.findByText(strings.schedule.sourceOverride);

    expect(screen.queryByRole("button", { name: strings.schedule.editOverride })).toBeNull();
    expect(screen.queryByRole("button", { name: strings.schedule.removeOverride })).toBeNull();
  });

  it("the plan's example: a night shift override, following the company's week and grace", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: strings.schedule.setOverride }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(strings.schedule.startTime), { target: { value: "22:00" } });
    fireEvent.change(within(dialog).getByLabelText(strings.schedule.endTime), { target: { value: "06:00" } });
    await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ startTime: "22:00", endTime: "06:00", lateGraceMinutes: null, workingDays: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(`22:00 - 06:00 (${strings.schedule.nextDay})`)).toBeTruthy();
  });

  it("an own week and grace are sent when asked for", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: strings.schedule.setOverride }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(strings.schedule.graceOptional), { target: { value: "0" } });
    await user.click(within(dialog).getByRole("checkbox", { name: strings.schedule.followCompanyWeek }));
    await user.click(within(dialog).getByRole("combobox", { name: strings.schedule.days.sun }));
    await user.click(await screen.findByRole("option", { name: strings.schedule.full }));
    await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ startTime: "09:00", endTime: "17:00", lateGraceMinutes: 0, workingDays: { ...WEEK, sun: "FULL" } });
  });

  it("explains a shift that's too long, and sends nothing", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: strings.schedule.setOverride }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(strings.schedule.startTime), { target: { value: "06:00" } });
    fireEvent.change(within(dialog).getByLabelText(strings.schedule.endTime), { target: { value: "23:00" } });
    await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

    expect(await within(dialog).findByText("A shift must be between 1 and 16 hours long")).toBeTruthy();
    expect(puts).toHaveLength(0);
  });

  it("shows a refusal from the server on its field", async () => {
    putError = { status: 400, body: { error: { code: "VALIDATION_ERROR", message: "x", details: { formErrors: [], fieldErrors: { endTime: ["Not that one"] } } } } };
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: strings.schedule.setOverride }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

    expect(await within(dialog).findByText("Not that one")).toBeTruthy();
  });

  it("editing starts from what's there", async () => {
    response = NIGHT;
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: strings.schedule.editOverride }));
    const dialog = await screen.findByRole("dialog");

    expect((within(dialog).getByLabelText(strings.schedule.startTime) as HTMLInputElement).value).toBe("22:00");
    expect((within(dialog).getByLabelText(strings.schedule.graceOptional) as HTMLInputElement).value).toBe("5");
  });

  it("going back to company hours asks first", async () => {
    response = NIGHT;
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: strings.schedule.removeOverride }));
    const dialog = await screen.findByRole("dialog");
    expect(deletes).toBe(0);
    await user.click(within(dialog).getByRole("button", { name: strings.common.confirm }));

    await waitFor(() => expect(deletes).toBe(1));
    expect(await screen.findByText(strings.schedule.sourceCompany)).toBeTruthy();
  });

  it("company hours have nothing to remove", async () => {
    renderCard();

    await screen.findByText(strings.schedule.sourceCompany);

    expect(screen.queryByRole("button", { name: strings.schedule.removeOverride })).toBeNull();
  });
});
