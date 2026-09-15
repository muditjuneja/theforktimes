// POST-only, matching the plain-POST-form convention the rest of /admin
// uses - a bare link would let a prefetch or crawler log the operator out
// by accident. Linked from a form on /admin, not a URL a browser would ever
// navigate to with GET.
export const prerender = false;

import type { APIContext } from 'astro';
import { SESSION_COOKIE } from '../../lib/admin-auth.ts';

export async function POST({ cookies, redirect }: APIContext) {
	cookies.delete(SESSION_COOKIE, { path: '/admin' });
	return redirect('/admin/login', 303);
}
