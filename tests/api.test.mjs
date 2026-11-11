import { describe, it, expect, beforeEach } from "vitest";
import { handleApi, runDue } from "../core/api.mjs";
import { StateStore, MemoryAdapter } from "../server/store.mjs";
import { seedState, demoObservation } from "../core/seed.mjs";
let store;
beforeEach(() => {
  store = new StateStore(new MemoryAdapter(seedState()));
});
async function call(
  path,
  body,
  method = body !== undefined ? "POST" : "GET",
  context = {},
) {
  const request = new Request("http://localhost/api" + path, {
    method,
    ...(body !== undefined
      ? {
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
  const response = await handleApi(request, {
    store,
    actor: "test",
    ...context,
  });
  return {
    status: response.status,
    data: response.headers.get("content-type").includes("json")
      ? await response.json()
      : await response.text(),
  };
}
describe("API workflows", () => {
  it("health is public, records require identity", async () => {
    expect(
      (await call("/health", undefined, "GET", { actor: null })).status,
    ).toBe(200);
    expect(
      (await call("/state", undefined, "GET", { actor: null })).status,
    ).toBe(401);
  });
  it("rejects unknown routes, malformed JSON, wrong media type and cross-origin writes", async () => {
    expect((await call("/unknown")).status).toBe(404);
    expect((await call("/merchants", "bad")).status).toBe(400);
    expect((await call("/merchants", null)).status).toBe(400);
    for (const headers of [
      { "content-type": "text/plain" },
      { "content-type": "application/json", origin: "https://evil.example" },
    ]) {
      const r = await handleApi(
        new Request("http://localhost/api/merchants", {
          method: "POST",
          headers,
          body: "{}",
        }),
        { store },
      );
      expect([403, 415]).toContain(r.status);
    }
  });
  it("adds, rejects duplicate, updates, and preserves data", async () => {
    const body = {
      name: "New Merchant",
      url: "new.example",
      inn: "7700000000",
      mcc: "5411",
    };
    const r = await call("/merchants", body);
    expect(r.status).toBe(201);
    expect((await call("/merchants", body)).status).toBe(409);
    expect(
      (
        await call(
          "/merchants/" + r.data.id,
          { monitoring: false, interval: 30 },
          "PATCH",
        )
      ).data.monitoring,
    ).toBe(false);
    expect(
      (await call("/merchants/missing", { name: "Hello" }, "PATCH")).status,
    ).toBe(404);
    expect((await call("/state")).data.merchants).toHaveLength(13);
  });
  it("rejects a duplicate on edit", async () => {
    const s = await store.read();
    expect(
      (
        await call(
          "/merchants/" + s.merchants[0].id,
          { url: s.merchants[1].url },
          "PATCH",
        )
      ).status,
    ).toBe(409);
  });
  it("imports atomically, rejecting malformed and duplicate rows", async () => {
    const row = { name: "Import", url: "import.example" };
    expect(
      (await call("/import", { rows: [row, { name: "x", url: "bad" }] }))
        .status,
    ).toBe(400);
    expect((await store.read()).merchants).toHaveLength(12);
    expect((await call("/import", { rows: [row, row] })).status).toBe(409);
    expect((await call("/import", { rows: [] })).status).toBe(400);
    expect((await call("/import", { rows: [row] })).data.imported).toBe(1);
    expect((await call("/import", { rows: [row] })).status).toBe(409);
  });
  it("runs a demo scan, keeps history and enables analyst review", async () => {
    const s = await store.read(),
      id = s.merchants[1].id;
    const r = await call("/scans", { ids: [id], mode: "demo" });
    expect(r.status).toBe(201);
    const scan = r.data.scans[0],
      c = scan.checks.find((c) => c.status === "violation");
    expect((await store.read()).scans).toHaveLength(37);
    const review = await call("/scans/" + scan.id + "/reviews", {
      checkId: c.id,
      verdict: "false_positive",
      note: "Проверен контекст",
    });
    expect(review.status).toBe(200);
    expect((await store.read()).scans[0].score).toBe(scan.score);
    expect(
      (
        await call("/scans/" + scan.id + "/reviews", {
          checkId: "missing",
          verdict: "pending",
          note: "Test",
        })
      ).status,
    ).toBe(404);
  });
  it("validates scans and live capability", async () => {
    expect((await call("/scans", { ids: [] })).status).toBe(400);
    expect((await call("/scans", { ids: ["unknown"] })).status).toBe(404);
    expect(
      (await call("/scans", { ids: ["demo-1"], mode: "other" })).status,
    ).toBe(400);
    expect(
      (await call("/scans", { ids: ["demo-1"], mode: "live" })).status,
    ).toBe(503);
    expect(
      (
        await call(
          "/scans",
          { ids: ["demo-1", "demo-2", "demo-3", "demo-4"], mode: "live" },
          "POST",
          { liveScanner: demoObservation },
        )
      ).status,
    ).toBe(400);
  });
  it("releases reservation when scanner fails and rejects concurrent scan", async () => {
    await store.mutate((s) => {
      s.merchants[0].scanningUntil = new Date(Date.now() + 60000).toISOString();
    });
    expect((await call("/scans", { ids: ["demo-1"] })).status).toBe(422);
    const r = await call("/scans", { ids: ["demo-2"], mode: "live" }, "POST", {
      liveScanner: async () => {
        throw new Error("Scanner down");
      },
    });
    expect(r.data.errors[0].message).toBe("Scanner down");
    expect((await store.read()).merchants[1].scanningUntil).toBeUndefined();
  });
  it("caps history to 30 scans per merchant", async () => {
    for (let i = 0; i < 29; i++) await call("/scans", { ids: ["demo-1"] });
    expect(
      (await store.read()).scans.filter((s) => s.merchantId === "demo-1"),
    ).toHaveLength(30);
  });
  it("supports dictionary lifecycle without changing historical reports", async () => {
    const before = (await store.read()).scans[0];
    const r = await call("/dictionary", {
      term: "тестовый маркер",
      weight: 15,
      category: "Справочник банка",
    });
    expect(r.status).toBe(201);
    expect(
      (await call("/dictionary", { term: "тестовый маркер", weight: 15 }))
        .status,
    ).toBe(409);
    expect(
      (await call("/dictionary/" + r.data.id, { enabled: false }, "PATCH")).data
        .enabled,
    ).toBe(false);
    expect(
      (await call("/dictionary/" + r.data.id, { enabled: "false" }, "PATCH"))
        .status,
    ).toBe(400);
    expect(
      (await call("/dictionary/missing", { enabled: true }, "PATCH")).status,
    ).toBe(404);
    expect((await call("/dictionary", { term: "a", weight: -1 })).status).toBe(
      400,
    );
    expect((await store.read()).scans[0]).toEqual(before);
  });
  it("validates review payloads", async () => {
    expect((await call("/scans/no/reviews", { verdict: "other" })).status).toBe(
      400,
    );
    expect(
      (await call("/scans/no/reviews", { verdict: "pending", note: "x" }))
        .status,
    ).toBe(400);
  });
  it("exports escaped CSV and printable report with snapshot", async () => {
    const s = await store.read();
    const csv = await call("/export/portfolio.csv");
    expect(csv.data).toContain("Мерчант");
    const report = await call("/reports/" + s.scans[0].id);
    expect(report.data).toContain("ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ");
    expect((await call("/reports/unknown")).status).toBe(404);
  });
  it("schedules only due monitored merchants and advances next due date", async () => {
    expect((await runDue({ store })).skipped).toBe(true);
    expect(
      (await call("/settings", { scheduleEnabled: true }, "PATCH")).status,
    ).toBe(503);
    expect(
      (await call("/settings", { scheduleEnabled: "true" }, "PATCH")).status,
    ).toBe(400);
    await call("/settings", { scheduleEnabled: true }, "PATCH", {
      liveScanner: demoObservation,
    });
    await store.mutate((s) => {
      s.merchants[0].nextScanAt = "2020-01-01T00:00:00Z";
      s.merchants[1].monitoring = false;
      s.merchants[1].nextScanAt = "2020-01-01T00:00:00Z";
    });
    const result = await runDue({ store, liveScanner: demoObservation });
    expect(result.scans).toHaveLength(1);
    expect(
      Date.parse((await store.read()).merchants[0].nextScanAt),
    ).toBeGreaterThan(Date.now());
    expect(
      (await runDue({ store, liveScanner: demoObservation })).scans,
    ).toHaveLength(0);
  });
  it("returns safe 500 details and rejects oversize body", async () => {
    expect((await call("/merchants", " ".repeat(1000001))).status).toBe(413);
    expect(
      (
        await call("/state", undefined, "GET", {
          store: {
            read: async () => {
              throw new Error("private path");
            },
          },
        })
      ).data.error,
    ).toBe("Внутренняя ошибка сервера");
  });
});
