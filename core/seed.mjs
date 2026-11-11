import { analyze } from "./analyze.mjs";
export function demoObservation(merchant) {
  const profile = merchant.demoProfile ?? "clean";
  const base = `ООО «${merchant.name}». ИНН: ${profile === "mismatch" ? "7700000001" : merchant.inn || "7700000000"}. Контакты: info@${new URL(merchant.url).hostname}. Оплата картой Мир, СБП. Публичная оферта. Условия возврата. Политика конфиденциальности. Русская версия.`;
  const text =
    profile === "critical"
      ? "Пополнить баланс USDT. Криптовалюта. Казино и ставки онлайн."
      : profile === "alarm"
        ? "Оплата картой. Контакты support@demo.example. Казино."
        : profile === "attention"
          ? "Оплата картой. Контакты info@demo.example. Публичная оферта."
          : profile === "mismatch"
            ? base + " Ставки."
            : base;
  return {
    mode: "demo",
    domain:
      profile === "clean"
        ? {
            registered: "2017-04-12",
            owner: merchant.name,
            expires: "2030-04-12",
          }
        : null,
    pages: [
      {
        url:
          (profile === "attention"
            ? merchant.url.replace("https:", "http:")
            : merchant.url) + "/",
        title: profile === "alarm" ? "" : merchant.name,
        text,
        links: [merchant.url + "/terms", "https://t.me/merchant_demo"],
        frames: [],
      },
      {
        url: merchant.url + "/about",
        title: "О компании",
        text: profile === "critical" ? "Игровые автоматы, казино." : text,
        links: [],
        frames: [],
      },
    ],
  };
}
export function seedState(now = new Date()) {
  const dictionary = [
    {
      id: "gambling",
      term: "казино",
      category: "Запрещённая деятельность",
      weight: 35,
      enabled: true,
    },
    {
      id: "betting",
      term: "ставки",
      category: "Стоп-слова",
      weight: 15,
      enabled: true,
    },
    {
      id: "weapons",
      term: "боевое оружие",
      category: "Запрещённая деятельность",
      weight: 30,
      enabled: true,
    },
  ];
  const names = [
    ["Орбита Маркет", "orbita-market", "clean", "5411"],
    ["Вектор Пэй", "vector-pay", "critical", "7995"],
    ["Север Тревел", "sever-travel", "mismatch", "4722"],
    ["Линия Дома", "liniya-doma", "attention", "5712"],
    ["Неон Диджитал", "neon-digital", "alarm", "5816"],
    ["Точка Спорта", "tochka-sporta", "clean", "5941"],
    ["Атлас Сервис", "atlas-service", "mismatch", "7399"],
    ["Флора Студио", "flora-studio", "clean", "5992"],
    ["Маяк Медиа", "mayak-media", "attention", "7311"],
    ["Модуль Тех", "modul-tech", "clean", "5732"],
    ["Пульс Гейм", "puls-game", "critical", "7995"],
    ["Лист Кофе", "list-coffee", "clean", "5812"],
  ];
  const merchants = names.map(([name, domain, demoProfile, mcc], i) => ({
    id: "demo-" + (i + 1),
    name: "ООО «" + name + "»",
    url: "https://" + domain + ".example",
    inn: String(7700000010 + i),
    mcc,
    interval: 7,
    monitoring: true,
    status: "active",
    demoProfile,
    createdAt: new Date(now - 30 * 86400000).toISOString(),
    nextScanAt: new Date(+now + ((i % 5) + 1) * 86400000).toISOString(),
  }));
  const scans = merchants
    .flatMap((m, i) =>
      [1, 8, 15].map((days) =>
        analyze(
          m,
          demoObservation(m),
          dictionary,
          new Date(now - days * 86400000 - i * 360000).toISOString(),
        ),
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    merchants,
    scans,
    dictionary,
    reviews: {},
    audit: [],
    settings: { scheduleEnabled: false, defaultMode: "demo" },
    seededAt: now.toISOString(),
  };
}
