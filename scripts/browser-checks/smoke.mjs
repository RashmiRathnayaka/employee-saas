/**
 * The smallest useful check, and a template for new ones: logs in on the real page
 * as seeded users (so run `start --seed` first) and reads a page through the real API.
 *
 *   node scripts/browser-check.mjs run scripts/browser-checks/smoke.mjs
 */
export default async function smoke({ newPage, login, check, apiUrl }) {
  await check("the temporary API answers", async () => {
    const res = await fetch(`${apiUrl}/api/v1/health`);
    return res.status === 200;
  });

  const page = await newPage();
  await check("HR can log in on the real page", () => login(page, "hr@acme.test"));
  await check("the proxy reaches the temporary API", async () => {
    const res = await page.request.get("/api/v1/health");
    return res.status() === 200;
  });
  await check("the employees page lists seeded people", async () => {
    await page.goto("/employees");
    await page.getByText("Alex").first().waitFor();
  });
}
