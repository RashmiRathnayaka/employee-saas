import { describe, expect, it } from "vitest";
import { visibleNavItems } from "./navigation";

const paths = (...args: Parameters<typeof visibleNavItems>) => visibleNavItems(...args).map((item) => item.to);

describe("visibleNavItems", () => {
  it.each(["COMPANY_ADMIN", "HR"] as const)("shows Sites to %s while the module is on", (role) => {
    expect(paths(role, { enabledModules: { sites: true } })).toContain("/sites");
  });

  it("hides Sites when the module is off, or only another module is on", () => {
    expect(paths("HR", { enabledModules: { sites: false } })).not.toContain("/sites");
    expect(paths("HR", { enabledModules: { attendance: true } })).not.toContain("/sites");
    expect(paths("HR", { enabledModules: {} })).not.toContain("/sites");
  });

  it("hides Sites until settings have loaded", () => {
    expect(paths("HR", undefined)).not.toContain("/sites");
  });

  it.each(["MANAGER", "EMPLOYEE", "SUPER_ADMIN"] as const)("never shows Sites to %s", (role) => {
    expect(paths(role, { enabledModules: { sites: true } })).not.toContain("/sites");
  });

  it.each(["COMPANY_ADMIN", "HR", "MANAGER"] as const)("shows Site visits to %s while the module is on", (role) => {
    expect(paths(role, { enabledModules: { sites: true } })).toContain("/site-visits");
    expect(paths(role, { enabledModules: { attendance: true } })).not.toContain("/site-visits");
    expect(paths(role, undefined)).not.toContain("/site-visits");
  });

  it.each(["EMPLOYEE", "SUPER_ADMIN"] as const)("never shows Site visits to %s", (role) => {
    expect(paths(role, { enabledModules: { sites: true } })).not.toContain("/site-visits");
  });

  it("still shows items that have no module, with or without settings", () => {
    expect(paths("HR", undefined)).toContain("/departments");
    expect(paths("HR", { enabledModules: {} })).toContain("/departments");
  });
});
