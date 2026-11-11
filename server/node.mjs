import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { StateStore } from "./store.mjs";
import { seedState } from "../core/seed.mjs";
import { handleApi, runDue } from "../core/api.mjs";
import { liveObservation } from "./scanner.mjs";
const path = process.env.DB_PATH ?? "data/meridian.sqlite";
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec("PRAGMA journal_mode=WAL");
// Local migrations are tracked exactly as the hosted schema; no request-time DDL.
const migrations = readFileSync(
  new URL("../drizzle/0000_stiff_swarm.sql", import.meta.url),
  "utf8",
);
if (
  !db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_state'",
    )
    .get()
)
  db.exec(migrations);
const existing = db.prepare("SELECT id FROM workspace_state WHERE id=1").get();
if (!existing)
  db.prepare(
    "INSERT INTO workspace_state(id,version,payload) VALUES(1,0,?)",
  ).run(JSON.stringify(seedState()));
const store = new StateStore({
  async read() {
    const r = db
      .prepare("SELECT version,payload FROM workspace_state WHERE id=1")
      .get();
    return { version: r.version, state: JSON.parse(r.payload) };
  },
  async compareAndSwap(version, state) {
    return (
      db
        .prepare(
          "UPDATE workspace_state SET version=version+1,payload=? WHERE id=1 AND version=?",
        )
        .run(JSON.stringify(state), version).changes === 1
    );
  },
});
const host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 3000),
  token = process.env.AUTH_TOKEN;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !token)
  throw new Error("AUTH_TOKEN обязателен для внешнего интерфейса");
const signature = (expiry) =>
  createHmac("sha256", token)
    .update("meridian-session-v1:" + expiry)
    .digest("hex");
const sessionValid = (value) => {
  if (!token) return true;
  const [expiry, sig] = String(value ?? "").split(".");
  return (
    Number(expiry) > Date.now() &&
    Number(expiry) < Date.now() + 28801000 &&
    equal(sig, signature(expiry))
  );
};
const equal = (a, b) => {
  const x = Buffer.from(a ?? ""),
    y = Buffer.from(b ?? "");
  return x.length === y.length && timingSafeEqual(x, y);
};
const attempts = new Map();
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1000000) {
        res.writeHead(413);
        res.end("Request too large");
        return;
      }
      chunks.push(chunk);
    }
    const origin = process.env.PUBLIC_ORIGIN ?? "http://" + req.headers.host,
      url = new URL(req.url, origin);
    // Never trust caller-supplied identity headers; Node uses its own session boundary.
    const authenticated = sessionValid(
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("meridian_session="))
        ?.split("=")[1],
    );
    if (url.pathname === "/api/login" && req.method === "POST") {
      const key = req.socket.remoteAddress,
        now = Date.now(),
        entry = attempts.get(key) ?? { since: now, count: 0 };
      if (now - entry.since > 60000) {
        entry.since = now;
        entry.count = 0;
      }
      entry.count++;
      attempts.set(key, entry);
      if (entry.count > 10) {
        res.writeHead(429);
        res.end("Too many attempts");
        return;
      }
      if (req.headers.origin && req.headers.origin !== origin) {
        res.writeHead(403);
        res.end();
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        body = {};
      }
      if (token && !equal(body.token, token)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Неверный ключ доступа" }));
        return;
      }
      const expiry = String(Date.now() + 28800000),
        cookie = token ? expiry + "." + signature(expiry) : "";
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": `meridian_session=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
      });
      res.end("{}");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === "string") headers.set(k, v);
      const request = new Request(url, {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      const response = await handleApi(request, {
        store,
        liveScanner: liveObservation,
        actor: authenticated ? "analyst" : null,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const root = resolve("dist/client"),
      asset = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!asset.startsWith(root + "/") && asset !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    const file =
      existsSync(asset) && extname(asset) ? asset : resolve(root, "index.html");
    const mime = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
    };
    res.writeHead(200, {
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self'",
    });
    res.end(readFileSync(file));
  } catch (e) {
    console.error("Request failed:", e.message);
    res.writeHead(500);
    res.end("Internal error");
  }
});
server.listen(port, host, () =>
  console.log(`Meridian running at http://${host}:${port}`),
);
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await runDue({ store, liveScanner: liveObservation });
  } catch (e) {
    console.error("Scheduler:", e.message);
  } finally {
    ticking = false;
  }
}, 60000);
timer.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
