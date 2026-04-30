export const openApiSpec = {
    openapi: "3.0.3",
    info: {
        title: "Crypto Bot BFF API",
        version: "1.0.0",
        description: "Backend-for-frontend API for scanner, bot control, and trade history state."
    },
    servers: [{ url: "http://localhost:3001" }],
    paths: {
        "/api/bot/state": { get: { summary: "Current bot state", responses: { "200": { description: "OK" } } } },
        "/api/signals": { get: { summary: "Fetch scanner signals", responses: { "200": { description: "OK" } } } },
        "/api/bot/start": { post: { summary: "Start bot", responses: { "200": { description: "OK" } } } },
        "/api/bot/stop": { post: { summary: "Stop bot", responses: { "200": { description: "OK" } } } },
        "/api/bot/scan": { post: { summary: "Run scan once", responses: { "200": { description: "OK" } } } },
        "/api/bot/preview-scan": { post: { summary: "Preview scan with explicit timeframe/limit", responses: { "200": { description: "OK" } } } },
        "/api/bot/start-trade": { post: { summary: "Open manual paper trade", responses: { "200": { description: "OK" } } } },
        "/api/bot/close": { post: { summary: "Close active trade", responses: { "200": { description: "OK" } } } },
        "/api/bot/extend-trade-time": { post: { summary: "Extend active trade max-hold", responses: { "200": { description: "OK" } } } },
        "/api/bot/auto-mode": { post: { summary: "Toggle auto-mode", responses: { "200": { description: "OK" } } } },
        "/api/bot/config": { post: { summary: "Patch bot config", responses: { "200": { description: "OK" } } } }
    }
} as const;

export function swaggerUiHtml(): string {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Crypto Bot BFF API Docs</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui'
      });
    </script>
  </body>
</html>`;
}

