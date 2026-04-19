import type { MiddlewareHandler } from 'hono';

export function requireBearer(expected: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    const [scheme, token] = auth.split(' ');
    if (scheme !== 'Bearer' || token !== expected) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
