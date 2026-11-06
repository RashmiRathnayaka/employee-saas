import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SiteDto } from "@employee-saas/shared";
import { ToastProvider } from "../lib/toast";
import { SitesPage } from "./SitesPage";
import { strings } from "../strings";

const office: SiteDto = {
  id: "s1",
  name: "Head Office",
  type: "OFFICE",
  address: "1 Galle Road",
  latitude: 6.927079,
  longitude: 79.861244,
  radiusMeters: 200,
  gpsRequired: true,
  isActive: true,
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
};

const depot: SiteDto = {
  ...office,
  id: "s2",
  name: "Old Depot",
  type: "EXTERNAL",
  address: null,
  latitude: null,
  longitude: null,
  gpsRequired: false,
  isActive: false,
};

let sites: SiteDto[];
let settings: Record<string, unknown>;
let posts: Record<string, unknown>[];
let patches: { id: string; body: Record<string, unknown> }[];
let statusChanges: { id: string; body: Record<string, unknown> }[];
let deletes: string[];
let listUrls: string[];

const server = setupServer(
  http.get("/api/v1/company/settings", () => HttpResponse.json({ settings })),
  http.get("/api/v1/sites", ({ request }) => {
    listUrls.push(request.url);
    return HttpResponse.json({ data: sites, page: 1, pageSize: 20, total: sites.length });
  }),
  http.post("/api/v1/sites", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    posts.push(body);
    return HttpResponse.json({ site: { ...office, ...body, id: "new" } }, { status: 201 });
  }),
  http.patch("/api/v1/sites/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    patches.push({ id: params.id as string, body });
    return HttpResponse.json({ site: { ...office, ...body } });
  }),
  http.patch("/api/v1/sites/:id/status", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    statusChanges.push({ id: params.id as string, body });
    return HttpResponse.json({ site: { ...office, ...body } });
  }),
  http.delete("/api/v1/sites/:id", ({ params }) => {
    deletes.push(params.id as string);
    return new HttpResponse(null, { status: 204 });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  // jsdom lacks these, and Radix's Select calls them.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  sites = [office, depot];
  settings = { gpsRadiusMeters: 350, gpsCheckinEnabledDefault: false };
  posts = [];
  patches = [];
  statusChanges = [];
  deletes = [];
  listUrls = [];
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SitesPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function openNewSiteForm(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole("button", { name: strings.sites.newSite });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  return screen.findByRole("dialog");
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("SitesPage", () => {
  it("lists sites, with a map link only for a site that has coordinates", async () => {
    renderPage();

    expect(await screen.findByText("Head Office")).toBeInTheDocument();
    expect(screen.getByText("Old Depot")).toBeInTheDocument();
    expect(screen.getByText(strings.sites.noLocation)).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: new RegExp(strings.sites.openInMaps) });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=6.927079,79.861244");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("explains an empty list", async () => {
    sites = [];
    renderPage();
    expect(await screen.findByText(strings.sites.noSites)).toBeInTheDocument();
  });

  it("says when the module is off, and offers no way to add a site", async () => {
    server.use(
      http.get("/api/v1/sites", () =>
        HttpResponse.json({ error: { code: "MODULE_DISABLED", message: "Off", details: { module: "sites" } } }, { status: 403 }),
      ),
    );
    renderPage();

    expect(await screen.findByText(strings.sites.moduleOff)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.sites.newSite })).not.toBeInTheDocument();
  });

  it("offers Retry for any other load failure", async () => {
    server.use(
      http.get("/api/v1/sites", () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "Boom" } }, { status: 500 })),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: strings.common.retry })).toBeInTheDocument();
  });

  it("sends the search and filters to the API", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Head Office");

    await user.type(screen.getByLabelText(strings.sites.search), "depot");
    await waitFor(() => expect(listUrls.at(-1)).toContain("q=depot"));

    await user.click(screen.getByRole("combobox", { name: strings.sites.type }));
    await user.click(await screen.findByRole("option", { name: strings.sites.external }));
    await waitFor(() => expect(listUrls.at(-1)).toContain("type=EXTERNAL"));

    await user.click(screen.getByRole("combobox", { name: strings.table.status }));
    await user.click(await screen.findByRole("option", { name: strings.sites.inactive }));
    await waitFor(() => expect(listUrls.at(-1)).toContain("active=false"));
  });

  describe("create form", () => {
    it("starts from the company's defaults", async () => {
      settings = { gpsRadiusMeters: 350, gpsCheckinEnabledDefault: true };
      renderPage();
      const user = userEvent.setup();

      const dialog = await openNewSiteForm(user);

      expect(within(dialog).getByLabelText(strings.sites.radiusMeters)).toHaveValue(350);
      expect(within(dialog).getByRole("checkbox", { name: strings.sites.gpsRequired })).toBeChecked();
    });

    it("saves a site with numbers for the coordinates", async () => {
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Branch");
      setField(strings.sites.addressOptional, "Kandy Road");
      setField(strings.sites.latitude, "7.2906");
      setField(strings.sites.longitude, "80.6337");
      await user.click(screen.getByRole("button", { name: strings.common.save }));

      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({
        name: "Branch",
        type: "OFFICE",
        address: "Kandy Road",
        latitude: 7.2906,
        longitude: 80.6337,
        radiusMeters: 350,
        gpsRequired: false,
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(await screen.findByText(strings.sites.saved)).toBeInTheDocument();
    });

    it("sends null for blank coordinates, not zero", async () => {
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Yard");
      await user.click(screen.getByRole("button", { name: strings.common.save }));

      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({ latitude: null, longitude: null });
    });

    it("shows the check link once both coordinates are valid", async () => {
      renderPage();
      const user = userEvent.setup();
      const dialog = await openNewSiteForm(user);
      const link = () => within(dialog).queryByRole("link", { name: new RegExp(strings.sites.openInMapsCheck) });

      expect(link()).not.toBeInTheDocument();

      setField(strings.sites.latitude, "7.2906");
      expect(link()).not.toBeInTheDocument();

      setField(strings.sites.longitude, "80.6337");
      await waitFor(() => expect(link()).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=7.2906,80.6337"));

      setField(strings.sites.latitude, "120");
      await waitFor(() => expect(link()).not.toBeInTheDocument());
    });

    it.each([
      [strings.sites.latitude, "91", "Latitude must be between -90 and 90"],
      [strings.sites.latitude, "abc", "Latitude must be between -90 and 90"],
      [strings.sites.longitude, "181", "Longitude must be between -180 and 180"],
      [strings.sites.radiusMeters, "10", "Must be between 25 and 5000"],
    ])("rejects %s = %s next to the field, and sends nothing", async (label, value, message) => {
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Branch");
      setField(label, value);
      await user.click(screen.getByRole("button", { name: strings.common.save }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(posts).toHaveLength(0);
    });

    it("puts a server location error on its field and keeps the form open", async () => {
      server.use(
        http.post("/api/v1/sites", () =>
          HttpResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Request validation failed",
                details: { fieldErrors: { latitude: ["A site that requires GPS needs coordinates"] } },
              },
            },
            { status: 400 },
          ),
        ),
      );
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Branch");
      await user.click(screen.getByRole("button", { name: strings.common.save }));

      expect(await screen.findByText("A site that requires GPS needs coordinates")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("clears a server location error as soon as the coordinates are edited", async () => {
      server.use(
        http.post("/api/v1/sites", () =>
          HttpResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Request validation failed",
                details: { fieldErrors: { latitude: ["A site that requires GPS needs coordinates"] } },
              },
            },
            { status: 400 },
          ),
        ),
      );
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Branch");
      await user.click(screen.getByRole("button", { name: strings.common.save }));
      await screen.findByText("A site that requires GPS needs coordinates");

      setField(strings.sites.latitude, "6.9");

      await waitFor(() => expect(screen.queryByText("A site that requires GPS needs coordinates")).not.toBeInTheDocument());
    });

    it("clears a location error on either field when the other one is edited", async () => {
      server.use(
        http.post("/api/v1/sites", () =>
          HttpResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Request validation failed",
                details: { fieldErrors: { longitude: ["Enter the longitude too"] } },
              },
            },
            { status: 400 },
          ),
        ),
      );
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Branch");
      setField(strings.sites.latitude, "6.9");
      await user.click(screen.getByRole("button", { name: strings.common.save }));
      await screen.findByText("Enter the longitude too");

      // Removing the latitude also resolves "half a position".
      setField(strings.sites.latitude, "");

      await waitFor(() => expect(screen.queryByText("Enter the longitude too")).not.toBeInTheDocument());
    });

    it("clears the GPS error when GPS is unticked", async () => {
      settings = { gpsRadiusMeters: 200, gpsCheckinEnabledDefault: true };
      server.use(
        http.post("/api/v1/sites", () =>
          HttpResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Request validation failed",
                details: { fieldErrors: { latitude: ["A site that requires GPS needs coordinates"] } },
              },
            },
            { status: 400 },
          ),
        ),
      );
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Branch");
      await user.click(screen.getByRole("button", { name: strings.common.save }));
      await screen.findByText("A site that requires GPS needs coordinates");

      await user.click(screen.getByRole("checkbox", { name: strings.sites.gpsRequired }));

      await waitFor(() => expect(screen.queryByText("A site that requires GPS needs coordinates")).not.toBeInTheDocument());
    });

    it("puts a taken name on the name field", async () => {
      server.use(
        http.post("/api/v1/sites", () =>
          HttpResponse.json({ error: { code: "SITE_NAME_TAKEN", message: "Taken" } }, { status: 409 }),
        ),
      );
      renderPage();
      const user = userEvent.setup();
      await openNewSiteForm(user);

      setField(strings.sites.name, "Head Office");
      await user.click(screen.getByRole("button", { name: strings.common.save }));

      expect(await screen.findByRole("alert")).toHaveTextContent(strings.errors.SITE_NAME_TAKEN);
    });
  });

  it("edits a site, starting from its current values", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: `${strings.sites.edit} Head Office` }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(strings.sites.name)).toHaveValue("Head Office");
    expect(within(dialog).getByLabelText(strings.sites.latitude)).toHaveValue("6.927079");
    expect(within(dialog).getByRole("checkbox", { name: strings.sites.gpsRequired })).toBeChecked();

    setField(strings.sites.radiusMeters, "500");
    await user.click(within(dialog).getByRole("button", { name: strings.common.save }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      id: "s1",
      body: { name: "Head Office", radiusMeters: 500, latitude: 6.927079, longitude: 79.861244 },
    });
  });

  it("deactivates only after confirming", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: `${strings.sites.deactivate} Head Office` }));
    expect(statusChanges).toHaveLength(0);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: strings.sites.deactivate }));

    await waitFor(() => expect(statusChanges).toEqual([{ id: "s1", body: { isActive: false } }]));
    expect(await screen.findByText(strings.sites.deactivated)).toBeInTheDocument();
  });

  it("activates an inactive site straight away", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: `${strings.sites.activate} Old Depot` }));

    await waitFor(() => expect(statusChanges).toEqual([{ id: "s2", body: { isActive: true } }]));
  });

  it("deletes after confirming", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: `${strings.sites.delete} Old Depot` }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: strings.sites.delete }));

    await waitFor(() => expect(deletes).toEqual(["s2"]));
  });

  it("explains a site that's in use when deleting it fails", async () => {
    server.use(
      http.delete("/api/v1/sites/:id", () => HttpResponse.json({ error: { code: "SITE_IN_USE", message: "In use" } }, { status: 409 })),
    );
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: `${strings.sites.delete} Head Office` }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: strings.sites.delete }));

    expect(await screen.findByText(strings.errors.SITE_IN_USE)).toBeInTheDocument();
  });
});
