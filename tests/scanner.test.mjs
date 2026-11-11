import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import {
  isPublicIp,
  resolvePublic,
  parsePage,
  fetchPublic,
  liveObservation,
} from "../server/scanner.mjs";
function mockRequest(responses) {
  const fn = (_url, options, cb) => {
    const req = new EventEmitter();
    req.setTimeout = vi.fn();
    req.destroy = (e) => req.emit("error", e);
    req.end = () =>
      queueMicrotask(() => {
        const spec = responses.shift() ?? {
          body: "<html><title>Test</title><body>Оплата картой</body></html>",
        };
        if (spec.error) {
          req.emit("error", new Error(spec.error));
          return;
        }
        // Invoke the socket lookup callback so pinning is actually exercised.
        options.lookup("example.com", { all: true }, () => {});
        options.lookup("example.com", {}, () => {});
        const res = new EventEmitter();
        res.statusCode = spec.status ?? 200;
        res.headers = spec.headers ?? { "content-type": "text/html" };
        cb(res);
        res.emit("data", Buffer.from(spec.body ?? ""));
        res.emit("end");
      });
    return req;
  };
  vi.spyOn(https, "request").mockImplementation(fn);
  vi.spyOn(http, "request").mockImplementation(fn);
}
beforeEach(() => {
  vi.restoreAllMocks();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
describe("SSRF and content extraction", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "garbage",
  ])("blocks non-public %s", (ip) => expect(isPublicIp(ip)).toBe(false));
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public %s",
    (ip) => expect(isPublicIp(ip)).toBe(true),
  );
  it("rejects mixed public/private DNS and DNS without answers", async () => {
    await expect(
      resolvePublic("a.example", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow("закрытую");
    await expect(resolvePublic("a.example", async () => [])).rejects.toThrow();
    await expect(resolvePublic("127.0.0.1")).rejects.toThrow();
    expect((await resolvePublic("8.8.8.8")).address).toBe("8.8.8.8");
  });
  it("extracts inert text, titles, links and frames", () => {
    const p = parsePage(
      '<title>Hello</title><body><script>malicious()</script><a href="/about">О компании</a><a href="javascript:alert(1)">bad</a><iframe src="https://other.example"></iframe></body>',
      "https://x.example",
    );
    expect(p.title).toBe("Hello");
    expect(p.text).not.toContain("malicious");
    expect(p.links).toEqual(["https://x.example/about"]);
    expect(p.frames).toHaveLength(1);
  });
  it("pins checked IPs and follows public redirects", async () => {
    mockRequest([
      { status: 302, headers: { location: "/new" } },
      { body: "Okay" },
    ]);
    expect((await fetchPublic("https://x.example")).body).toBe("Okay");
    expect(https.request).toHaveBeenCalledTimes(2);
  });
  it("rechecks redirect targets and blocks metadata destinations", async () => {
    mockRequest([
      { status: 302, headers: { location: "http://169.254.169.254/latest" } },
    ]);
    await expect(fetchPublic("https://x.example")).rejects.toThrow("закрытую");
    expect(https.request).toHaveBeenCalledTimes(1);
  });
  it("enforces redirect/time/status/size/content-type bounds", async () => {
    await expect(
      fetchPublic("https://x.example", { redirects: 4 }),
    ).rejects.toThrow("лимит");
    await expect(
      fetchPublic("https://x.example", { deadline: Date.now() - 1 }),
    ).rejects.toThrow("лимит");
    mockRequest([
      { status: 500 },
      { headers: { "content-type": "image/png" } },
      { body: "a".repeat(1000001) },
    ]);
    await expect(fetchPublic("https://x.example")).rejects.toThrow("500");
    await expect(fetchPublic("http://x.example")).rejects.toThrow("тип");
    await expect(fetchPublic("https://x.example")).rejects.toThrow("1 МБ");
  });
  it("records inaccessible site and propagates unsafe targets", async () => {
    mockRequest([{ error: "ETIMEDOUT" }]);
    expect(
      (await liveObservation({ url: "https://x.example" })).pages,
    ).toHaveLength(0);
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(liveObservation({ url: "https://x.example" })).rejects.toThrow(
      "закрытую",
    );
  });
  it("crawls same-origin pages only and tolerates failed child pages", async () => {
    mockRequest([
      {
        body: '<title>Home</title><body><a href="/about">About</a><a href="/terms">Terms</a><a href="/x.pdf">PDF</a><a href="https://evil.example">external</a></body>',
      },
      { body: "<title>About</title><body>ИНН: 7700000000</body>" },
      { error: "Connection refused" },
    ]);
    const observation = await liveObservation({ url: "https://x.example" });
    expect(observation.mode).toBe("live");
    expect(observation.pages).toHaveLength(2);
    expect(https.request).toHaveBeenCalledTimes(3);
  });
});
