import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
it("Node runtime authenticates, persists SQLite records and restores them after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meridian-test-")),
    port = 33000 + Math.floor(Math.random() * 15000),
    base = "http://127.0.0.1:" + port;
  const launch = async () => {
    const child = spawn(process.execPath, ["server/node.mjs"], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        AUTH_TOKEN: "only-a-test-token",
        DB_PATH: join(dir, "db.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server did not start")),
        10000,
      );
      child.stdout.on("data", (data) => {
        if (String(data).includes("Meridian running")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("Early exit"));
      });
    });
    return child;
  };
  const stop = async (child) => {
    child.kill("SIGTERM");
    await once(child, "exit");
  };
  let child;
  try {
    child = await launch();
    expect((await fetch(base + "/api/health")).status).toBe(200);
    expect((await fetch(base + "/api/state")).status).toBe(401);
    expect(
      (
        await fetch(base + "/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "wrong" }),
        })
      ).status,
    ).toBe(401);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "only-a-test-token" }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const added = await fetch(base + "/api/merchants", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Persisted company",
        url: "persisted.example",
      }),
    });
    expect(added.status).toBe(201);
    await stop(child);
    child = await launch();
    const state = await (
      await fetch(base + "/api/state", { headers: { cookie } })
    ).json();
    expect(state.merchants.some((m) => m.name === "Persisted company")).toBe(
      true,
    );
    expect(state.capabilities.live).toBe(true);
  } finally {
    if (child && child.exitCode === null) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
