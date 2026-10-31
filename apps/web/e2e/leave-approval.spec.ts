import { test, expect, type Page } from "@playwright/test";

// Runs against the real dev API + seeded ACME company (see prisma/seed.ts):
// alex@acme.test (EMPLOYEE, reports to manager@acme.test) applies for leave,
// manager@acme.test approves it, then alex sees it APPROVED with an updated
// balance. Uses a near-future date (2 weeks out) rather than next year -
// GET /leave-balances/me only ever returns the *current* calendar year's
// balance row, so a request dated into next year would move days in a
// balance row this page never displays, making "the updated balance" part
// of this test unobservable. Reruns on the same day are still safe: cleanup
// revokes the request, and REVOKED isn't in the overlap-check status set.
const PASSWORD = "Passw0rd!";

function daysFromNow(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function login(page: Page, identifier: string) {
  await page.goto("/login");
  await page.getByLabel("Company code").fill("ACME");
  await page.getByLabel("Employee code or email").fill(identifier);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Welcome")).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: /alex|manager|admin/i }).click();
  await page.getByText("Log out").click();
  await expect(page).toHaveURL(/\/login$/);
}

test("employee applies for leave -> manager approves -> employee sees APPROVED and the updated balance", async ({ page }) => {
  const startDate = daysFromNow(14);
  const endDate = daysFromNow(16);

  await login(page, "alex@acme.test");

  await page.goto("/my-leave");
  await expect(page.getByText("Apply for leave")).toBeVisible();

  const balanceBefore = await page.locator("text=Annual Leave").locator("..").locator("p.text-xl").innerText();

  await page.getByLabel("Leave type").selectOption({ label: "Annual Leave" });
  await page.getByLabel("Start date").fill(startDate);
  await page.getByLabel("End date").fill(endDate);
  // Not asserting an exact day count - which weekdays fall in range (and so
  // how many count as working days) shifts depending on which date "a year
  // from today" lands on.
  await expect(page.getByText(/Total days: \d/)).toBeVisible();
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Leave request submitted")).toBeVisible();

  await logout(page);

  await login(page, "manager@acme.test");
  await page.goto("/leave-requests/team");
  await page.getByText("Annual Leave").first().click();
  await expect(page.getByRole("heading", { name: /Annual Leave/ })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Request approved")).toBeVisible();

  const approvedUrl = page.url();
  const requestId = approvedUrl.split("/").pop();

  await logout(page);

  await login(page, "alex@acme.test");
  await page.goto("/my-leave");
  await expect(page.getByText("APPROVED").first()).toBeVisible();

  const balanceAfter = await page.locator("text=Annual Leave").locator("..").locator("p.text-xl").innerText();
  expect(Number(balanceAfter)).toBeLessThan(Number(balanceBefore));

  await logout(page);

  // Cleanup: revoke as COMPANY_ADMIN so reruns on the same day don't hit
  // LEAVE_OVERLAP against this request.
  await login(page, "admin@acme.test");
  await page.goto(`/leave-requests/${requestId}`);
  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("REVOKED").first()).toBeVisible();
});
