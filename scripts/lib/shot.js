// Render a social card image for a repo.
//
// Two backends, same output. Kitesurf (Cloudflare Browser Run) is the
// production path: it is Cloudflare's Rust/WASM agent browser, free in beta,
// and runs next to the rest of the stack. The local Playwright backend exists
// because the site is not deployed yet - Kitesurf screenshots over the network,
// so until theforktimes.com resolves there is nothing for it to point at.
//
// Both accept raw HTML as well as a URL, which is what makes pre-deploy cards
// possible at all.

import fs from 'node:fs';

const CF_API = 'https://api.cloudflare.com/client/v4';

// X renders timeline images at roughly 2:1; 1200x675 is the conventional card
// size and stays legible as a thumbnail. A full-page screenshot of a repo page
// would be tall, dense and unreadable at timeline scale, so the card is the
// top of the page - masthead, headline number, stats, graph - and no more.
export const CARD = { width: 1200, height: 675, deviceScaleFactor: 2 };

/**
 * Card presentation, injected at screenshot time rather than living in the
 * site's stylesheet.
 *
 * The repo page is built to be read; a timeline card is glanced at. Everything
 * below the editorial claim is noise at this size, and the page's own reading
 * measure leaves most of a 2:1 frame empty. This is a rendering concern of the
 * screenshot step, so it stays here instead of adding a route or a class the
 * live site would carry.
 */
export const CARD_CSS = `
  html, body { background: var(--bg-sheet) !important; }
  .page-container { padding: 0 !important; }
  .repo-sheet {
    box-shadow: none !important;
    margin: 0 !important;
    max-width: none !important;
    min-height: 100vh;
    padding: 3.2rem 3.6rem !important;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  /* Everything past the editorial claim is unreadable at card size. */
  .star-graph-empty, .repo-links, .repo-appearances,
  .repo-readme, .edition-colophon, .repo-section-title { display: none !important; }
  .star-graph { margin: 1.4rem 0 0 !important; }
  .star-graph-canvas { height: 150px !important; }
  .star-graph-caption { display: none !important; }
  .repo-eyebrow { font-size: 1rem !important; margin-bottom: 1.1rem !important; }
  /* The wordmark above already says this; keep only the beat. */
  .repo-eyebrow > a:first-child,
  .repo-eyebrow > .story-source-sep:first-of-type { display: none !important; }
  .repo-title { font-size: 3.6rem !important; margin-bottom: 0.5rem !important; }
  .repo-headline-metric { font-size: 1.5rem !important; }
  .repo-alternative { font-size: 1.15rem !important; margin-top: 0.7rem !important; }
  .repo-stats { margin: 1.6rem 0 0 !important; padding: 1.1rem 0 !important; }
  .repo-stats dt { font-size: 0.82rem !important; }
  .repo-stats dd { font-size: 1.7rem !important; }
  .repo-why { margin-top: 1.5rem !important; }
  .repo-why p { font-size: 1.3rem !important; line-height: 1.45 !important; }
  /* The masthead has to be on the card - it is the whole point of the card. */
  .repo-header::before {
    content: "THE FORK TIMES";
    display: block;
    font-family: var(--font-display);
    font-size: 0.95rem;
    letter-spacing: 0.34em;
    color: var(--accent);
    margin-bottom: 1rem;
  }
`;

/** Splice the card stylesheet in just before </head>, or at the top if absent. */
export function withCardCss(html) {
	const tag = `<style>${CARD_CSS}</style>`;
	return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html;
}

/**
 * Chrome to strip from a github.com page before capturing it.
 *
 * A logged-out GitHub page carries a cookie banner, a sign-in dialog and a
 * promo header, all of which land in the top 675px - exactly the crop the card
 * uses - and none of which say anything about the repository.
 */
export const GITHUB_CARD_CSS = `
  .js-cookie-consent-banner, .cookie-banner, [data-testid="cookie-banner"],
  .js-notice, .flash-notice, .js-header-notice,
  .signup-prompt, .signup-prompt-bg, dialog[open],
  .js-signup-prompt, .Popover, .js-notification-shelf,
  header.HeaderMenu-dropdown, .js-site-banner, .position-fixed.bottom-0 {
    display: none !important;
  }
  body { padding-top: 0 !important; }
`;

/**
 * Choose a backend. Kitesurf whenever Cloudflare credentials are present.
 *
 * `want` forces one: pass 'kitesurf' to make missing credentials an error
 * instead of a silent downgrade to Playwright. Worth using in CI and in the
 * scheduled job, where quietly rendering with a different browser than the
 * one you configured is the sort of thing nobody notices for a month.
 */
export function pickBackend(env = process.env, want) {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? env.CF_ACCOUNT_ID;
	const apiToken = env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN;
	const haveCf = Boolean(accountId && apiToken);

	if (want === 'kitesurf') {
		if (!haveCf) {
			throw new Error(
				'Kitesurf was requested but CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not set'
			);
		}
		return { name: 'kitesurf', accountId, apiToken };
	}
	if (want === 'local') return { name: 'local' };
	if (haveCf) return { name: 'kitesurf', accountId, apiToken };
	return { name: 'local' };
}

async function shootKitesurf({ url, html, viewport, injectCss, accountId, apiToken }) {
	const body = {
		...(url ? { url } : { html }),
		...(injectCss ? { addStyleTag: [{ content: injectCss }] } : {}),
		viewport: {
			width: viewport.width,
			height: viewport.height,
			deviceScaleFactor: viewport.deviceScaleFactor,
		},
		// The star graph is WebGL and paints after load, so wait for the network
		// to settle rather than screenshotting a blank canvas.
		gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
		screenshotOptions: { type: 'png', fullPage: false },
	};

	const res = await fetch(
		`${CF_API}/accounts/${accountId}/browser-run/screenshot?browser=kitesurf`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}
	);

	// A success returns the PNG bytes directly, but a failure comes back as
	// Cloudflare's JSON envelope - sometimes with HTTP 200. Sniffing the
	// content type rather than assuming binary is what stops an error body
	// being handed on as a "PNG" that only fails later, at upload time, with
	// a message about the image being invalid.
	const contentType = res.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		const envelope = await res.json().catch(() => null);
		const detail = envelope?.errors?.map((e) => e.message).join('; ')
			?? JSON.stringify(envelope ?? {}).slice(0, 200);
		// Some deployments wrap the image as base64 inside the envelope.
		if (envelope?.result?.image) return Buffer.from(envelope.result.image, 'base64');
		throw new Error(`Browser Run returned JSON, not an image: ${detail}`);
	}
	if (!res.ok) {
		throw new Error(`Browser Run HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	}

	const png = Buffer.from(await res.arrayBuffer());
	// PNG magic number. Cheap, and catches anything that is not an image
	// before it reaches X's media endpoint.
	if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
		throw new Error(`Browser Run returned ${png.length} bytes that are not a PNG`);
	}
	return png;
}

/** Find the Chromium that is actually installed, rather than the one Playwright expects. */
function findChromium(env = process.env) {
	if (env.PLAYWRIGHT_CHROMIUM_PATH) return env.PLAYWRIGHT_CHROMIUM_PATH;
	const root = env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
	if (!fs.existsSync(root)) return undefined;
	const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
	if (!dir) return undefined;
	const bin = `${root}/${dir}/chrome-linux/chrome`;
	return fs.existsSync(bin) ? bin : undefined;
}

async function shootLocal({ url, html, viewport, injectCss }) {
	let chromium;
	try {
		// @vite-ignore: this branch never runs in the Worker (the admin route
		// always forces pickBackend(env, 'kitesurf')), but it is still part of
		// the Worker's build graph as plain reachable code, and without this
		// hint the bundler eagerly tries to resolve playwright-core's own
		// internals (native eval() calls, chromium-bidi) - which cannot be
		// bundled for a Workers target and fails the build outright, not just
		// at runtime. The hint tells it to leave this as a live import()
		// instead, exactly what is wanted for a dependency that is genuinely
		// optional and Node-only.
		({ chromium } = await import(/* @vite-ignore */ 'playwright'));
	} catch {
		throw new Error('playwright is not installed; run `npm i -D playwright` or set Cloudflare credentials to use Kitesurf');
	}
	// Honour an egress proxy if the environment mandates one; Chromium does not
	// read HTTPS_PROXY on its own, and without this every navigation resets.
	const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy;
	const browser = await chromium.launch({
		executablePath: findChromium(),
		...(proxyServer ? { proxy: { server: proxyServer } } : {}),
	});
	try {
		const page = await browser.newPage({
			viewport: { width: viewport.width, height: viewport.height },
			deviceScaleFactor: viewport.deviceScaleFactor,
		});
		if (url) await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
		else await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
		if (injectCss) await page.addStyleTag({ content: injectCss });
		return await page.screenshot({ type: 'png', fullPage: false });
	} finally {
		await browser.close();
	}
}

/**
 * Capture a card. Pass exactly one of `url` or `html`.
 * Returns a PNG buffer.
 */
export async function screenshot({ url, html, viewport = CARD, injectCss, backend = pickBackend() } = {}) {
	if (!url && !html) throw new Error('screenshot needs either a url or html');
	if (backend.name === 'kitesurf') {
		return shootKitesurf({ url, html, viewport, injectCss, accountId: backend.accountId, apiToken: backend.apiToken });
	}
	return shootLocal({ url, html, viewport, injectCss });
}

/**
 * Card of the repository's own GitHub page.
 *
 * Preferred over a card of our page: developers recognise the GitHub chrome
 * instantly, and it shows the project as its maintainers present it rather
 * than as we reframe it. The post text carries our voice and our number, so
 * the brand rides on the words, not the picture.
 */
export function githubCard(repo, opts = {}) {
	return screenshot({
		url: `https://github.com/${repo}`,
		injectCss: GITHUB_CARD_CSS,
		...opts,
	});
}
