import { summarize } from "./model.mjs";
/** Pure rule engine: observations are facts; unavailable data never becomes a pass. */
export function analyze(
  merchant,
  observation,
  dictionary,
  now = new Date().toISOString(),
) {
  const { pages = [], domain = null } = observation;
  const checks = [];
  const add = (code, group, title, status, weight, result, evidence = []) =>
    checks.push({ id: code, group, title, status, weight, result, evidence });
  const evidence = (page, quote) => ({
    url: page.url,
    quote: String(quote).slice(0, 420),
    capturedAt: now,
  });
  const first = pages[0],
    texts = pages.map((p) => p.text).join("\n"),
    links = pages.flatMap((p) => p.links ?? []);
  const test = (code, group, title, condition, weight, good, bad, quote) => {
    add(
      code,
      group,
      title,
      !first ? "unknown" : condition ? "pass" : "violation",
      weight,
      !first ? "Сайт недоступен" : condition ? good : bad,
      first ? [evidence(first, quote ?? first.text.slice(0, 200))] : [],
    );
  };
  add(
    "domain_registered",
    "Домен",
    "Дата регистрации домена",
    domain?.registered ? "pass" : "unavailable",
    0,
    domain?.registered ?? "RDAP / WHOIS не подключён",
  );
  add(
    "domain_owner",
    "Домен",
    "Владелец домена",
    domain?.owner ? "pass" : "unavailable",
    0,
    domain?.owner ?? "Данные владельца недоступны",
  );
  add(
    "domain_expiry",
    "Домен",
    "Срок регистрации домена",
    domain?.expires ? "pass" : "unavailable",
    10,
    domain?.expires ?? "Дата истечения неизвестна",
  );
  if (domain?.expires) {
    const days = (new Date(domain.expires) - new Date(now)) / 86400000;
    const c = checks.at(-1);
    if (days < 7) {
      c.status = "violation";
      c.result = "Домен истекает менее чем через 7 дней";
    }
  }
  add(
    "availability",
    "Сайт",
    "Доступность сайта",
    first ? "pass" : "unavailable",
    0,
    first
      ? `Получено страниц: ${pages.length}`
      : (observation.error ?? "Нет ответа от сайта"),
  );
  test(
    "https",
    "Сайт",
    "Защищённое соединение HTTPS",
    first?.url.startsWith("https:"),
    20,
    "HTTPS используется",
    "Используется HTTP",
  );
  test(
    "title",
    "Сайт",
    "Заголовки страниц",
    pages.every((p) => p.title),
    5,
    "Title заполнен на всех проверенных страницах",
    "Есть страницы без title",
  );
  test(
    "frames",
    "Сайт",
    "Внешние фреймы",
    !pages.some((p) => p.frames?.length),
    10,
    "Внешние iframe не обнаружены",
    "Обнаружены внешние iframe",
    pages.flatMap((p) => p.frames ?? []).join(", "),
  );
  const payment = Array.from(
    new Set(
      [
        /\bvisa\b|mastercard|карта|картой|мир/i.test(texts) ? "Карта" : null,
        /сбп/i.test(texts) ? "СБП" : null,
        /криптовалют|bitcoin|usdt/i.test(texts) ? "Криптовалюта" : null,
      ].filter(Boolean),
    ),
  );
  test(
    "payment",
    "Оплата",
    "Раскрытие способов оплаты",
    payment.length > 0,
    10,
    payment.join(", "),
    "Способы оплаты не обнаружены",
  );
  test(
    "crypto",
    "Оплата",
    "Криптовалютные способы оплаты",
    !payment.includes("Криптовалюта"),
    20,
    "Не обнаружены",
    "Обнаружена криптовалюта; требуется проверка аналитиком",
  );
  test(
    "identity",
    "Содержимое",
    "Реквизиты компании",
    /инн|унп|бин/i.test(texts),
    15,
    "Идентификатор компании найден",
    "ИНН / УНП / БИН не найдены",
  );
  const identifiers = Array.from(
    new Set(
      [...texts.matchAll(/(?:инн|унп|бин)\s*:?\s*(\d{9,14})/gi)].map(
        (m) => m[1],
      ),
    ),
  );
  add(
    "identity_match",
    "Содержимое",
    "Сверка с карточкой мерчанта",
    !first || !merchant.inn || !identifiers.length
      ? "unknown"
      : identifiers.includes(merchant.inn)
        ? "pass"
        : "violation",
    20,
    !merchant.inn
      ? "Не задан идентификатор в карточке"
      : !identifiers.length
        ? "Нечего сверять: идентификатор не извлечён"
        : identifiers.includes(merchant.inn)
          ? "Идентификатор совпадает с карточкой"
          : "Найденные идентификаторы: " + identifiers.join(", "),
    first ? [evidence(first, identifiers.join(", "))] : [],
  );
  test(
    "contacts",
    "Содержимое",
    "Контактная информация",
    /@|\+7|контакт|телефон/i.test(texts),
    10,
    "Контактные данные найдены",
    "Контактные данные не найдены",
  );
  test(
    "refund",
    "Содержимое",
    "Условия возврата",
    /возврат|refund/i.test(texts),
    10,
    "Условия возврата найдены",
    "Условия возврата не найдены",
  );
  test(
    "offer",
    "Содержимое",
    "Публичная оферта / условия",
    /оферт|условия использования|terms/i.test(texts),
    10,
    "Условия найдены",
    "Условия не найдены",
  );
  test(
    "privacy",
    "Содержимое",
    "Политика конфиденциальности",
    /конфиденциальност|privacy/i.test(texts),
    10,
    "Политика найдена",
    "Политика не найдена",
  );
  add(
    "social",
    "Содержимое",
    "Социальные сети",
    first ? "pass" : "unknown",
    0,
    links.filter((l) => /vk.com|t.me|instagram.com/i.test(l)).join(", ") ||
      "Социальные сети не обнаружены (информационно)",
  );
  add(
    "language",
    "Содержимое",
    "Русскоязычное содержимое",
    first ? "pass" : "unknown",
    0,
    /[а-яё]/i.test(texts)
      ? "Русскоязычный текст присутствует"
      : "Русскоязычный текст не обнаружен (информационно)",
  );
  add(
    "oauth",
    "Содержимое",
    "Сторонняя авторизация",
    first ? "pass" : "unknown",
    0,
    /steam|войти через|google/i.test(texts)
      ? "Обнаружены признаки сторонней авторизации"
      : "Не обнаружена (информационно)",
  );
  for (const entry of dictionary.filter((d) => d.enabled)) {
    const matches = pages.filter((p) =>
      p.text
        .toLocaleLowerCase("ru")
        .includes(entry.term.toLocaleLowerCase("ru")),
    );
    add(
      "dict_" + entry.id,
      "Внешние источники",
      "Справочник: " + entry.term,
      !first ? "unknown" : matches.length ? "violation" : "pass",
      entry.weight,
      matches.length
        ? "Совпадение маркера; требуется оценка контекста"
        : "Совпадений не найдено",
      matches.map((p) => {
        const i = p.text.toLowerCase().indexOf(entry.term.toLowerCase());
        return evidence(
          p,
          p.text.slice(Math.max(0, i - 65), i + entry.term.length + 100),
        );
      }),
    );
  }
  for (const [code, title] of [
    ["cbr", "Перечни Банка России"],
    ["mvd", "Перечни МВД"],
    ["rkn", "Реестр РКН"],
    ["traffic", "Посещаемость и поисковая видимость"],
  ])
    add(
      code,
      "Внешние источники",
      title,
      "unavailable",
      0,
      "Источник не подключён. Проверка не выполнена",
    );
  return {
    merchantSnapshot: {
      name: merchant.name,
      url: merchant.url,
      inn: merchant.inn,
      mcc: merchant.mcc,
    },
    id: crypto.randomUUID(),
    merchantId: merchant.id,
    createdAt: now,
    mode: observation.mode ?? "live",
    checks,
    ...summarize(checks),
    pages: pages.map((p) => ({ url: p.url, title: p.title })),
    extracted: {
      identifiers,
      payment,
      emails: Array.from(
        new Set(texts.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
      ),
    },
    dictionaryVersion: dictionary
      .map((d) => `${d.id}:${d.term}:${d.weight}:${d.enabled}`)
      .join("|"),
    engineVersion: "1.0.0",
  };
}
