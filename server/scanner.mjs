import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { AppError, canonicalUrl } from "../core/model.mjs";
/** Fail closed on non-public targets, mixed DNS answers and every redirect hop. */
export function isPublicIp(address) {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublic(hostname, resolver = lookup) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await resolver(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
    throw new AppError(400, "Адрес ведёт в закрытую или служебную сеть");
  return addresses[0];
}
/** Pin the checked DNS answer to the actual socket, preserving TLS SNI verification. */
export async function fetchPublic(
  url,
  { redirects = 0, deadline = Date.now() + 18000 } = {},
) {
  const u = new URL(url);
  canonicalUrl(u.origin);
  if (redirects > 3 || Date.now() > deadline)
    throw new AppError(422, "Превышен лимит переходов или времени");
  const address = await resolvePublic(u.hostname);
  if (Date.now() > deadline) throw new AppError(422, "Превышен лимит времени");
  const response = await new Promise((resolve, reject) => {
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      {
        method: "GET",
        headers: {
          "User-Agent": "MeridianMonitor/1.0 (+site-audit; limited crawl)",
          Accept: "text/html,text/plain",
        },
        lookup: (_host, options, cb) =>
          options.all
            ? cb(null, [address])
            : cb(null, address.address, address.family),
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1000000) {
            req.destroy(new AppError(422, "Страница превышает лимит 1 МБ"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            url: u.href,
          }),
        );
        res.on("error", reject);
      },
    );
    const overall = setTimeout(
      () => req.destroy(new AppError(422, "Превышен общий лимит времени")),
      Math.max(1, deadline - Date.now()),
    );
    overall.unref();
    req.on("close", () => clearTimeout(overall));
    req.setTimeout(Math.max(1, Math.min(6000, deadline - Date.now())), () =>
      req.destroy(new AppError(422, "Сайт не ответил вовремя")),
    );
    req.on("error", reject);
    req.end();
  });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.location
  )
    return fetchPublic(new URL(response.headers.location, u).href, {
      redirects: redirects + 1,
      deadline,
    });
  if (response.status !== 200)
    throw new AppError(422, "Сайт ответил HTTP " + response.status);
  const type = response.headers["content-type"] ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/.test(type))
    throw new AppError(422, "Неподдерживаемый тип страницы");
  return response;
}
export function parsePage(body, url) {
  const $ = load(body);
  $("script,style,noscript,svg").remove();
  const links = $("a[href]")
    .map((_, el) => {
      try {
        const u = new URL($(el).attr("href"), url);
        return ["http:", "https:"].includes(u.protocol) ? u.href : null;
      } catch {
        return null;
      }
    })
    .get();
  return {
    url,
    title: $("title").first().text().trim(),
    text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 200000),
    links,
    frames: $("iframe[src]")
      .map((_, el) => $(el).attr("src"))
      .get(),
  };
}
export async function liveObservation(merchant) {
  const deadline = Date.now() + 18000;
  try {
    const root = await fetchPublic(merchant.url, { deadline });
    const pages = [parsePage(root.body, root.url)];
    const origin = new URL(root.url).origin;
    const links = [...new Set(pages[0].links)]
      .filter(
        (link) =>
          new URL(link).origin === origin &&
          !/\.(pdf|zip|png|jpg|mp4|exe)(\?|$)/i.test(link) &&
          link !== root.url,
      )
      .sort(
        (a, b) =>
          Number(/contact|about|ofert|terms|privacy|refund|оплат/i.test(b)) -
          Number(/contact|about|ofert|terms|privacy|refund|оплат/i.test(a)),
      )
      .slice(0, 4);
    for (const link of links) {
      if (Date.now() > deadline) break;
      try {
        const r = await fetchPublic(link, { deadline });
        pages.push(parsePage(r.body, r.url));
      } catch {
        /* A failed child page is recorded below as incomplete crawl metadata. */
      }
    }
    return { mode: "live", pages, domain: null, crawlLimited: true };
  } catch (e) {
    if (e.status === 400) throw e;
    return {
      mode: "live",
      pages: [],
      error: "Не удалось получить сайт: " + e.message,
    };
  }
}
