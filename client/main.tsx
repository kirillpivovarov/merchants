import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Building2,
  ScanLine,
  BookOpen,
  BarChart3,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Download,
  ChevronRight,
  ChevronDown,
  X,
  RefreshCw,
  ShieldCheck,
  Globe,
  Clock,
  Check,
  AlertTriangle,
  ExternalLink,
  Upload,
  FileText,
  Pause,
  Play,
  Compass,
  Activity,
  Filter,
  CheckCircle2,
  Info,
  LoaderCircle,
  Menu,
} from "lucide-react";
import type {
  AppState,
  Merchant,
  Scan,
  Risk,
  Check as CheckType,
} from "./types";
import "@fontsource/golos-text/cyrillic-400.css";
import "@fontsource/golos-text/cyrillic-500.css";
import "@fontsource/golos-text/latin-400.css";
import "@fontsource/manrope/cyrillic-700.css";
import "@fontsource/manrope/latin-700.css";
import "./style.css";
const riskNames: Record<Risk, string> = {
  normal: "Норма",
  attention: "Внимание",
  alarm: "Тревога",
  critical: "Критично",
};
const date = (s?: string, full = false) =>
  s
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        ...(full ? { hour: "2-digit", minute: "2-digit" } : {}),
      }).format(new Date(s))
    : "—";
const host = (url: string) => new URL(url).hostname;
const nav = [
  { id: "overview", name: "Обзор", icon: LayoutDashboard },
  { id: "portfolio", name: "Мерчанты", icon: Building2 },
  { id: "scans", name: "Проверки", icon: ScanLine },
  { id: "dictionary", name: "Справочники", icon: BookOpen },
  { id: "reports", name: "Отчёты", icon: BarChart3 },
];
async function api(path: string, body?: object, method = "POST") {
  const r = await fetch(
    "/api" + path,
    body
      ? {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(
      new Error(data.error ?? "Не удалось выполнить запрос"),
      { status: r.status },
    );
  return data;
}
function Badge({ risk, score }: { risk: Risk; score?: number }) {
  return (
    <span className={"badge " + risk}>
      <span className="dot" />
      {score !== undefined ? score + " · " : ""}
      {riskNames[risk]}
    </span>
  );
}
function App() {
  const [data, setData] = useState<AppState | null>(null),
    [page, setPage] = useState(location.hash.slice(1) || "overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [login, setLogin] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [modal, setModal] = useState<"add" | "import" | "rule" | null>(null),
    [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState(""),
    [risk, setRisk] = useState("all"),
    [tab, setTab] = useState("all"),
    [sort, setSort] = useState("risk"),
    [scanMode, setScanMode] = useState("demo");
  // Reload server-owned records after every mutation; the UI never invents a result.
  async function refresh() {
    try {
      setData(await api("/state"));
      setLogin(false);
    } catch (e: any) {
      if (e.status === 401) setLogin(true);
      else setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const onHash = () => setPage(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  function go(next: string) {
    location.hash = next;
    setPage(next);
    setQuery("");
    setRisk("all");
    setTab("all");
    setMobile(false);
  }
  async function action(
    fn: () => Promise<any>,
    success = "Изменения сохранены",
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (r?.errors?.length)
        setError(r.errors.map((e: any) => e.message).join("; "));
      else setNotice(success);
      await refresh();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function scan(ids: string[], mode = scanMode) {
    await action(
      () => api("/scans", { ids, mode }),
      "Проверка завершена. Отчёты обновлены",
    );
  }
  if (login)
    return (
      <div className="login">
        <Compass size={40} />
        <h1>Меридиан</h1>
        <p>Войдите в рабочее пространство</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action(
              () => api("/login", { token: f.get("token") }),
              "Вход выполнен",
            );
          }}
        >
          <label>
            Ключ доступа
            <input
              autoComplete="current-password"
              type="password"
              name="token"
              required
            />
          </label>
          <button className="primary">
            Войти <ArrowRight size={16} />
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <Compass size={36} />
        <p>{error || "Загружаем рабочее пространство…"}</p>
        {error && <button onClick={refresh}>Повторить</button>}
      </div>
    );
  const summary = data.summary,
    rows = summary.rows;
  const visible = rows
    .filter(
      (m) =>
        (!query ||
          [m.name, m.url, m.inn, m.mcc].some((v) =>
            v.toLowerCase().includes(query.toLowerCase()),
          )) &&
        (risk === "all" || m.latest?.risk === risk) &&
        (tab === "all" ||
          (tab === "attention"
            ? m.latest && m.latest.score > 50
            : tab === "partial"
              ? m.latest?.completeness === "partial"
              : !m.monitoring)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : (b.latest?.score ?? -1) - (a.latest?.score ?? -1),
    );
  const merchant = selected ? rows.find((m) => m.id === selected) : null;
  const high = summary.risks.critical + summary.risks.alarm;
  const pageName =
    [...nav, { id: "settings", name: "Настройки" }].find((n) => n.id === page)
      ?.name ?? "Обзор";
  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a className="brand" href="#overview" onClick={() => go("overview")}>
          <div className="brand-icon">
            <Compass size={27} strokeWidth={1.7} />
          </div>
          <div>
            меридиан<span>КОНТРОЛЬ МЕРЧАНТОВ</span>
          </div>
        </a>
        <div className="workspace">
          <div className="workspace-icon">Б</div>
          <div>
            Банк · рабочая среда<span>Тестовый портфель</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.name}
              className={page === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} />
              {n.name}
              {n.id === "portfolio" && (
                <span className="nav-count">{summary.total}</span>
              )}
              {n.id === "scans" && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="monitor-status">
            <span className="live-dot" /> Система доступна
            <span>Источники: 4 не подключены</span>
          </div>
          <button
            className={"settings-nav " + (page === "settings" ? "active" : "")}
            onClick={() => go("settings")}
          >
            <Settings size={18} />
            Настройки
          </button>
          <div className="user">
            <div className="avatar">КП</div>
            <div>
              Аналитик<span>Рабочее пространство</span>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Открыть меню"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Рабочее пространство <ChevronRight size={14} />
            <span>{pageName}</span>
          </div>
          <div className="top-right">
            <span className="demo-label">
              <span className="dot" /> Демо-портфель
            </span>
            <span className="top-divider" />
            <span>
              {new Intl.DateTimeFormat("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">МОНИТОРИНГ САЙТОВ ТСП</div>
              <h1>
                {page === "overview" ? "Портфель под контролем" : pageName}
              </h1>
              <p>
                {page === "overview"
                  ? "Риски, изменения и результаты проверок — в одном месте."
                  : page === "portfolio"
                    ? "Все торгово-сервисные предприятия и их актуальный риск."
                    : page === "scans"
                      ? "История проверок с доказательствами по каждой находке."
                      : page === "dictionary"
                        ? "Маркеры и правила, по которым оцениваются сайты."
                        : page === "reports"
                          ? "Сводные показатели и выгрузки для работы с портфелем."
                          : "Источники данных и параметры регулярного мониторинга."}
              </p>
            </div>
            <div className="heading-actions">
              <a
                className="button secondary export-top"
                href="/api/export/portfolio.csv"
              >
                <Download size={16} />
                Выгрузить CSV
              </a>
              <button className="primary" onClick={() => setModal("add")}>
                <Plus size={17} />
                Добавить мерчанта
              </button>
            </div>
          </div>
          {error && (
            <div className="message error" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button aria-label="Закрыть ошибку" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <CheckCircle2 size={17} />
              {notice}
              <button
                aria-label="Закрыть уведомление"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="stats-grid">
                <Stat
                  title="Мерчантов в портфеле"
                  value={summary.total}
                  icon={Building2}
                  footer={
                    <>
                      <span className="green-dot" />
                      {summary.scanned} с результатами проверки
                    </>
                  }
                />
                <Stat
                  title="Требуют внимания"
                  value={summary.risks.attention + high}
                  icon={ShieldCheck}
                  color="orange"
                  footer={
                    <>
                      <span className="mini-pill">{high} высокий риск</span>{" "}
                      Приоритет для аналитика
                    </>
                  }
                />
                <Stat
                  title="Проверок в истории"
                  value={data.scans.length}
                  icon={ScanLine}
                  footer={
                    <>
                      <span className="green-dot" />
                      История сохраняется автоматически
                    </>
                  }
                />
                <Stat
                  title="Частичные проверки"
                  value={summary.partial}
                  icon={Activity}
                  color="blue"
                  footer={
                    <>
                      <span className="blue-dot" />
                      Внешние источники недоступны
                    </>
                  }
                />
              </div>
              <div className="overview-grid">
                <section className="card risk-card">
                  <div className="card-title">
                    <h2>Распределение рисков</h2>
                    <span className="muted">По последней проверке</span>
                  </div>
                  <div className="risk-summary">
                    <strong>{summary.scanned}</strong>
                    <span>
                      проверенных
                      <br />
                      мерчантов
                    </span>
                    <span className="coverage">
                      {summary.total
                        ? Math.round((summary.scanned / summary.total) * 100)
                        : 0}
                      %<small>охват портфеля</small>
                    </span>
                  </div>
                  <div
                    className="risk-bar"
                    role="img"
                    aria-label="Распределение риска"
                  >
                    {(
                      ["normal", "attention", "alarm", "critical"] as Risk[]
                    ).map((r) => (
                      <div
                        key={r}
                        className={r}
                        style={{ flex: summary.risks[r] }}
                        title={riskNames[r] + ": " + summary.risks[r]}
                      />
                    ))}
                  </div>
                  <div className="risk-legend">
                    {(
                      ["normal", "attention", "alarm", "critical"] as Risk[]
                    ).map((r) => (
                      <button
                        key={r}
                        onClick={() => {
                          go("portfolio");
                          setRisk(r);
                        }}
                      >
                        <span className={"dot " + r} />
                        <span>{riskNames[r]}</span>
                        <strong>{summary.risks[r]}</strong>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="card focus-card">
                  <div className="card-title">
                    <h2>В фокусе сегодня</h2>
                    <span className="focus-badge">Приоритеты</span>
                  </div>
                  <button
                    className="focus-item"
                    onClick={() => {
                      go("portfolio");
                      setRisk("critical");
                    }}
                  >
                    <span className="focus-icon red">
                      <AlertTriangle size={19} />
                    </span>
                    <span>
                      <strong>
                        {summary.risks.critical} мерчанта с критическим риском
                      </strong>
                      <small>Проверьте находки и зафиксируйте решение</small>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                  <button className="focus-item" onClick={() => go("settings")}>
                    <span className="focus-icon amber">
                      <Globe size={19} />
                    </span>
                    <span>
                      <strong>4 внешних источника не подключены</strong>
                      <small>Оценка может быть неполной</small>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                  <div className="focus-note">
                    <Info size={15} />
                    <span>
                      Демоданные вымышлены. Решение по мерчанту принимает
                      аналитик банка.
                    </span>
                  </div>
                </section>
              </div>
            </>
          )}
          {(page === "overview" || page === "portfolio") && (
            <section className="card portfolio-card">
              <div className="card-title">
                <div className="title-inline">
                  <h2>
                    {page === "overview" ? "Мерчанты" : "Портфель мерчантов"}
                  </h2>
                  <span className="count-pill">{rows.length}</span>
                </div>
                <div className="table-actions">
                  <button
                    className="text-button"
                    onClick={() => setModal("import")}
                  >
                    <Upload size={15} />
                    Импорт
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || !rows.length}
                    onClick={() =>
                      scan(
                        rows.slice(0, 100).map((m) => m.id),
                        "demo",
                      )
                    }
                  >
                    <RefreshCw size={15} className={busy ? "spin" : ""} />
                    Демо-проверка портфеля
                  </button>
                </div>
              </div>
              <div className="table-toolbar">
                <div className="tabs">
                  {[
                    ["all", "Все мерчанты"],
                    ["attention", "Требуют внимания"],
                    ["partial", "Частичные"],
                    ["paused", "На паузе"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={tab === id ? "selected" : ""}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="table-controls">
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Поиск мерчантов"
                      placeholder="Название, сайт или ИНН"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label className="filter">
                    <Filter size={14} />
                    <select
                      aria-label="Уровень риска"
                      value={risk}
                      onChange={(e) => setRisk(e.target.value)}
                    >
                      <option value="all">Все риски</option>
                      {Object.entries(riskNames).map(([r, n]) => (
                        <option key={r} value={r}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <select
                    aria-label="Сортировка"
                    className="sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="risk">По риску ↓</option>
                    <option value="name">По названию</option>
                  </select>
                </div>
              </div>
              <div className="table-scroll">
                <table className="merchant-table">
                  <thead>
                    <tr>
                      <th>МЕРЧАНТ / САЙТ</th>
                      <th>ИНН / MCC</th>
                      <th>ОЦЕНКА РИСКА</th>
                      <th>ПОСЛЕДНЯЯ ПРОВЕРКА</th>
                      <th>МОНИТОРИНГ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible
                      .slice(0, page === "overview" ? 6 : 1000)
                      .map((m) => (
                        <tr
                          key={m.id}
                          onClick={() => setSelected(m.id)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setSelected(m.id);
                          }}
                        >
                          <td>
                            <div className="merchant-cell">
                              <span
                                className={
                                  "merchant-logo color-" +
                                  (m.id.charCodeAt(m.id.length - 1) % 5)
                                }
                              >
                                {m.name.replace(/ООО|[«»\s]/g, "").slice(0, 1)}
                              </span>
                              <div>
                                <button
                                  className="merchant-name"
                                  onClick={() => setSelected(m.id)}
                                >
                                  {m.name}
                                </button>
                                <span className="domain">
                                  {host(m.url)} <ArrowUpRight size={11} />
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="mono">{m.inn || "Не указан"}</span>
                            <span className="subline">MCC {m.mcc || "—"}</span>
                          </td>
                          <td>
                            {m.latest ? (
                              <Badge
                                risk={m.latest.risk}
                                score={m.latest.score}
                              />
                            ) : (
                              <span className="badge neutral">Не проверен</span>
                            )}
                          </td>
                          <td>
                            <span>{date(m.latest?.createdAt, true)}</span>
                            <span className="subline">
                              {m.latest
                                ? `${m.latest.completeness === "partial" ? "Частичная" : "Полная"} · ${m.latest.mode === "demo" ? "Демо" : "Живая"}`
                                : "Ожидает проверки"}
                            </span>
                          </td>
                          <td>
                            <span
                              className={
                                "monitoring " + (!m.monitoring ? "paused" : "")
                              }
                            >
                              <span className="dot" />
                              {m.monitoring
                                ? "Каждые " + m.interval + " дн."
                                : "На паузе"}
                            </span>
                          </td>
                          <td>
                            <ChevronRight size={16} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="empty">
                    <Search size={25} />
                    <h3>Мерчанты не найдены</h3>
                    <p>Измените запрос или добавьте новый сайт.</p>
                  </div>
                )}
              </div>
              <div className="table-footer">
                <span>
                  Показано{" "}
                  {Math.min(visible.length, page === "overview" ? 6 : 1000)} из{" "}
                  {visible.length} · Обновлено только что
                </span>
                {page === "overview" ? (
                  <button
                    className="text-button"
                    onClick={() => go("portfolio")}
                  >
                    Все мерчанты <ArrowRight size={14} />
                  </button>
                ) : (
                  <span>
                    Балл: 0–50 норма · 51–80 внимание · 81–99 тревога · 100+
                    критично
                  </span>
                )}
              </div>
            </section>
          )}
          {page === "scans" && (
            <section className="card">
              <div className="card-title">
                <h2>
                  Журнал проверок{" "}
                  <span className="count-pill">{data.scans.length}</span>
                </h2>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>МЕРЧАНТ</th>
                      <th>ДАТА</th>
                      <th>РЕЗУЛЬТАТ</th>
                      <th>НАХОДКИ</th>
                      <th>ПОЛНОТА / РЕЖИМ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.scans.slice(0, 100).map((s) => {
                      const m = rows.find((m) => m.id === s.merchantId);
                      return (
                        <tr key={s.id}>
                          <td>
                            <button
                              className="merchant-name"
                              onClick={() => setSelected(s.merchantId)}
                            >
                              {m?.name}
                            </button>
                            <span className="subline">{m && host(m.url)}</span>
                          </td>
                          <td>{date(s.createdAt, true)}</td>
                          <td>
                            <Badge risk={s.risk} score={s.score} />
                          </td>
                          <td>{s.violations}</td>
                          <td>
                            <span className="badge neutral">
                              {s.completeness === "partial"
                                ? "Частичная"
                                : "Полная"}{" "}
                              · {s.mode === "demo" ? "Демо" : "Живая"}
                            </span>
                          </td>
                          <td>
                            <a
                              aria-label={"Отчёт " + m?.name}
                              className="icon-button"
                              href={"/api/reports/" + s.id}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <FileText size={17} />
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {page === "dictionary" && (
            <>
              <div className="info-banner">
                <BookOpen size={19} />
                <span>
                  Справочники применяются при следующей проверке. Уже
                  сформированные отчёты сохраняют свою версию правил.
                </span>
              </div>
              <section className="card">
                <div className="card-title">
                  <h2>
                    Правила банка{" "}
                    <span className="count-pill">{data.dictionary.length}</span>
                  </h2>
                  <button className="primary" onClick={() => setModal("rule")}>
                    <Plus size={16} />
                    Добавить маркер
                  </button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>МАРКЕР</th>
                        <th>КАТЕГОРИЯ</th>
                        <th>ВЕС</th>
                        <th>СОСТОЯНИЕ</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.dictionary.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <strong>{d.term}</strong>
                          </td>
                          <td>{d.category}</td>
                          <td>+{d.weight} баллов</td>
                          <td>
                            <span
                              className={
                                "badge " + (d.enabled ? "normal" : "neutral")
                              }
                            >
                              {d.enabled ? "Активен" : "Отключён"}
                            </span>
                          </td>
                          <td>
                            <button
                              disabled={busy}
                              className="text-button"
                              onClick={() =>
                                action(() =>
                                  api(
                                    "/dictionary/" + d.id,
                                    { enabled: !d.enabled },
                                    "PATCH",
                                  ),
                                )
                              }
                            >
                              {d.enabled ? (
                                <Pause size={14} />
                              ) : (
                                <Play size={14} />
                              )}{" "}
                              {d.enabled ? "Отключить" : "Включить"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="two-columns">
                {["Перечни ЦБ и МВД", "Реестр РКН и аналитика трафика"].map(
                  (n) => (
                    <section className="card source-card" key={n}>
                      <Globe size={22} />
                      <h3>{n}</h3>
                      <p>
                        Для работы необходим официальный источник данных или
                        договор с провайдером.
                      </p>
                      <span className="badge attention">Не подключён</span>
                    </section>
                  ),
                )}
              </div>
            </>
          )}
          {page === "reports" && (
            <>
              <div className="stats-grid">
                <Stat
                  title="Проверено мерчантов"
                  value={summary.scanned}
                  icon={Building2}
                  footer="База для распределения риска"
                />
                <Stat
                  title="Высокий риск"
                  value={high}
                  icon={AlertTriangle}
                  color="orange"
                  footer="Тревога и критично"
                />
                <Stat
                  title="Найдено индикаторов"
                  value={summary.findings}
                  icon={ScanLine}
                  footer="По последним проверкам"
                />
                <Stat
                  title="Без проверки"
                  value={summary.unscanned}
                  icon={Clock}
                  footer="Не участвуют в оценке риска"
                />
              </div>
              <div className="two-columns">
                <section className="card report-card">
                  <div className="report-icon">
                    <BarChart3 size={30} />
                  </div>
                  <h2>Сводка по портфелю</h2>
                  <p>
                    Сайты, реквизиты, баллы, уровень риска и полнота последней
                    проверки. Формат CSV для Excel.
                  </p>
                  <a
                    className="button primary"
                    href="/api/export/portfolio.csv"
                  >
                    <Download size={16} />
                    Скачать CSV
                  </a>
                </section>
                <section className="card report-card">
                  <div className="report-icon">
                    <FileText size={30} />
                  </div>
                  <h2>Аудит отдельного сайта</h2>
                  <p>
                    Детальный отчёт с результатами и доказательствами. Откройте
                    его из карточки мерчанта и сохраните в PDF через печать
                    браузера.
                  </p>
                  <button className="secondary" onClick={() => go("portfolio")}>
                    Выбрать мерчанта <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <section className="card">
                <div className="card-title">
                  <h2>Журнал действий</h2>
                  <span className="muted">Последние 50 событий</span>
                </div>
                {data.audit.length ? (
                  <div className="audit-list">
                    {data.audit.slice(0, 50).map((a) => (
                      <div key={a.id}>
                        <span className="audit-dot" />
                        <div>
                          <strong>{a.action}</strong>
                          <span>
                            {a.entity} · {a.actor}
                          </span>
                        </div>
                        <time>{date(a.at, true)}</time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <Activity size={26} />
                    <p>Здесь появятся события после ваших действий.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "settings" && (
            <>
              <section className="card settings-card">
                <h2>Регулярный мониторинг</h2>
                <p>
                  Каждому мерчанту назначается свой интервал: 1, 7 или 30 дней.
                  Node.js проверяет очередь раз в минуту.
                </p>
                <div className="setting-row">
                  <div>
                    <strong>Запускать проверки по расписанию</strong>
                    <span>
                      {data.capabilities.scheduler
                        ? "Используется живой сканер публичных сайтов"
                        : "На размещённом демостенде фоновый сканер недоступен. Запускайте приложение в Node.js для живых проверок."}
                    </span>
                  </div>
                  <button
                    className={
                      "toggle " + (data.settings.scheduleEnabled ? "on" : "")
                    }
                    aria-label="Расписание проверок"
                    aria-pressed={data.settings.scheduleEnabled}
                    disabled={busy || !data.capabilities.scheduler}
                    onClick={() =>
                      action(() =>
                        api(
                          "/settings",
                          { scheduleEnabled: !data.settings.scheduleEnabled },
                          "PATCH",
                        ),
                      )
                    }
                  >
                    <span />
                  </button>
                </div>
              </section>
              <section className="card settings-card">
                <h2>Доступность источников</h2>
                {[
                  "RDAP / WHOIS",
                  "Перечни Банка России",
                  "Перечни МВД",
                  "Реестр РКН",
                  "Посещаемость / поисковая видимость",
                ].map((s) => (
                  <div className="setting-row" key={s}>
                    <div>
                      <strong>{s}</strong>
                      <span>
                        Проверка не выполняется без подключённого провайдера
                      </span>
                    </div>
                    <span className="badge attention">Не подключён</span>
                  </div>
                ))}
              </section>
              <div className="info-banner">
                <ShieldCheck size={20} />
                <span>
                  Версия 1.0.0 · Данные сохраняются на сервере. Балл — индикатор
                  для анализа, а окончательное решение остаётся за банком.
                </span>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              Меридиан <span className="footer-dot">·</span> Мониторинг сайтов
              мерчантов
            </span>
            <span>
              <ShieldCheck size={13} /> Решения на основе проверяемых данных
            </span>
          </footer>
        </main>
      </div>
      {merchant && (
        <MerchantDrawer
          key={merchant.id}
          merchant={merchant}
          data={data}
          busy={busy}
          scanMode={scanMode}
          setScanMode={setScanMode}
          onClose={() => setSelected(null)}
          onScan={() => scan([merchant.id])}
          onAction={action}
        />
      )}
      {modal && (
        <Modal
          title={
            modal === "add"
              ? "Добавить мерчанта"
              : modal === "import"
                ? "Импорт портфеля"
                : "Добавить маркер"
          }
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              let ok = false;
              if (modal === "add")
                ok = await action(
                  () => api("/merchants", Object.fromEntries(f)),
                  "Мерчант добавлен",
                );
              if (modal === "rule")
                ok = await action(
                  () => api("/dictionary", Object.fromEntries(f)),
                  "Маркер добавлен",
                );
              if (modal === "import") {
                try {
                  const lines = String(f.get("csv"))
                    .replace(/^\uFEFF/, "")
                    .trim()
                    .split(/\r?\n/);
                  if (lines[0].trim() !== "name;url;inn;mcc")
                    throw new Error("Заголовок должен быть name;url;inn;mcc");
                  const parsed = lines
                    .slice(1)
                    .filter(Boolean)
                    .map((line) => {
                      const [name, url, inn, mcc] = line
                        .split(";")
                        .map((v) => v.trim());
                      return { name, url, inn, mcc };
                    });
                  ok = await action(
                    () => api("/import", { rows: parsed }),
                    "Портфель импортирован",
                  );
                } catch (e: any) {
                  setError(e.message || "Проверьте формат данных");
                }
              }
              if (ok) setModal(null);
            }}
          >
            {modal === "add" ? (
              <>
                <label>
                  Название организации
                  <input
                    name="name"
                    placeholder="ООО «Новая компания»"
                    minLength={2}
                    maxLength={160}
                    required
                  />
                </label>
                <label>
                  Адрес сайта
                  <input name="url" placeholder="https://example.ru" required />
                </label>
                <div className="two-columns">
                  <label>
                    ИНН / УНП / БИН
                    <input
                      name="inn"
                      placeholder="10 или 12 цифр"
                      pattern="[0-9]{9,14}"
                    />
                  </label>
                  <label>
                    MCC
                    <input name="mcc" placeholder="5411" pattern="[0-9]{4}" />
                  </label>
                </div>
                <label>
                  Периодичность
                  <select name="interval" defaultValue="7">
                    <option value="1">Ежедневно</option>
                    <option value="7">Раз в 7 дней</option>
                    <option value="30">Раз в 30 дней</option>
                  </select>
                </label>
                <p className="form-hint">
                  После добавления откройте карточку и запустите первую
                  проверку.
                </p>
              </>
            ) : modal === "rule" ? (
              <>
                <label>
                  Слово или фраза
                  <input
                    name="term"
                    placeholder="Например: казино"
                    minLength={2}
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  Категория
                  <select name="category">
                    <option>Стоп-слова</option>
                    <option>Запрещённая деятельность</option>
                    <option>Справочник банка</option>
                  </select>
                </label>
                <label>
                  Вес при совпадении
                  <input
                    type="number"
                    name="weight"
                    defaultValue="15"
                    min="0"
                    max="100"
                    required
                  />
                </label>
                <p className="form-hint">
                  Маркер ищется без учёта регистра. Совпадение требует оценки
                  контекста аналитиком.
                </p>
              </>
            ) : (
              <>
                <p className="form-hint">
                  Вставьте до 500 строк с разделителем «;». Заголовок
                  обязателен. Разделители внутри значений не поддерживаются.
                </p>
                <label>
                  Данные CSV
                  <textarea
                    rows={8}
                    name="csv"
                    required
                    placeholder={
                      "name;url;inn;mcc\nНовый магазин;https://shop.example;7700000000;5411"
                    }
                  />
                </label>
                <p className="form-hint">
                  Все строки проверяются до сохранения. При ошибке импорт
                  полностью отклоняется.
                </p>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
              >
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Plus size={16} />
                )}{" "}
                {modal === "import" ? "Импортировать" : "Добавить"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  icon: Icon,
  footer,
  color = "green",
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  footer: React.ReactNode;
  color?: string;
}) {
  return (
    <section className="card stat">
      <div className="stat-top">
        <span>{title}</span>
        <span className={"stat-icon " + color}>
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <div className="stat-footer">{footer}</div>
    </section>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(".modal input, .modal textarea")
          ?.focus(),
      30,
    );
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", fn);
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function MerchantDrawer({
  merchant: m,
  data,
  busy,
  scanMode,
  setScanMode,
  onClose,
  onScan,
  onAction,
}: {
  merchant: Merchant;
  data: AppState;
  busy: boolean;
  scanMode: string;
  setScanMode: (s: string) => void;
  onClose: () => void;
  onScan: () => void;
  onAction: (fn: () => Promise<any>, success?: string) => Promise<boolean>;
}) {
  const scans = data.scans.filter((s) => s.merchantId === m.id),
    [scanId, setScanId] = useState(""),
    [section, setSection] = useState("findings"),
    [review, setReview] = useState<CheckType | null>(null),
    [editing, setEditing] = useState(false);
  // A historical selection stays selected while newer scans arrive.
  const scan: Scan | undefined = scans.find((s) => s.id === scanId) ?? scans[0];
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !review && !editing) onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [review, editing]);
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={"Карточка " + m.name}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header">
          <span>КАРТОЧКА МЕРЧАНТА</span>
          <button
            className="icon-button"
            aria-label="Закрыть карточку"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        <div className="drawer-body">
          <h2>{m.name}</h2>
          <a
            className="site-link"
            href={m.url}
            target="_blank"
            rel="noreferrer"
          >
            {host(m.url)} <ExternalLink size={14} />
          </a>
          <div className="merchant-meta">
            <div>
              ИНН / УНП / БИН<strong>{m.inn || "Не указан"}</strong>
            </div>
            <div>
              MCC<strong>{m.mcc || "Не указан"}</strong>
            </div>
            <div>
              Мониторинг
              <strong>
                {m.monitoring ? "Раз в " + m.interval + " дн." : "На паузе"}
              </strong>
            </div>
          </div>
          <div className="drawer-actions">
            <select
              aria-label="Режим проверки"
              value={scanMode}
              onChange={(e) => setScanMode(e.target.value)}
            >
              <option value="demo">Демо-проверка</option>
              {data.capabilities.live && (
                <option value="live">Живая проверка</option>
              )}
            </select>
            <button className="primary" disabled={busy} onClick={onScan}>
              <RefreshCw size={15} className={busy ? "spin" : ""} />
              {busy ? "Проверяем…" : "Проверить"}
            </button>
            <button className="secondary" onClick={() => setEditing(true)}>
              Изменить
            </button>
          </div>
          {scanMode === "demo" && (
            <div className="small-note">
              <Info size={14} /> Демо-проверка использует вымышленный снимок
              сайта.
            </div>
          )}
          {scan ? (
            <>
              <div className={"scan-summary " + scan.risk}>
                <div>
                  <span>ОЦЕНКА РИСКА</span>
                  <strong>
                    {scan.score}
                    <small>баллов</small>
                  </strong>
                  <Badge risk={scan.risk} />
                </div>
                <div>
                  <span className="badge neutral">
                    {scan.completeness === "partial"
                      ? "Частичная проверка"
                      : "Полная проверка"}
                  </span>
                  <p>
                    {date(scan.createdAt, true)} ·{" "}
                    {scan.mode === "demo" ? "Демо" : "Живая"}
                  </p>
                  <a
                    href={"/api/reports/" + scan.id}
                    target="_blank"
                    rel="noreferrer"
                    className="text-button"
                  >
                    <FileText size={15} />
                    Открыть отчёт
                  </a>
                </div>
              </div>
              <div className="drawer-tabs">
                {[
                  ["findings", "Находки (" + scan.violations + ")"],
                  ["all", "Все проверки"],
                  ["history", "История (" + scans.length + ")"],
                  ["details", "Извлечённые данные"],
                ].map(([id, label]) => (
                  <button
                    className={section === id ? "selected" : ""}
                    key={id}
                    onClick={() => setSection(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(section === "findings" || section === "all") && (
                <div className="findings">
                  {scan.checks
                    .filter(
                      (c) => section === "all" || c.status === "violation",
                    )
                    .map((c) => {
                      const r = data.reviews[scan.id + ":" + c.id];
                      return (
                        <details
                          className={"finding " + c.status}
                          key={c.id}
                          open={section === "findings"}
                        >
                          <summary>
                            <span className={"check-dot " + c.status}>
                              {c.status === "pass" ? (
                                <Check size={13} />
                              ) : c.status === "violation" ? (
                                <AlertTriangle size={12} />
                              ) : (
                                <Info size={12} />
                              )}
                            </span>
                            <div>
                              <strong>{c.title}</strong>
                              <small>
                                {c.group}
                                {r
                                  ? " · " +
                                    (r.verdict === "false_positive"
                                      ? "Ложное срабатывание"
                                      : r.verdict === "confirmed"
                                        ? "Подтверждено"
                                        : "На рассмотрении")
                                  : ""}
                              </small>
                            </div>
                            <span className="check-weight">
                              {c.status === "violation"
                                ? "+" + c.weight
                                : c.status === "pass"
                                  ? "Норма"
                                  : "Нет данных"}
                            </span>
                          </summary>
                          <div className="finding-content">
                            <p>{c.result}</p>
                            {c.evidence.map((ev, i) => (
                              <div className="evidence" key={i}>
                                <a
                                  href={ev.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink size={12} />
                                  {ev.url}
                                </a>
                                <blockquote>
                                  {ev.quote ||
                                    "Структурный анализ страницы; текстового фрагмента нет"}
                                </blockquote>
                                <small>
                                  Зафиксировано {date(ev.capturedAt, true)}
                                </small>
                              </div>
                            ))}
                            {r && (
                              <div className="review-note">
                                <CheckCircle2 size={14} />
                                <div>
                                  {r.note}
                                  <small>
                                    {r.actor} · {date(r.at, true)}
                                  </small>
                                </div>
                              </div>
                            )}
                            {c.status === "violation" && (
                              <button
                                className="text-button"
                                onClick={() => setReview(c)}
                              >
                                Зафиксировать решение <ArrowRight size={13} />
                              </button>
                            )}
                          </div>
                        </details>
                      );
                    })}
                  {section === "findings" && !scan.violations && (
                    <div className="empty">
                      <ShieldCheck size={30} />
                      <h3>Нарушений не обнаружено</h3>
                      <p>
                        Недоступные источники смотрите во вкладке «Все
                        проверки».
                      </p>
                    </div>
                  )}
                </div>
              )}
              {section === "history" && (
                <div className="history-list">
                  {scans.map((s) => (
                    <button
                      key={s.id}
                      className={scan.id === s.id ? "selected" : ""}
                      onClick={() => {
                        setScanId(s.id);
                        setSection("findings");
                      }}
                    >
                      <Clock size={17} />
                      <span>
                        <strong>{date(s.createdAt, true)}</strong>
                        <small>
                          {s.mode === "demo" ? "Демонстрационная" : "Живая"} ·{" "}
                          {s.checks.length} проверок
                        </small>
                      </span>
                      <Badge risk={s.risk} score={s.score} />
                    </button>
                  ))}
                </div>
              )}
              {section === "details" && (
                <div className="data-details">
                  {[
                    ["Найденные идентификаторы", scan.extracted.identifiers],
                    ["Способы оплаты", scan.extracted.payment],
                    ["Email", scan.extracted.emails],
                  ].map(([label, values]) => (
                    <div key={String(label)}>
                      <small>{label}</small>
                      <strong>
                        {(values as string[]).join(", ") || "Не обнаружены"}
                      </strong>
                    </div>
                  ))}
                  <h3>Проверенные страницы</h3>
                  {scan.pages.map((p) => (
                    <a
                      key={p.url}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.url}
                      <ExternalLink size={13} />
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty">
              <ScanLine size={30} />
              <h3>Проверок пока нет</h3>
              <p>Запустите проверку, чтобы получить оценку сайта.</p>
            </div>
          )}
        </div>
      </aside>
      {review && scan && (
        <Modal title="Решение аналитика" onClose={() => setReview(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await onAction(
                  () =>
                    api("/scans/" + scan.id + "/reviews", {
                      ...Object.fromEntries(f),
                      checkId: review.id,
                    }),
                  "Решение сохранено",
                )
              )
                setReview(null);
            }}
          >
            <p className="form-hint">
              {review.title}. Решение сохраняется отдельно, исходная оценка
              проверки остаётся в истории.
            </p>
            <label>
              Решение
              <select name="verdict" aria-label="Решение">
                <option value="confirmed">Подтвердить находку</option>
                <option value="false_positive">Ложное срабатывание</option>
                <option value="pending">На рассмотрении</option>
              </select>
            </label>
            <label>
              Комментарий
              <textarea
                name="note"
                rows={4}
                minLength={3}
                maxLength={1000}
                required
              />
            </label>
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                Сохранить решение
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title="Настройки мерчанта" onClose={() => setEditing(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await onAction(() =>
                  api(
                    "/merchants/" + m.id,
                    {
                      ...Object.fromEntries(f),
                      monitoring: f.get("monitoring") === "on",
                    },
                    "PATCH",
                  ),
                )
              )
                setEditing(false);
            }}
          >
            <label>
              Название
              <input
                name="name"
                defaultValue={m.name}
                required
                minLength={2}
                maxLength={160}
              />
            </label>
            <label>
              Сайт
              <input name="url" defaultValue={m.url} required />
            </label>
            <div className="two-columns">
              <label>
                ИНН / УНП / БИН
                <input name="inn" defaultValue={m.inn} pattern="[0-9]{9,14}" />
              </label>
              <label>
                MCC
                <input name="mcc" defaultValue={m.mcc} pattern="[0-9]{4}" />
              </label>
            </div>
            <label>
              Периодичность
              <select name="interval" defaultValue={m.interval}>
                <option value="1">Ежедневно</option>
                <option value="7">Раз в 7 дней</option>
                <option value="30">Раз в 30 дней</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                name="monitoring"
                type="checkbox"
                defaultChecked={m.monitoring}
              />
              Мониторинг активен
            </label>
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
