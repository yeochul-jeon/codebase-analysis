import type { Hono } from 'hono';

export function registerHealthRoute(app: Hono): void {
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
}
