// Password gate for /admin/* - enforced by src/middleware.ts, see AGENTS.md
// "The admin portal". Deliberately a single shared secret, not a user table:
// this is a single-operator tool, so accounts / password resets would be
// solving a problem that does not exist here.
//
// The session is a stateless signed cookie (HMAC-SHA256 over an expiry, via
// node:crypto - nodejs_compat is already on Worker-wide for the X OAuth
// signing, see "Posting to X"), not a D1-backed session table: per-session
// revocation does not matter for one operator, and this avoids a DB round
// trip on every single admin request. ADMIN_SESSION_SECRET is a separate
// secret from ADMIN_PASSWORD on purpose, so rotating the login password does
// not also invalidate the signing key, and vice versa.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'ft_admin_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time compare - a plain === would leak timing information
 * proportional to how many leading characters match, which matters for both
 * the password check and the cookie signature check below. */
function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

export function checkPassword(candidate: string, expected: string | undefined): boolean {
	if (!expected || !candidate) return false;
	return safeEqual(candidate, expected);
}

/** Signed `payload.signature` token encoding only an expiry - there is
 * nothing else worth carrying in it for a single-operator tool with no
 * concept of "which user". */
export function createSessionToken(secret: string): string {
	const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString('base64url');
	return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string | undefined): boolean {
	if (!token || !secret) return false;
	const [payload, sig] = token.split('.');
	if (!payload || !sig || !safeEqual(sig, sign(payload, secret))) return false;
	try {
		const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		return typeof exp === 'number' && Date.now() < exp;
	} catch {
		return false;
	}
}
