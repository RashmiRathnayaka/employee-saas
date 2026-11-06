import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SiteVisitDto } from "@employee-saas/shared";
import { AuthProvider } from "../lib/authContext";
import { CompanyProvider } from "../lib/companyContext";
import { SiteVisitsPage } from "./SiteVisitsPage";
import { strings } from "../strings";

function makeVisit(overrides: Partial<SiteVisitDto> = {}): SiteVisitDto {
  return {
    id: "v1",
    employeeId: "e1",
    employeeName: "Alex Silva",
    employeeCode: "EMP-001",
    siteId: "s1",
    siteName: "Warehouse",
    attendanceRecordId: "r1",
    workDate: "2026-11-03",
    status: "CLOSED",
    checkInAt: "2026-11-03T05:12:00.000Z", // 10:42 in Colombo
    checkOutAt: "2026-11-03T06:42:00.000Z", // 12:12
    durationMinutes: 90,
    checkInAccuracyM: 10,
    checkInDistanceM: 120,
    checkInWithinRadius: true,
    checkInMocked: false,
    checkOutAccuracyM: null,
    checkOutDistanceM: null,
    checkOutWithinRadius: null,
    checkOutMocked: null,
    flags: [],
    note: null,
    isCorrected: false,
    createdAt: "2026-11-03T05:12:00.000Z",
    updatedAt: "2026-11-03T05:12:00.000Z",
    ...overrides,
  };
}

const onSite = makeVisit({
  id: "v2",
  employeeName: "Sam Perera",
  employeeCode: "EMP-002",
  siteName: "Harbour",
  status: "OPEN",
  checkOutAt: null,
  durationMinutes: null,
  checkInDistanceM: null,
  checkInWithinRadius: null,
});

let role: string;
let open: SiteVisitDto[];
let history: SiteVisitDto[];
let urls: URL[];
let moduleOff: boolean;

function respond(request: Request) {
  const url = new URL(request.url);
  urls.push(url);
  if (moduleOff) {
    return HttpResponse.json({ error: { code: "MODULE_DISABLED", message: "Off", details: { module: "sites" } } }, { status: 403 });
  }
  const rows = url.searchParams.get("openOnly") === "true" ? open : history;
  return HttpResponse.json({ data: rows, page: Number(url.searchParams.get("page") ?? 1), pageSize: 20, total: rows.length });
}

const server = setupServer(
  http.get("/api/v1/auth/me", () =>
    HttpResponse.json({ user: { id: "u1", companyId: "c1", employeeId: "e9", email: "me@acme.test", role, mustChangePassword: false } }),
  ),
  http.get("/api/v1/company", () =>
    HttpResponse.json({ company: { id: "c1", name: "Acme", code: "ACME", status: "ACTIVE", timezone: "Asia/Colombo", logoUrl: null, primaryColor: null } }),
  ),
  http.get("/api/v1/sites", () =>
    HttpResponse.json({ data: [{ id: "s1", name: "Warehouse" }, { id: "s2", name: "Harbour" }], page: 1, pageSize: 100, total: 2 }),
  ),
  http.get("/api/v1/site-visits/team", ({ request }) => respond(request)),
  http.get("/api/v1/site-visits", ({ request }) => respond(request)),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  // jsdom lacks these, and Radix's Select calls them.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  role = "HR";
  open = [];
  history = [];
  urls = [];
  moduleOff = false;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <CompanyProvider>
            <SiteVisitsPage />
          </CompanyProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastHistoryUrl = () => urls.filter((url) => url.searchParams.get("pageSize") === "20").at(-1)!;

describe("SiteVisitsPage", () => {
  describe.each([
    ["MANAGER", "/api/v1/site-visits/team"],
    ["HR", "/api/v1/site-visits"],
    ["COMPANY_ADMIN", "/api/v1/site-visits"],
  ])("as %s", (asRole, path) => {
    it(`asks ${path}, and nothing wider`, async () => {
      role = asRole;
      history = [makeVisit()];
      renderPage();

      await screen.findByText("Alex Silva");

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => url.pathname === path)).toBe(true);
    });
  });

  describe("on site now", () => {
    it("lists open visits with where and since when, in company time", async () => {
      open = [onSite];
      renderPage();

      const heading = await screen.findByText(`${strings.siteVisits.onSiteNow} (1)`);
      const section = heading.closest("div")!.parentElement!;
      expect(await within(section).findByText("Sam Perera")).toBeTruthy();
      expect(within(section).getByText("Harbour")).toBeTruthy();
      expect(within(section).getByText("03 Nov 2026, 10:42")).toBeTruthy();
      expect(within(section).getByText(strings.siteVisits.notChecked)).toBeTruthy();
    });

    it("nobody there: says so", async () => {
      renderPage();

      expect(await screen.findByText(strings.siteVisits.nobodyOnSite)).toBeTruthy();
    });
  });

  describe("history", () => {
    it("shows the visit's times, duration, distance and flags", async () => {
      history = [makeVisit({ flags: ["AFTER_HOURS"] })];
      renderPage();

      expect(await screen.findByText("Alex Silva")).toBeTruthy();
      expect(screen.getByText("EMP-001")).toBeTruthy();
      expect(screen.getByText("Warehouse")).toBeTruthy();
      expect(screen.getByText("10:42")).toBeTruthy();
      expect(screen.getByText("12:12")).toBeTruthy();
      expect(screen.getByText("1h 30m")).toBeTruthy();
      expect(screen.getByText(`120 m, ${strings.siteVisits.within}`)).toBeTruthy();
      expect(screen.getByText(strings.siteVisits.flags.AFTER_HOURS)).toBeTruthy();
    });

    it.each([
      ["AFTER_HOURS", strings.siteVisits.flags.AFTER_HOURS],
      ["ON_ABSENT_DAY", strings.siteVisits.flags.ON_ABSENT_DAY],
      ["LOW_ACCURACY", strings.siteVisits.flags.LOW_ACCURACY],
    ] as const)("names the %s flag in plain words", async (flag, label) => {
      history = [makeVisit({ flags: [flag] })];
      renderPage();

      expect(await screen.findByText(label)).toBeTruthy();
      expect(screen.queryByText(flag)).toBeNull();
    });

    it("someone outside the site area is shown as outside", async () => {
      history = [makeVisit({ checkInDistanceM: 850, checkInWithinRadius: false })];
      renderPage();

      expect(await screen.findByText(`850 m, ${strings.siteVisits.outside}`)).toBeTruthy();
    });

    it("no visits yet: says so", async () => {
      renderPage();

      expect(await screen.findByText(strings.siteVisits.noVisits)).toBeTruthy();
    });

    it("filters by date and site on the server", async () => {
      history = [makeVisit()];
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("Alex Silva");

      fireEvent.change(screen.getByLabelText(strings.siteVisits.from), { target: { value: "2026-11-01" } });
      fireEvent.change(screen.getByLabelText(strings.siteVisits.to), { target: { value: "2026-11-30" } });
      await waitFor(() => expect(lastHistoryUrl().searchParams.get("to")).toBe("2026-11-30"));
      expect(lastHistoryUrl().searchParams.get("from")).toBe("2026-11-01");

      await user.click(screen.getByRole("combobox", { name: strings.siteVisits.site }));
      await user.click(await screen.findByRole("option", { name: "Harbour" }));

      await waitFor(() => expect(lastHistoryUrl().searchParams.get("siteId")).toBe("s2"));
    });

    it("a filter that finds nothing says so, differently", async () => {
      renderPage();
      await screen.findByText(strings.siteVisits.noVisits);

      fireEvent.change(screen.getByLabelText(strings.siteVisits.from), { target: { value: "2026-11-01" } });

      expect(await screen.findByText(strings.siteVisits.noMatches)).toBeTruthy();
    });

    it("explains a backwards range instead of asking the server", async () => {
      renderPage();
      await screen.findByText(strings.siteVisits.noVisits);
      const before = urls.length;

      fireEvent.change(screen.getByLabelText(strings.siteVisits.from), { target: { value: "2026-11-30" } });
      await waitFor(() => expect(urls.length).toBeGreaterThan(before));
      const afterFrom = urls.length;
      fireEvent.change(screen.getByLabelText(strings.siteVisits.to), { target: { value: "2026-11-01" } });

      expect((await screen.findByRole("alert")).textContent).toBe("The end date is before the start date");
      expect(urls.length).toBe(afterFrom);
    });

    it("explains a range that's too long", async () => {
      renderPage();
      await screen.findByText(strings.siteVisits.noVisits);

      fireEvent.change(screen.getByLabelText(strings.siteVisits.from), { target: { value: "2026-01-01" } });
      fireEvent.change(screen.getByLabelText(strings.siteVisits.to), { target: { value: "2026-12-31" } });

      expect((await screen.findByRole("alert")).textContent).toBe("Choose a range of 93 days or less");
    });
  });

  it("never shows a position, even if one reached the page", async () => {
    history = [{ ...makeVisit(), checkInLat: 6.927079, checkInLng: 79.861244 } as SiteVisitDto];
    const { container } = renderPage();

    await screen.findByText("Alex Silva");

    expect(container.textContent).not.toContain("79.86");
  });

  it("with the module off: one clear message", async () => {
    moduleOff = true;
    renderPage();

    expect(await screen.findByText(strings.sites.moduleOff)).toBeTruthy();
    expect(screen.queryByText(strings.siteVisits.onSiteNow)).toBeNull();
  });
});
