import assets from "../dist/server/assets.mjs";
import { StateStore, D1Adapter } from "./store.mjs";
import { seedState } from "../core/seed.mjs";
import { handleApi } from "../core/api.mjs";
/** Sites owns authentication. This adapter never trusts browser identity input. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!env.DB)
        return new Response(
          JSON.stringify({ error: "Хранилище D1 не подключено" }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      // Health verifies the migration-owned schema without disclosing business data.
      if (url.pathname === "/api/health") {
        try {
          await env.DB.prepare(
            "SELECT id FROM workspace_state LIMIT 1",
          ).first();
          return Response.json({
            status: "ok",
            version: "1.0.0",
            storage: "ready",
            mode: "demo",
          });
        } catch {
          return Response.json(
            { error: "Миграция хранилища не применена" },
            { status: 503 },
          );
        }
      }
      const actor = request.headers.get("oai-authenticated-user-id");
      return handleApi(request, {
        store: new StateStore(new D1Adapter(env.DB, seedState)),
        actor,
      });
    }
    const key = assets[url.pathname] ? url.pathname : "/index.html",
      extension = key.split(".").at(-1);
    const mime = {
      html: "text/html; charset=utf-8",
      js: "text/javascript; charset=utf-8",
      css: "text/css; charset=utf-8",
      woff2: "font/woff2",
      woff: "font/woff",
    };
    const body = Uint8Array.from(atob(assets[key]), (c) => c.charCodeAt(0));
    return new Response(body, {
      headers: {
        "content-type": mime[extension] ?? "application/octet-stream",
        "cache-control":
          key === "/index.html"
            ? "no-cache"
            : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self'",
      },
    });
  },
};
