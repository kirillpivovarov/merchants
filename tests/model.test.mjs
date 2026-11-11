import { describe, it, expect } from "vitest";
import {
  riskOf,
  summarize,
  normalizeMerchant,
  canonicalUrl,
  csvCell,
  escapeHtml,
  portfolio,
} from "../core/model.mjs";
import { analyze } from "../core/analyze.mjs";
import { seedState, demoObservation } from "../core/seed.mjs";
import { scanReport, exportPortfolio } from "../core/reports.mjs";
describe("Risk model and report consistency", () => {
  it.each([
    [0, "normal"],
    [50, "normal"],
    [51, "attention"],
    [80, "attention"],
    [81, "alarm"],
    [99, "alarm"],
    [100, "critical"],
    [140, "critical"],
  ])("score %i is %s", (score, risk) => expect(riskOf(score)).toBe(risk));
  it("does not score unknown or unavailable checks", () =>
    expect(
      summarize([
        { status: "unavailable", weight: 100 },
        { status: "unknown", weight: 20 },
        { status: "pass", weight: 30 },
        { status: "violation", weight: 15 },
      ]),
    ).toEqual({
      score: 15,
      risk: "normal",
      completeness: "partial",
      violations: 1,
    }));
  it("unavailable site never produces positive assertions", () => {
    const scan = analyze(
      { id: "m", url: "https://a.example", inn: "1234567890" },
      { pages: [] },
      [],
    );
    expect(scan.completeness).toBe("partial");
    expect(scan.checks.some((c) => c.status === "pass")).toBe(false);
    expect(scan.score).toBe(0);
  });
  it("detects mismatches, crypto and custom rules with evidence and version", () => {
    const m = {
      id: "m",
      name: "Merchant",
      url: "http://a.example",
      inn: "1111111111",
    };
    const scan = analyze(
      m,
      {
        pages: [
          {
            url: m.url,
            title: "",
            text: "ИНН: 2222222222. КРИПТОВАЛЮТА USDT. Казино.",
            frames: ["https://other.example"],
            links: [],
          },
        ],
      },
      [{ id: "r", term: "казино", weight: 35, enabled: true }],
    );
    expect(scan.checks.find((c) => c.id === "identity_match").status).toBe(
      "violation",
    );
    expect(scan.extracted.payment).toContain("Криптовалюта");
    expect(
      scan.checks.find((c) => c.id === "dict_r").evidence[0].quote,
    ).toContain("Казино");
    expect(scan.dictionaryVersion).toContain("казино");
    expect(scan.score).toBeGreaterThan(100);
  });
  it("handles expiry and disabled dictionary entries", () => {
    const m = { id: "m", name: "M", url: "https://a.example" };
    const scan = analyze(
      m,
      {
        domain: { registered: "2020-01-01", owner: "M", expires: "2026-01-02" },
        pages: [{ url: m.url, text: "test", title: "x" }],
      },
      [{ id: "r", term: "test", weight: 100, enabled: false }],
      "2026-01-01T00:00:00Z",
    );
    expect(scan.checks.find((c) => c.id === "domain_expiry").status).toBe(
      "violation",
    );
    expect(scan.checks.some((c) => c.id === "dict_r")).toBe(false);
  });
  it("keeps totals and report snapshots consistent after card edits", () => {
    const s = seedState();
    const sum = portfolio(s);
    expect(Object.values(sum.risks).reduce((a, b) => a + b, 0)).toBe(
      sum.scanned,
    );
    const scan = s.scans[0],
      m = s.merchants.find((m) => m.id === scan.merchantId);
    const report = scanReport({ ...m, name: "CHANGED" }, scan);
    expect(report).not.toContain("CHANGED");
    expect(report).toContain(String(scan.score));
    expect(exportPortfolio(s).split("\r\n")).toHaveLength(13);
  });
  it("counts unscanned merchants separately", () => {
    const s = seedState();
    s.merchants.push({ id: "new" });
    const sum = portfolio(s);
    expect(sum.unscanned).toBe(1);
    expect(sum.scanned).toBe(12);
  });
  it("labels all fixture observations as demo", () => {
    const s = seedState();
    expect(s.scans.every((s) => s.mode === "demo")).toBe(true);
    expect(demoObservation(s.merchants[0]).mode).toBe("demo");
  });
});
describe("Input and export boundaries", () => {
  it.each([
    "ftp://x.example",
    "https://user:pass@x.example",
    "https://x.example:8080",
    "not a url",
    "https://localhost",
  ])("rejects invalid URL %s", (value) =>
    expect(() => canonicalUrl(value)).toThrow(),
  );
  it("normalizes URL and removes tracking data", () =>
    expect(canonicalUrl("example.ru/path?q=1#x")).toBe("https://example.ru"));
  it.each([
    { name: "a", url: "x.example" },
    { name: "Ok", url: "x.example", inn: "oops" },
    { name: "Ok", url: "x.example", mcc: "1" },
    { name: "Ok", url: "x.example", interval: 2 },
  ])("rejects malformed card", (input) =>
    expect(() => normalizeMerchant(input)).toThrow(),
  );
  it("accepts international identifier and schedule", () =>
    expect(
      normalizeMerchant({
        name: "Shop",
        url: "x.example",
        inn: "102382656",
        mcc: "5411",
        interval: 30,
        monitoring: false,
      }),
    ).toMatchObject({ monitoring: false, interval: 30 }));
  it.each(['=HYPERLINK("x")', "+SUM(1)", "-1", "@evil", "\tformula"])(
    "neutralizes spreadsheet formula %s",
    (s) => expect(csvCell(s).startsWith("\"'")).toBe(true),
  );
  it("escapes HTML and CSV delimiters", () => {
    expect(escapeHtml("<script>\"&'")).toBe("&lt;script&gt;&quot;&amp;&#39;");
    expect(csvCell('a;"b')).toBe('"a;""b"');
  });
});
