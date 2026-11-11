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
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Аудит ${e(m.name)}</title><style>body{font:14px Arial;color:#172136;max-width:1100px;margin:40px auto;padding:20px}h1{font-size:30px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left;vertical-align:top}small{color:#637088}a{overflow-wrap:anywhere}@media print{tr{break-inside:avoid}body{margin:0}}</style><p>МЕРИДИАН · АУДИТ САЙТА</p><h1>${e(m.name)}</h1><p>${e(m.url)} · ${e(s.createdAt)} · ${s.mode === "demo" ? "ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ" : "Живая проверка"}</p><h2>${s.score} баллов · ${riskLabels[s.risk]}</h2><p>Полнота: ${s.completeness === "partial" ? "частичная" : "полная"}. Версия правил ${e(s.engineVersion)}. Оценка является сигналом для аналитика.</p><table><thead><tr><th>Проверка</th><th>Статус</th><th>Балл</th><th>Результат и доказательства</th></tr></thead><tbody>${s.checks.map((c) => `<tr><td>${e(c.group)} / ${e(c.title)}</td><td>${e(c.status)}</td><td>${c.status === "violation" ? c.weight : 0}</td><td>${e(c.result)}${c.evidence.map((v) => `<p><a href="${e(v.url)}">${e(v.url)}</a><br>«${e(v.quote)}»<br><small>${e(v.capturedAt)}</small></p>`).join("")}</td></tr>`).join("")}</tbody></table></html>`;
}
