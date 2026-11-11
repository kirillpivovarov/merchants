import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../dist/server/index.js";
const db = new DatabaseSync(":memory:");
db.exec(readFileSync("drizzle/0000_stiff_swarm.sql", "utf8"));
const DB = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        return db.prepare(sql).get(...values);
      },
      async run() {
        return { meta: { changes: db.prepare(sql).run(...values).changes } };
      },
    };
  },
};
const headers = { "oai-authenticated-user-id": "smoke-owner" };
const call = async (path, body) =>
  worker.fetch(
    new Request("https://smoke.example" + path, {
      headers: {
        ...headers,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    }),
    { DB },
  );
const page = await call("/");
assert.equal(page.status, 200);
assert.match(await page.text(), /Демо для ТКБ/);
const anon = await worker.fetch(
  new Request("https://smoke.example/api/state"),
  { DB },
);
assert.equal(anon.status, 401);
let state = await (await call("/api/state")).json();
assert.equal(state.merchants.length, 12);
assert.equal(state.capabilities.live, false);
assert.equal(state.capabilities.scheduler, false);
const add = await call("/api/merchants", {
  name: "Worker smoke fixture",
  url: "worker-smoke.example",
});
assert.equal(add.status, 201);
const merchant = await add.json();
const scanned = await call("/api/scans", { ids: [merchant.id], mode: "demo" });
assert.equal(scanned.status, 201);
const scan = (await scanned.json()).scans[0];
assert.equal(scan.mode, "demo");
assert.equal(scan.completeness, "partial");
const report = await call("/api/reports/" + scan.id);
assert.equal(report.status, 200);
assert.match(await report.text(), /ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ/);
const live = await call("/api/scans", { ids: [merchant.id], mode: "live" });
assert.equal(live.status, 503);
state = await (await call("/api/state")).json();
assert.equal(state.merchants.length, 13);
assert.equal(state.scans.length, 37);
console.log(
  "Worker smoke passed: assets, identity, D1 seed/persistence, scan, report and explicit live-mode boundary.",
);
db.close();
