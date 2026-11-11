import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { StateStore, MemoryAdapter, D1Adapter } from "../server/store.mjs";
it("retries conflicting concurrent updates without losing either result", async () => {
  const store = new StateStore(new MemoryAdapter({ count: 0 }));
  await Promise.all([
    store.mutate((s) => ++s.count),
    store.mutate((s) => ++s.count),
    store.mutate((s) => ++s.count),
  ]);
  expect((await store.read()).count).toBe(3);
});
it("stops bounded retries with 409", async () => {
  const store = new StateStore({
    read: async () => ({ state: {}, version: 0 }),
    compareAndSwap: async () => false,
  });
  await expect(store.mutate((s) => s)).rejects.toMatchObject({ status: 409 });
});
it("supports the hosted D1 protocol with real SQLite statements and CAS", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE workspace_state(id INTEGER PRIMARY KEY, version INTEGER NOT NULL,payload TEXT NOT NULL)",
  );
  const wrapper = {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...args);
        },
        async run() {
          return { meta: { changes: db.prepare(sql).run(...args).changes } };
        },
      };
    },
  };
  const adapter = new D1Adapter(wrapper, () => ({ count: 0 })),
    store = new StateStore(adapter);
  expect((await store.read()).count).toBe(0);
  await store.mutate((s) => ++s.count);
  expect((await store.read()).count).toBe(1);
  expect(await adapter.compareAndSwap(0, { count: 99 })).toBe(false);
  db.close();
});
it("rejects an oversized aggregate without changing committed state", async () => {
  const store = new StateStore(new MemoryAdapter({ data: "small" }));
  await expect(
    store.mutate((s) => {
      s.data = "x".repeat(1800001);
    }),
  ).rejects.toMatchObject({ status: 413 });
  expect((await store.read()).data).toBe("small");
});
