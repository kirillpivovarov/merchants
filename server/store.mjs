/** Storage port: optimistic compare-and-swap makes complete business operations atomic. */
export class StateStore {
  constructor(adapter) {
    this.adapter = adapter;
  }
  async read() {
    return (await this.adapter.read()).state;
  }
  async mutate(fn) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { state, version } = await this.adapter.read();
      const next = structuredClone(state);
      const result = fn(next);
      if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 1800000) {
        const e = new Error(
          "Хранилище пилота заполнено. Требуется архивирование или расширение хранилища",
        );
        e.status = 413;
        throw e;
      }
      if (await this.adapter.compareAndSwap(version, next)) return result;
    }
    const e = new Error("Конкурентное изменение: повторите действие");
    e.status = 409;
    throw e;
  }
}
export class MemoryAdapter {
  constructor(state) {
    this.state = structuredClone(state);
    this.version = 0;
  }
  async read() {
    return { state: structuredClone(this.state), version: this.version };
  }
  async compareAndSwap(version, state) {
    if (version !== this.version) return false;
    this.state = state;
    this.version++;
    return true;
  }
}
export class D1Adapter {
  constructor(db, seed) {
    this.db = db;
    this.seed = seed;
  }
  async read() {
    // Schema is migration-owned. Only business seed data is inserted here.
    let row = await this.db
      .prepare("SELECT version,payload FROM workspace_state WHERE id=1")
      .first();
    if (!row) {
      await this.db
        .prepare(
          "INSERT OR IGNORE INTO workspace_state(id,version,payload) VALUES(1,0,?)",
        )
        .bind(JSON.stringify(this.seed()))
        .run();
      row = await this.db
        .prepare("SELECT version,payload FROM workspace_state WHERE id=1")
        .first();
    }
    return { version: row.version, state: JSON.parse(row.payload) };
  }
  async compareAndSwap(version, state) {
    const r = await this.db
      .prepare(
        "UPDATE workspace_state SET version=version+1,payload=? WHERE id=1 AND version=?",
      )
      .bind(JSON.stringify(state), version)
      .run();
    return r.meta.changes === 1;
  }
}
