#!/usr/bin/env node
/**
 * Real-browser check: runs the app on its own temporary servers, against the TEST
 * database, next to whatever you have running. Unit tests fake the server and the
 * browser; this is how you see a real page talk to a real API.
 *
 *   node scripts/browser-check.mjs start [--reset] [--seed]   start the temp API + temp Vite
 *   node scripts/browser-check.mjs run <check.mjs>            run a check against them
 *   node scripts/browser-check.mjs stop                       stop them
 *   node scripts/browser-check.mjs status                     say what's listening on 4001/5199
 *
 * A typical session:
 *   node scripts/browser-check.mjs start --reset --seed
 *   node scripts/browser-check.mjs run scripts/browser-checks/smoke.mjs
 *   node scripts/browser-check.mjs stop
 *
 * What it starts:
 *   - API on 4001, with apps/api/.env.test (so employee_saas_test, never your dev data)
 *   - Vite on 5199, proxying /api to 4001. It uses apps/web/vite.config.ts plus these
 *     two settings given in code, so no temporary config file is left behind.
 *
 * Safety rules, enforced below:
 *   - It only ever stops what's listening on 4001 and 5199, looked up right before
 *     stopping. 4000 and 5173 are the developer's own `pnpm dev`, and never touched.
 *   - It refuses to run if .env.test doesn't point at a database named *_test.
 *   - `--reset` empties that test database, and `--seed` runs the seed on it. Neither can
 *     reach your dev data. The test suite truncates the test database too, so seed again
 *     after running tests.
 *
 * Writing a check: a module whose default export receives { newPage, login, check, apiUrl,
 * webUrl }. See scripts/browser-checks/smoke.mjs. `login` signs in on the real page.
 * All seeded users share the password Passw0rd!.
 *
 * Login is rate-limited in the API's memory. If a check logs in many times and starts
 * failing with 429, `stop` and `start` again to clear it.
 *
 * Playwright's browser must be installed once:
 *   pnpm --filter @employee-saas/web exec playwright install chromium
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_PORT = 4001;
const WEB_PORT = 5199;
/** The only ports this script will ever stop anything on. */
const OWN_PORTS = [API_PORT, WEB_PORT];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(repoRoot, "apps", "api");
const webRoot = path.join(repoRoot, "apps", "web");
const logDir = path.join(os.tmpdir(), "employee-saas-browser-check");
const apiUrl = `http://localhost:${API_PORT}`;
const webUrl = `http://localhost:${WEB_PORT}`;
const isWindows = process.platform === "win32";

/** Every process id listening on a port. Works on Windows, macOS and Linux. */
function pidsListeningOn(port) {
  try {
    if (isWindows) {
      const output = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      const v6 = execFileSync("netstat", ["-ano", "-p", "TCPv6"], { encoding: "utf8" });
      const pids = `${output}\n${v6}`
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter((cols) => cols[3] === "LISTENING" && cols[1]?.endsWith(`:${port}`))
        .map((cols) => cols[4]);
      return [...new Set(pids)];
    }
    return execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function assertTestDatabase() {
  const envFile = path.join(apiRoot, ".env.test");
  if (!fs.existsSync(envFile)) throw new Error("apps/api/.env.test is missing. See the README, 'Running tests'.");
  const url = fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1] ?? "";
  const database = new URL(url).pathname.slice(1);
  if (!database.endsWith("_test")) throw new Error(`apps/api/.env.test points at "${database}", not a *_test database. Refusing.`);
}

/** Runs a command in apps/api with .env.test loaded. */
function runWithTestEnv(args) {
  execFileSync("pnpm", ["exec", "dotenv", "-e", ".env.test", "--", ...args], { cwd: apiRoot, stdio: "inherit", shell: isWindows });
}

/** Detached with its output in a file, so it outlives this command. */
function startDetached(name, command, args, cwd) {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${name}.log`);
  const log = fs.openSync(logFile, "w");
  const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", log, log], shell: isWindows, windowsHide: true });
  child.unref();
  return logFile;
}

async function waitFor(url, logFile, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} didn't answer within ${timeoutMs / 1000} s. See ${logFile}`);
}

async function start({ seed, reset }) {
  assertTestDatabase();
  const busy = OWN_PORTS.filter((port) => pidsListeningOn(port).length > 0);
  if (busy.length > 0) throw new Error(`Already in use: ${busy.join(", ")}. Run "stop" first.`);

  runWithTestEnv(["prisma", "migrate", "deploy"]);
  if (reset) {
    const resetFile = path.join(repoRoot, "scripts", "browser-checks", "reset-test-db.sql");
    runWithTestEnv(["prisma", "db", "execute", "--file", resetFile, "--schema", "prisma/schema.prisma"]);
  }
  if (seed) runWithTestEnv(["tsx", "prisma/seed.ts"]);

  const apiLog = startDetached("api", "pnpm", ["exec", "dotenv", "-e", ".env.test", "--", "tsx", "src/server.ts"], apiRoot);
  // This file again, as a separate long-running process: see serveWeb().
  const webLog = startDetached("web", process.execPath, [fileURLToPath(import.meta.url), "serve-web"], repoRoot);

  await waitFor(`${apiUrl}/api/v1/health`, apiLog);
  await waitFor(webUrl, webLog);
  console.log(`API ${apiUrl}  (log: ${apiLog})`);
  console.log(`Web ${webUrl}  (log: ${webLog})`);
}

/** Vite on our port, with the proxy pointed at our API. `strictPort` makes it fail
 * rather than quietly pick another port. */
async function serveWeb() {
  const viteEntry = path.join(webRoot, "node_modules", "vite", "dist", "node", "index.js");
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    server: {
      port: WEB_PORT,
      strictPort: true,
      proxy: { "/api": { target: apiUrl, changeOrigin: true } },
    },
  });
  await server.listen();
  server.printUrls();
}

function stop() {
  for (const port of OWN_PORTS) {
    const pids = pidsListeningOn(port);
    for (const pid of pids) {
      if (isWindows) execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
      else process.kill(Number(pid), "SIGTERM");
      console.log(`Stopped process ${pid} on port ${port}`);
    }
    if (pids.length === 0) console.log(`Nothing listening on port ${port}`);
  }
}

function status() {
  for (const port of OWN_PORTS) {
    const pids = pidsListeningOn(port);
    console.log(`Port ${port}: ${pids.length > 0 ? `in use (process ${pids.join(", ")})` : "free"}`);
  }
}

async function run(checkPath) {
  if (!checkPath) throw new Error("Which check? For example: run scripts/browser-checks/smoke.mjs");
  const missing = OWN_PORTS.filter((port) => pidsListeningOn(port).length === 0);
  if (missing.length > 0) throw new Error(`Nothing listening on ${missing.join(", ")}. Run "start" first.`);

  const { chromium } = createRequire(path.join(webRoot, "package.json"))("@playwright/test");
  const { default: check } = await import(pathToFileURL(path.resolve(checkPath)).href);

  const browser = await chromium.launch();
  const results = [];
  const consoleErrors = [];

  /** A new browser session with no cookies. Options are Playwright's, such as `timezoneId`. */
  const newPage = async (options = {}) => {
    const context = await browser.newContext({ baseURL: webUrl, ...options });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`${page.url()}: ${message.text()}`);
    });
    return page;
  };

  const login = async (page, identifier, { companyCode = "ACME", password = "Passw0rd!" } = {}) => {
    await page.goto("/login");
    await page.getByLabel("Company code").fill(companyCode);
    await page.getByLabel("Employee code or email").fill(identifier);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Welcome").waitFor();
  };

  /** Records a pass or a failure and carries on, so one run shows everything wrong. */
  const check_ = async (name, assertion) => {
    try {
      const outcome = await assertion();
      if (outcome === false) throw new Error("returned false");
      results.push({ name, ok: true });
      console.log(`  ok    ${name}`);
    } catch (err) {
      results.push({ name, ok: false });
      console.log(`  FAIL  ${name}\n        ${String(err?.message ?? err).split("\n")[0]}`);
    }
  };

  try {
    await check({ newPage, login, check: check_, apiUrl, webUrl });
  } finally {
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    console.log(`\nBrowser console errors (${consoleErrors.length}):`);
    for (const line of consoleErrors) console.log(`  ${line}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  if (failed > 0) process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  start: () => start({ seed: args.includes("--seed"), reset: args.includes("--reset") }),
  stop,
  status,
  run: () => run(args[0]),
  "serve-web": serveWeb,
};

if (!commands[command]) {
  console.error("Usage: node scripts/browser-check.mjs start [--reset] [--seed] | run <check.mjs> | stop | status");
  process.exit(2);
}

try {
  await commands[command]();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
