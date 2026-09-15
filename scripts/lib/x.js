// Minimal X (Twitter) API v2 client: OAuth 1.0a user context, post only.
//
// OAuth 1.0a rather than OAuth 2.0 PKCE because this posts as exactly one
// account we own. PKCE would buy a refresh-token dance and a callback URL for
// no benefit here; 1.0a keys are static and the endpoint still accepts them.
//
// Pricing note, because it drives how this is used: X moved to pay-per-use in
// February 2026. A plain post costs $0.015; a post containing a URL costs
// $0.20 - a 13x surcharge introduced in April 2026. There is no free tier.

import crypto from 'node:crypto';

const ENDPOINT = 'https://api.x.com/2/tweets';
// Media goes to the v1.1 host on purpose. OAuth 1.0a cannot reach the v2
// endpoint (/2/media/upload requires an OAuth 2.0 token with media.write), and
// this app is 1.0a because it posts as one account we own. The v1.1 upload host
// still accepts 1.0a, so that is the only combination that works end to end.
const UPLOAD = 'https://upload.x.com/1.1/media/upload.json';

/** RFC3986 percent-encoding. encodeURIComponent leaves !*'() alone; OAuth does not. */
function pct(str) {
	return encodeURIComponent(str).replace(
		/[!*'()]/g,
		(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
	);
}

/**
 * Build the OAuth 1.0a Authorization header.
 *
 * The request body is deliberately excluded from the signature base string:
 * that only includes form-encoded bodies, and this endpoint takes JSON. Signing
 * the JSON here produces a 401 that looks like a bad-credentials problem.
 */
function authHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret }) {
	const oauth = {
		oauth_consumer_key: consumerKey,
		oauth_nonce: crypto.randomBytes(16).toString('hex'),
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
		oauth_token: token,
		oauth_version: '1.0',
	};

	const paramString = Object.keys(oauth)
		.sort()
		.map((k) => `${pct(k)}=${pct(oauth[k])}`)
		.join('&');

	const base = `${method.toUpperCase()}&${pct(url)}&${pct(paramString)}`;
	const signingKey = `${pct(consumerSecret)}&${pct(tokenSecret)}`;
	const signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');

	const header = { ...oauth, oauth_signature: signature };
	return 'OAuth ' + Object.keys(header)
		.sort()
		.map((k) => `${pct(k)}="${pct(header[k])}"`)
		.join(', ');
}

export function xCredentials(env = process.env) {
	const creds = {
		consumerKey: env.X_API_KEY,
		consumerSecret: env.X_API_SECRET,
		token: env.X_ACCESS_TOKEN,
		tokenSecret: env.X_ACCESS_TOKEN_SECRET,
	};
	const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k);
	return { creds, missing };
}

/** Anything that would trip X's URL detection, and therefore the surcharge. */
export function containsUrl(text) {
	return /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|org|net|io|dev|ai|co|sh|cat)\b/i.test(text);
}

export function estimateCost(text) {
	return containsUrl(text) ? 0.20 : 0.015;
}

/**
 * Upload a PNG and return its media_id.
 *
 * Sent as multipart/form-data rather than form-encoded so the body stays out of
 * the OAuth signature base string - the spec only folds in body params for
 * application/x-www-form-urlencoded. Base64-in-a-form-field would otherwise
 * have to be signed, which is both slow and easy to get wrong.
 */
export async function uploadMedia(png, { creds, altText } = {}) {
	const form = new FormData();
	form.append('media', new Blob([png], { type: 'image/png' }), 'card.png');

	const res = await fetch(UPLOAD, {
		method: 'POST',
		headers: { Authorization: authHeader({ method: 'POST', url: UPLOAD, ...creds }) },
		body: form,
	});
	const payload = await res.text();
	if (!res.ok) throw new Error(`X media upload HTTP ${res.status}: ${payload.slice(0, 300)}`);
	const mediaId = JSON.parse(payload).media_id_string;

	// Alt text is a separate call and is not optional for us: a card whose
	// content is text is unreadable to anyone using a screen reader without it.
	if (altText) {
		const metaUrl = 'https://upload.x.com/1.1/media/metadata/create.json';
		await fetch(metaUrl, {
			method: 'POST',
			headers: {
				Authorization: authHeader({ method: 'POST', url: metaUrl, ...creds }),
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ media_id: mediaId, alt_text: { text: altText.slice(0, 1000) } }),
		}).catch(() => { /* the post is still worth making without alt text */ });
	}

	return mediaId;
}

export async function postTweet(text, { creds, replyTo, mediaIds } = {}) {
	const body = { text };
	if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
	if (mediaIds?.length) body.media = { media_ids: mediaIds };

	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: authHeader({ method: 'POST', url: ENDPOINT, ...creds }),
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const payload = await res.text();
	if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${payload.slice(0, 300)}`);
	const parsed = JSON.parse(payload);
	return { id: parsed.data?.id, text: parsed.data?.text };
}
