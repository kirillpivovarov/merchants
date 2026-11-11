/** Business invariants shared by Node.js, the hosted adapter and tests. */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const riskOf = (score) =>
  score >= 100
    ? "critical"
    : score >= 81
      ? "alarm"
      : score >= 51
        ? "attention"
        : "normal";
export const riskLabels = {
  critical: "Критично",
  alarm: "Тревога",
  attention: "Внимание",
  normal: "Норма",
};
export const groups = [
  "Домен",
  "Сайт",
  "Оплата",
  "Содержимое",
  "Внешние источники",
];
export function summarize(checks) {
  const score = checks.reduce(
    (sum, c) => sum + (c.status === "violation" ? c.weight : 0),
    0,
  );
  return {
    score,
    risk: riskOf(score),
    completeness: checks.some((c) =>
      ["unavailable", "unknown"].includes(c.status),
    )
      ? "partial"
      : "full",
    violations: checks.filter((c) => c.status === "violation").length,
  };
}
/** Reports count only merchants with a completed scan; unscanned records are separate. */
export function portfolio(state) {
  const rows = state.merchants.map((m) => ({
    ...m,
    latest: state.scans.find((s) => s.merchantId === m.id) ?? null,
  }));
  const scanned = rows.filter((m) => m.latest);
  return {
    rows,
    total: rows.length,
    scanned: scanned.length,
    unscanned: rows.length - scanned.length,
    partial: scanned.filter((m) => m.latest.completeness === "partial").length,
    risks: Object.fromEntries(
      ["normal", "attention", "alarm", "critical"].map((r) => [
        r,
        scanned.filter((m) => m.latest.risk === r).length,
      ]),
    ),
    findings: scanned.reduce((n, m) => n + m.latest.violations, 0),
  };
}
export function canonicalUrl(value) {
  let u;
  try {
    u = new URL(value.includes("://") ? value : "https://" + value);
  } catch {
    throw new AppError(400, "Укажите корректный адрес сайта");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port ||
    !u.hostname.includes(".") ||
    u.hostname.length > 253
  )
    throw new AppError(
      400,
      "Нужен публичный HTTP(S) адрес без порта и учётных данных",
    );
  u.hash = "";
  u.search = "";
  return u.origin;
}
export function normalizeMerchant(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new AppError(400, "Карточка должна быть объектом");
  if (data.monitoring !== undefined && typeof data.monitoring !== "boolean")
    throw new AppError(400, "monitoring должен быть логическим значением");
  const name = String(data.name ?? "").trim(),
    inn = String(data.inn ?? "").trim(),
    mcc = String(data.mcc ?? "").trim();
  if (name.length < 2 || name.length > 160)
    throw new AppError(400, "Название: от 2 до 160 символов");
  if (inn && !/^\d{9,14}$/.test(inn))
    throw new AppError(400, "ИНН / УНП / БИН: от 9 до 14 цифр");
  if (mcc && !/^\d{4}$/.test(mcc))
    throw new AppError(400, "MCC должен содержать 4 цифры");
  const interval = Number(data.interval ?? 7);
  if (![1, 7, 30].includes(interval))
    throw new AppError(400, "Периодичность: 1, 7 или 30 дней");
  return {
    name,
    url: canonicalUrl(String(data.url ?? "")),
    inn,
    mcc,
    interval,
    monitoring: data.monitoring !== false,
    status: "active",
  };
}
export function csvCell(value) {
  const str = String(value ?? "");
  return (
    '"' +
    (/^[=+\-@\t\r]/.test(str) ? "'" + str : str).replaceAll('"', '""') +
    '"'
  );
}
export function csvRows(rows) {
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
