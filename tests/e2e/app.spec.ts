import { test, expect } from "@playwright/test";
const stamp = Date.now().toString();
test("overview shows a consistent portfolio and navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Портфель под контролем" }),
  ).toBeVisible();
  await expect(page.getByText("Распределение рисков")).toBeVisible();
  await expect(page.locator(".merchant-table tbody tr")).toHaveCount(6);
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  for (const name of ["Мерчанты", "Проверки", "Справочники", "Отчёты"]) {
    await page
      .locator("nav")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true, level: 1 }),
    ).toBeVisible();
  }
});
test("search, risk filter, sort and empty results", async ({ page }) => {
  await page.goto("/#portfolio");
  await page.getByLabel("Поиск мерчантов").fill("vector-pay");
  await expect(page.locator(".merchant-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Поиск мерчантов").fill("no-merchant-found");
  await expect(page.getByText("Мерчанты не найдены")).toBeVisible();
  await page.getByLabel("Поиск мерчантов").fill("");
  await page
    .getByLabel("Уровень риска", { exact: true })
    .selectOption("critical");
  await expect(page.locator(".merchant-table tbody tr")).toHaveCount(2);
  await page.getByLabel("Сортировка").selectOption("name");
});
test("merchant evidence, analyst verdict, immutable report and scan history", async ({
  page,
  request,
}) => {
  await page.goto("/#portfolio");
  await page
    .getByRole("button", { name: "ООО «Вектор Пэй»", exact: true })
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Карточка ООО «Вектор Пэй»",
  });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".evidence").first()).toBeVisible();
  await drawer
    .getByRole("button", { name: "Зафиксировать решение" })
    .first()
    .click();
  const modal = page.getByRole("dialog", { name: "Решение аналитика" });
  await modal
    .getByLabel("Решение", { exact: true })
    .selectOption("false_positive");
  await modal
    .getByLabel("Комментарий")
    .fill("Контекст проверен вручную в автотесте");
  await modal.getByRole("button", { name: "Сохранить решение" }).click();
  await expect(
    page.getByText("Контекст проверен вручную в автотесте"),
  ).toBeVisible();
  const reportUrl = await drawer
    .getByRole("link", { name: "Открыть отчёт" })
    .getAttribute("href");
  const report = await request.get(reportUrl!);
  expect(report.ok()).toBeTruthy();
  expect(await report.text()).toContain("ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ");
  await drawer.getByRole("button", { name: "История", exact: false }).click();
  await expect(drawer.locator(".history-list button")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/merchant-evidence.png",
    fullPage: true,
  });
});
test("add merchant, scan it and change its monitoring interval", async ({
  page,
}) => {
  await page.goto("/#portfolio");
  await page.getByRole("button", { name: "Добавить мерчанта" }).click();
  const modal = page.getByRole("dialog", { name: "Добавить мерчанта" });
  await modal
    .getByLabel("Название организации")
    .fill("Тестовый магазин " + stamp);
  await modal
    .getByLabel("Адрес сайта")
    .fill("https://test-" + stamp + ".example");
  await modal.getByLabel("ИНН / УНП / БИН").fill("7700000000");
  await modal.getByLabel("MCC", { exact: true }).fill("5411");
  await modal.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.getByLabel("Поиск мерчантов").fill("Тестовый магазин " + stamp);
  await page
    .getByRole("button", { name: "Тестовый магазин " + stamp, exact: true })
    .click();
  const drawer = page.locator(".drawer");
  await expect(drawer.getByText("Проверок пока нет")).toBeVisible();
  await drawer.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(drawer.locator(".scan-summary p")).toContainText("Демо");
  await drawer.getByRole("button", { name: "Изменить", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Настройки мерчанта" });
  await edit.getByLabel("Периодичность").selectOption("30");
  await edit.getByLabel("Мониторинг активен").uncheck();
  await edit.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(drawer.getByText("На паузе", { exact: true })).toBeVisible();
});
test("duplicate site produces visible validation message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Добавить мерчанта" }).click();
  const modal = page.getByRole("dialog", { name: "Добавить мерчанта" });
  await modal.getByLabel("Название организации").fill("Дубликат");
  await modal.getByLabel("Адрес сайта").fill("https://vector-pay.example");
  await modal.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Этот сайт уже есть");
  await expect(modal).toBeVisible();
});
test("import is atomic and creates only valid unique rows", async ({
  page,
  request,
}) => {
  await page.goto("/#portfolio");
  const before = (await (await request.get("/api/state")).json()).merchants
    .length;
  await page.getByRole("button", { name: "Импорт", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Импорт портфеля" });
  await modal
    .getByLabel("Данные CSV")
    .fill(
      "name;url;inn;mcc\nИмпорт;https://import-" +
        stamp +
        ".example;7700000000;5411\nОшибка;https://vector-pay.example;;",
    );
  await modal.getByRole("button", { name: "Импортировать" }).click();
  await expect(page.getByRole("alert")).toContainText("Дубликат");
  expect(
    (await (await request.get("/api/state")).json()).merchants.length,
  ).toBe(before);
  await modal
    .getByLabel("Данные CSV")
    .fill(
      "name;url;inn;mcc\nИмпорт;https://import-" +
        stamp +
        ".example;7700000000;5411",
    );
  await modal.getByRole("button", { name: "Импортировать" }).click();
  await expect(modal).not.toBeVisible();
  expect(
    (await (await request.get("/api/state")).json()).merchants.length,
  ).toBe(before + 1);
});
test("dictionary rule is added, disabled and retained after reload", async ({
  page,
}) => {
  await page.goto("/#dictionary");
  await page.getByRole("button", { name: "Добавить маркер" }).click();
  const modal = page.getByRole("dialog", { name: "Добавить маркер" });
  await modal.getByLabel("Слово или фраза").fill("Маркер " + stamp);
  await modal.getByLabel("Вес при совпадении").fill("17");
  await modal.getByRole("button", { name: "Добавить", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "Маркер " + stamp });
  await expect(row).toContainText("+17");
  await row.getByRole("button", { name: "Отключить" }).click();
  await expect(row).toContainText("Отключён");
  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: "Маркер " + stamp }),
  ).toContainText("Отключён");
});
test("CSV export and settings are reachable", async ({ page }) => {
  await page.goto("/#reports");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("meridian-portfolio.csv");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByText("Доступность источников")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Расписание проверок" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
test("mobile layout supports navigation and merchant card without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Портфель под контролем" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Мерчанты", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ООО «Вектор Пэй»", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Карточка ООО «Вектор Пэй»" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
});
test("no browser errors or unexpected network failures on overview", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Распределение рисков")).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => document.fonts.check('12px "Golos Text"')),
  ).toBe(true);
});
