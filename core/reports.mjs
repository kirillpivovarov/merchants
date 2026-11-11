import { csvRows, escapeHtml, riskLabels, portfolio } from "./model.mjs";
export function exportPortfolio(state) {
  return csvRows([
    [
      "Мерчант",
      "Сайт",
      "ИНН",
      "MCC",
      "Балл",
      "Риск",
      "Полнота",
      "Дата",
      "Режим",
    ],
    ...portfolio(state).rows.map((m) => [
      m.name,
      m.url,
      m.inn,
      m.mcc,
      m.latest?.score ?? "",
      m.latest ? riskLabels[m.latest.risk] : "Не проверен",
      m.latest?.completeness ?? "",
      m.latest?.createdAt ?? "",
      m.latest?.mode ?? "",
    ]),
  ]);
}
/** HTML report is deliberately script-free and printable to PDF in any browser. */
export function scanReport(m, s) {
  m = s.merchantSnapshot ?? m;
  const e = escapeHtml;
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Аудит ${e(m.name)}</title><style>/* Montserrat is the main text family on the design reference rocketscien.se. */@font-face {  font-family: 'Montserrat Variable';  font-style: normal;  font-weight: 100 900;  font-display: swap;  src: url('/fonts/montserrat-cyrillic-wght-normal.woff2') format('woff2');  unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;}@font-face {  font-family: 'Montserrat Variable';  font-style: normal;  font-weight: 100 900;  font-display: swap;  src: url('/fonts/montserrat-latin-wght-normal.woff2') format('woff2');  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}body{font:14px "Montserrat Variable",Arial,sans-serif;color:#171717;max-width:1100px;margin:40px auto;padding:20px}h1{font-size:30px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left;vertical-align:top}small{color:#737373}a{color:inherit;overflow-wrap:anywhere}@media print{tr{break-inside:avoid}body{margin:0}}</style><p>Демо для ТКБ · АУДИТ САЙТА</p><h1>${e(m.name)}</h1><p>${e(m.url)} · ${e(s.createdAt)} · ${s.mode === "demo" ? "ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ" : "Живая проверка"}</p><h2>${s.score} баллов · ${riskLabels[s.risk]}</h2><p>Полнота: ${s.completeness === "partial" ? "частичная" : "полная"}. Версия правил ${e(s.engineVersion)}. Оценка является сигналом для аналитика.</p><table><thead><tr><th>Проверка</th><th>Статус</th><th>Балл</th><th>Результат и доказательства</th></tr></thead><tbody>${s.checks.map((c) => `<tr><td>${e(c.group)} / ${e(c.title)}</td><td>${e(c.status)}</td><td>${c.status === "violation" ? c.weight : 0}</td><td>${e(c.result)}${c.evidence.map((v) => `<p><a href="${e(v.url)}">${e(v.url)}</a><br>«${e(v.quote)}»<br><small>${e(v.capturedAt)}</small></p>`).join("")}</td></tr>`).join("")}</tbody></table></html>`;
}
