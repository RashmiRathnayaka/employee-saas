import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { runTick } from "../../lib/jobs/runner.js";

describe("GET /api/v1/health", () => {
  it("returns ok status and confirms the DB connection", async () => {
    const app = createApp();

    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "ok" });
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("says when the worker hasn't run, and still answers 200", async () => {
    const res = await request(createApp()).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body.worker).toEqual({ lastTickAt: null, ok: false });
  });

  it("shows the worker's last tick, and no job data", async () => {
    const tickedAt = new Date();
    await runTick([], tickedAt);

    const res = await request(createApp()).get("/api/v1/health");

    expect(res.body.worker).toEqual({ lastTickAt: tickedAt.toISOString(), ok: true });
  });
});
