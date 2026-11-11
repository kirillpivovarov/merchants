import { AppError, normalizeMerchant, portfolio } from "./model.mjs";
import { analyze } from "./analyze.mjs";
import { demoObservation } from "./seed.mjs";
import { exportPortfolio, scanReport } from "./reports.mjs";
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
const required = (state, id) => {
  const m = state.merchants.find((m) => m.id === id);
  if (!m) throw new AppError(404, "Мерчант не найден");
  return m;
};
const audit = (s, actor, action, entity) => {
  s.audit.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor,
    action,
    entity,
  });
  s.audit = s.audit.slice(0, 1000);
};
export async function handleApi(
  request,
  { store, liveScanner = null, actor = "local-analyst" },
) {
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/\/$/, ""),
      method = request.method;
    if (path === "/api/health") return json({ status: "ok", version: "1.0.0" });
    if (!actor) throw new AppError(401, "Требуется вход");
    if (!["GET", "HEAD"].includes(method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        throw new AppError(403, "Запрос с другого сайта запрещён");
    }
    let body = {};
    if (["POST", "PATCH", "PUT"].includes(method)) {
      if (!request.headers.get("content-type")?.includes("application/json"))
        throw new AppError(415, "Ожидается application/json");
      const raw = await request.text();
      if (raw.length > 1000000)
        throw new AppError(413, "Запрос превышает 1 МБ");
      try {
        body = JSON.parse(raw);
      } catch {
        throw new AppError(400, "Некорректный JSON");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new AppError(400, "Ожидается объект JSON");
    }
    if (path === "/api/state" && method === "GET") {
      const state = await store.read();
      return json({
        ...state,
        summary: portfolio(state),
        capabilities: {
          live: Boolean(liveScanner),
          scheduler: Boolean(liveScanner),
        },
        actor,
      });
    }
    if (path === "/api/merchants" && method === "POST") {
      const data = normalizeMerchant(body);
      return json(
        await store.mutate((s) => {
          if (s.merchants.some((m) => m.url === data.url))
            throw new AppError(409, "Этот сайт уже есть в портфеле");
          const m = {
            ...data,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            nextScanAt: new Date().toISOString(),
          };
          s.merchants.unshift(m);
          audit(s, actor, "Добавлен мерчант", m.name);
          return m;
        }),
        201,
      );
    }
    if (path === "/api/import" && method === "POST") {
      if (
        !Array.isArray(body.rows) ||
        !body.rows.length ||
        body.rows.length > 500
      )
        throw new AppError(400, "Импорт: от 1 до 500 строк");
      // Validate every row before a single write, so an import is all-or-nothing.
      const rows = body.rows.map(normalizeMerchant);
      return json(
        await store.mutate((s) => {
          const seen = new Set(s.merchants.map((m) => m.url));
          for (const row of rows) {
            if (seen.has(row.url))
              throw new AppError(409, "Дубликат сайта: " + row.url);
            seen.add(row.url);
          }
          const now = new Date().toISOString();
          s.merchants.unshift(
            ...rows.map((row) => ({
              ...row,
              id: crypto.randomUUID(),
              createdAt: now,
              nextScanAt: now,
            })),
          );
          audit(s, actor, "Импорт мерчантов", String(rows.length));
          return { imported: rows.length };
        }),
        201,
      );
    }
    const merchantMatch = path.match(/^\/api\/merchants\/([^/]+)$/);
    if (merchantMatch && method === "PATCH") {
      return json(
        await store.mutate((s) => {
          const m = required(s, merchantMatch[1]);
          const next = normalizeMerchant({ ...m, ...body });
          if (
            s.merchants.some(
              (other) => other.id !== m.id && other.url === next.url,
            )
          )
            throw new AppError(409, "Этот сайт уже есть в портфеле");
          Object.assign(m, next, {
            nextScanAt: new Date(
              Date.now() + next.interval * 86400000,
            ).toISOString(),
          });
          audit(s, actor, "Изменён мерчант", m.name);
          return m;
        }),
      );
    }
    if (path === "/api/scans" && method === "POST") {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100)
        throw new AppError(400, "Укажите от 1 до 100 мерчантов");
      const mode = body.mode ?? "demo";
      if (!["demo", "live"].includes(mode))
        throw new AppError(400, "Неизвестный режим проверки");
      if (mode === "live" && !liveScanner)
        throw new AppError(
          503,
          "Живой сканер доступен в Node.js развёртывании; здесь работает демостенд",
        );
      if (mode === "live" && body.ids.length > 3)
        throw new AppError(400, "Живая проверка: не более 3 сайтов за запрос");
      const ids = [...new Set(body.ids)],
        snapshot = await store.read();
      ids.forEach((id) => required(snapshot, id));
      const scans = [],
        errors = [];
      for (const id of ids) {
        let reservation = false;
        try {
          const { merchant, dictionary } = await store.mutate((s) => {
            const m = required(s, id);
            if (m.scanningUntil && Date.parse(m.scanningUntil) > Date.now())
              throw new AppError(409, "Проверка уже выполняется");
            m.scanningUntil = new Date(Date.now() + 120000).toISOString();
            return {
              merchant: structuredClone(m),
              dictionary: structuredClone(s.dictionary),
            };
          });
          reservation = true;
          const observation =
            mode === "demo"
              ? demoObservation(merchant)
              : await liveScanner(merchant);
          const scan = analyze(merchant, observation, dictionary);
          await store.mutate((s) => {
            s.scans.unshift(scan);
            const m = required(s, id);
            m.nextScanAt = new Date(
              Date.now() + m.interval * 86400000,
            ).toISOString();
            delete m.scanningUntil;
            const counts = {};
            s.scans = s.scans.filter(
              (item) =>
                (counts[item.merchantId] =
                  (counts[item.merchantId] ?? 0) + 1) <= 30,
            );
            const retained = new Set(s.scans.map((s) => s.id));
            for (const key of Object.keys(s.reviews))
              if (!retained.has(key.split(":")[0])) delete s.reviews[key];
            audit(
              s,
              actor,
              "Проверка: " + mode,
              merchant.name + " · " + scan.score,
            );
            return null;
          });
          scans.push(scan);
        } catch (e) {
          errors.push({ id, message: e.message });
          if (reservation)
            await store.mutate((s) => {
              delete required(s, id).scanningUntil;
              return null;
            });
        }
      }
      return json({ scans, errors }, scans.length ? 201 : 422);
    }
    if (path === "/api/dictionary" && method === "POST") {
      const term = String(body.term ?? "").trim(),
        weight = Number(body.weight),
        category = String(body.category ?? "Стоп-слова");
      if (
        term.length < 2 ||
        term.length > 80 ||
        !Number.isInteger(weight) ||
        weight < 0 ||
        weight > 100 ||
        ![
          "Стоп-слова",
          "Запрещённая деятельность",
          "Справочник банка",
        ].includes(category)
      )
        throw new AppError(
          400,
          "Маркер: 2–80 символов, вес: 0–100, категория из списка",
        );
      return json(
        await store.mutate((s) => {
          if (s.dictionary.length >= 200)
            throw new AppError(400, "В пилоте не более 200 правил");
          if (
            s.dictionary.some(
              (d) => d.term.toLowerCase() === term.toLowerCase(),
            )
          )
            throw new AppError(409, "Маркер уже существует");
          const d = {
            id: crypto.randomUUID(),
            term,
            weight,
            category,
            enabled: true,
          };
          s.dictionary.push(d);
          audit(s, actor, "Добавлен маркер", term);
          return d;
        }),
        201,
      );
    }
    const dictMatch = path.match(/^\/api\/dictionary\/([^/]+)$/);
    if (dictMatch && method === "PATCH")
      return json(
        await store.mutate((s) => {
          const d = s.dictionary.find((d) => d.id === dictMatch[1]);
          if (!d) throw new AppError(404, "Маркер не найден");
          if (typeof body.enabled !== "boolean")
            throw new AppError(400, "Укажите enabled");
          d.enabled = body.enabled;
          audit(s, actor, "Изменён маркер", d.term);
          return d;
        }),
      );
    const reviewMatch = path.match(/^\/api\/scans\/([^/]+)\/reviews$/);
    if (reviewMatch && method === "POST") {
      if (!["confirmed", "false_positive", "pending"].includes(body.verdict))
        throw new AppError(400, "Неизвестное решение");
      const note = String(body.note ?? "").trim();
      if (note.length < 3 || note.length > 1000)
        throw new AppError(400, "Комментарий: 3–1000 символов");
      return json(
        await store.mutate((s) => {
          const scan = s.scans.find((x) => x.id === reviewMatch[1]);
          if (
            !scan ||
            !scan.checks.some(
              (c) => c.id === body.checkId && c.status === "violation",
            )
          )
            throw new AppError(404, "Нарушение не найдено");
          const review = {
            verdict: body.verdict,
            note,
            actor,
            at: new Date().toISOString(),
          };
          s.reviews[scan.id + ":" + body.checkId] = review;
          audit(s, actor, "Решение аналитика: " + body.verdict, body.checkId);
          return review;
        }),
      );
    }
    if (path === "/api/settings" && method === "PATCH") {
      if (typeof body.scheduleEnabled !== "boolean")
        throw new AppError(400, "Укажите scheduleEnabled");
      if (body.scheduleEnabled && !liveScanner)
        throw new AppError(
          503,
          "Фоновое расписание работает в Node.js развёртывании",
        );
      return json(
        await store.mutate((s) => {
          s.settings.scheduleEnabled = body.scheduleEnabled;
          audit(s, actor, "Расписание", String(body.scheduleEnabled));
          return s.settings;
        }),
      );
    }
    if (path === "/api/export/portfolio.csv" && method === "GET")
      return new Response(exportPortfolio(await store.read()), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            'attachment; filename="meridian-portfolio.csv"',
          "cache-control": "no-store",
        },
      });
    const reportMatch = path.match(/^\/api\/reports\/([^/]+)$/);
    if (reportMatch && method === "GET") {
      const s = await store.read(),
        scan = s.scans.find((s) => s.id === reportMatch[1]);
      if (!scan) throw new AppError(404, "Отчёт не найден");
      return new Response(scanReport(required(s, scan.merchantId), scan), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
        },
      });
    }
    throw new AppError(404, "Операция не найдена");
  } catch (e) {
    return json(
      { error: e.status ? e.message : "Внутренняя ошибка сервера" },
      e.status ?? 500,
    );
  }
}
/** Idempotent tick: per-merchant reservations also protect overlapping processes. */
export async function runDue(context) {
  const s = await context.store.read();
  if (!s.settings.scheduleEnabled) return { skipped: true };
  const ids = s.merchants
    .filter((m) => m.monitoring && Date.parse(m.nextScanAt) <= Date.now())
    .slice(0, 3)
    .map((m) => m.id);
  if (!ids.length) return { scans: [] };
  const r = await handleApi(
    new Request("http://localhost/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, mode: "live" }),
    }),
    { ...context, actor: "scheduler" },
  );
  return r.json();
}
