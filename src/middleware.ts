// Gates every /admin/* request behind a password - see src/lib/admin-auth.ts
// and AGENTS.md "The admin portal". /admin/* is the only part of the site
// ever rendered on demand (export const prerender = false); everything else
// is static output and never reaches this file at request time.
import { defineMiddleware } from 'astro/middleware';
import { env } from 'cloudflare:workers';
import { SESSION_COOKIE, verifySessionToken } from './lib/admin-auth.ts';

const LOGIN_PATHS = new Set(['/admin/login', '/admin/login/']);

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;
	const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
	if (!isAdmin) return next();

	// Fail closed, not open: an unconfigured secret must never mean "anyone
	// can log in" or "the check is skipped" - the same instinct pickBackend()
	// applies to a missing Kitesurf credential (see "Posting to X").
	if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
		return new Response(
			'/admin is not configured: ADMIN_PASSWORD and ADMIN_SESSION_SECRET must ' +
				'both be set (wrangler secret put, or .dev.vars locally). Refusing to ' +
				'serve /admin unauthenticated.',
			{ status: 500, headers: { 'Content-Type': 'text/plain' } }
		);
	}

	if (LOGIN_PATHS.has(pathname)) return next();

	const token = context.cookies.get(SESSION_COOKIE)?.value;
	if (verifySessionToken(token, env.ADMIN_SESSION_SECRET)) return next();

	const target = pathname + context.url.search;
	return context.redirect(`/admin/login?next=${encodeURIComponent(target)}`, 302);
});
