import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppProviders } from '../providers';
import { SESSION_COOKIE } from '../services/session';

export function sessionRoutes(providers: AppProviders): Hono {
  const routes = new Hono();
  routes.get('/session', (c) => {
    const existing = getCookie(c, SESSION_COOKIE);
    const ownerId = providers.sessions.valid(existing) ? existing : providers.sessions.create();
    if (ownerId !== existing) {
      setCookie(c, SESSION_COOKIE, ownerId, {
        httpOnly: true,
        sameSite: 'Strict',
        secure: new URL(c.req.url).protocol === 'https:',
        path: '/',
      });
    }
    return c.json({ owner: true });
  });
  routes.delete('/session', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (providers.sessions.valid(ownerId)) {
      providers.intake.deleteOwner(ownerId);
      providers.sessions.revoke(ownerId);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ deleted: true });
  });
  return routes;
}
