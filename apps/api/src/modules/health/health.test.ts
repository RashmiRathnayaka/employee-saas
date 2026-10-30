import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

describe("GET /api/v1/health", () => {
  it("returns ok status and confirms the DB connection", async () => {
    const app = createApp();

    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "ok" });
    expect(typeof res.body.timestamp).toBe("string");
  });
});
