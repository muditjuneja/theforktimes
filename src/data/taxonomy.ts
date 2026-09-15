// Editorial taxonomy for The Fork Times.
//
// This file is curated on purpose. Industry and "alternative to" are exactly
// the judgements that the ranked-numbers sites do not make, so they are not
// inferred from topics alone - a keyword pass gets the long tail, and the
// curated table below overrides it wherever a human has made a call.

export type Industry =
	| 'ai' | 'data' | 'devtools' | 'infrastructure' | 'security'
	| 'design' | 'productivity' | 'business' | 'web' | 'media';

export const INDUSTRY_LABEL: Record<Industry, string> = {
	ai: 'AI & ML',
	data: 'Data',
	devtools: 'Developer Tools',
	infrastructure: 'Infrastructure',
	security: 'Security',
	design: 'Design',
	productivity: 'Productivity',
	business: 'Business',
	web: 'Web',
	media: 'Media',
};

/** AI is a first-class beat, so it gets its own second level. */
export type AiCategory =
	| 'inference' | 'agents' | 'training' | 'rag' | 'models' | 'tooling' | 'apps';

export const AI_CATEGORY_LABEL: Record<AiCategory, string> = {
	inference: 'Inference & Serving',
	agents: 'Agents',
	training: 'Training & Fine-tuning',
	rag: 'RAG & Vector Search',
	models: 'Model Weights',
	tooling: 'AI Tooling',
	apps: 'AI Applications',
};

interface Entry {
	industry: Industry;
	/** Proprietary products this repo is a credible open source substitute for. */
	alternativeTo?: string[];
	ai?: AiCategory;
	/** Short, factual note on the substitution. Not marketing copy. */
	note?: string;
}

/**
 * Curated repo table. Keys are lowercased "owner/name".
 *
 * `alternativeTo` is a claim we are making in public, so it belongs to repos
 * that genuinely replace the named product for a real use case - not every
 * project that overlaps with it in a bullet list.
 */
export const CURATED: Record<string, Entry> = {
	// --- AI: inference and serving ---
	'ollama/ollama': { industry: 'ai', ai: 'inference', alternativeTo: ['OpenAI API', 'Anthropic API'], note: 'Runs open-weight models locally, replacing a hosted API for local and offline work.' },
	'vllm-project/vllm': { industry: 'ai', ai: 'inference', alternativeTo: ['OpenAI API'], note: 'Self-hosted high-throughput serving for open-weight models.' },
	'ggml-org/llama.cpp': { industry: 'ai', ai: 'inference', alternativeTo: ['OpenAI API'], note: 'C/C++ inference with no Python dependency, from GGUF quantization to CPU-only laptops.' },
	'huggingface/text-generation-inference': { industry: 'ai', ai: 'inference' },
	'sgl-project/sglang': { industry: 'ai', ai: 'inference' },
	'lmstudio-ai/lms': { industry: 'ai', ai: 'inference' },

	// --- AI: agents and coding ---
	'anomalyco/opencode': { industry: 'ai', ai: 'agents', alternativeTo: ['GitHub Copilot', 'Cursor'], note: 'Terminal-native coding agent: any model provider, no editor lock-in.' },
	'aider-ai/aider': { industry: 'ai', ai: 'agents', alternativeTo: ['GitHub Copilot', 'Cursor'], note: 'Runs in the terminal against git directly - every change lands as a commit with a generated message, so undoing an AI edit is `git revert`, not a UI action.' },
	'block/goose': { industry: 'ai', ai: 'agents' },
	'browser-use/browser-use': { industry: 'ai', ai: 'agents' },
	'openinterpreter/open-interpreter': { industry: 'ai', ai: 'agents' },
	'langchain-ai/langchain': { industry: 'ai', ai: 'tooling' },
	'run-llama/llama_index': { industry: 'ai', ai: 'rag' },
	'crewaiinc/crewai': { industry: 'ai', ai: 'agents' },

	// --- AI: RAG and vector search ---
	'qdrant/qdrant': { industry: 'ai', ai: 'rag', alternativeTo: ['Pinecone'], note: 'Rust vector database that keeps payload indexes on disk, so filtered search does not require holding the whole index in memory.' },
	'weaviate/weaviate': { industry: 'ai', ai: 'rag', alternativeTo: ['Pinecone'], note: 'Go-based vector database running hybrid vector-plus-BM25 search as one query rather than merging two systems client-side.' },
	'chroma-core/chroma': { industry: 'ai', ai: 'rag', alternativeTo: ['Pinecone'], note: 'Runs embedded inside a Python process for prototyping, then the same client points at a hosted or self-run server without a code change.' },
	'milvus-io/milvus': { industry: 'ai', ai: 'rag', alternativeTo: ['Pinecone'], note: "Separates compute from storage so an index scales across a Kubernetes cluster instead of one machine's memory." },

	// --- AI: training ---
	'huggingface/transformers': { industry: 'ai', ai: 'training' },
	'pytorch/pytorch': { industry: 'ai', ai: 'training' },
	'unslothai/unsloth': { industry: 'ai', ai: 'training' },
	'axolotl-ai-cloud/axolotl': { industry: 'ai', ai: 'training' },
	'comfyanonymous/comfyui': { industry: 'ai', ai: 'apps', alternativeTo: ['Midjourney'], note: 'Node-based graph for image and video generation pipelines that runs entirely offline against locally downloaded model weights.' },
	'automatic1111/stable-diffusion-webui': { industry: 'ai', ai: 'apps', alternativeTo: ['Midjourney', 'DALL-E'], note: 'Gradio front end for Stable Diffusion with no cap on prompt length, unlike the 75-token limit in the original implementation.' },

	// --- Backend-as-a-service ---
	'supabase/supabase': { industry: 'infrastructure', alternativeTo: ['Firebase'], note: 'Postgres-backed BaaS: auth, storage, realtime and row-level security in one.' },
	'appwrite/appwrite': { industry: 'infrastructure', alternativeTo: ['Firebase'] },
	'pocketbase/pocketbase': { industry: 'infrastructure', alternativeTo: ['Firebase'] },
	'nhost/nhost': { industry: 'infrastructure', alternativeTo: ['Firebase'] },

	// --- Databases and data ---
	'duckdb/duckdb': { industry: 'data', alternativeTo: ['BigQuery', 'Snowflake'], note: 'In-process analytics: replaces a warehouse for datasets that fit on one machine.' },
	'clickhouse/clickhouse': { industry: 'data', alternativeTo: ['BigQuery', 'Snowflake'] },
	'tursodatabase/turso': { industry: 'data', alternativeTo: ['Firebase', 'PlanetScale'] },
	'pola-rs/polars': { industry: 'data', alternativeTo: ['pandas'] },
	'apache/superset': { industry: 'data', alternativeTo: ['Tableau', 'Looker'], note: 'Connects to more than 70 SQL backends through SQLAlchemy, so it sits in front of whatever warehouse already exists rather than requiring a new one.' },
	'metabase/metabase': { industry: 'data', alternativeTo: ['Tableau', 'Looker'], note: 'A visual query builder for non-SQL users sits next to a raw SQL editor, so a spreadsheet user and an analyst work off the same connection.' },
	'minio/minio': { industry: 'infrastructure', alternativeTo: ['Amazon S3'] },
	'redis/redis': { industry: 'data' },
	'meilisearch/meilisearch': { industry: 'data', alternativeTo: ['Algolia'], note: 'Rust search engine shipped as a single binary with typo tolerance on by default, so there is no relevance-tuning step before results are usable.' },
	'typesense/typesense': { industry: 'data', alternativeTo: ['Algolia'], note: 'C++ in-memory search engine that sets sort and filter parameters at query time rather than baking them into the index, trading that flexibility for RAM that scales with dataset size.' },

	// --- Analytics and observability ---
	'posthog/posthog': { industry: 'business', alternativeTo: ['Mixpanel', 'Amplitude'] },
	'plausible/analytics': { industry: 'business', alternativeTo: ['Google Analytics'], note: 'Cookieless analytics that stores no IP addresses or persistent identifiers, built to make the consent-banner question moot rather than to manage it.' },
	'umami-software/umami': { industry: 'business', alternativeTo: ['Google Analytics'], note: 'Self-hosted analytics behind a single Postgres database and one Docker container, with no cookie banner because it sets none.' },
	'grafana/grafana': { industry: 'infrastructure', alternativeTo: ['Datadog'], note: 'Ships no storage of its own - dashboards and alerts sit on top of Prometheus, Loki or whatever data source is already running.' },
	'getsentry/sentry': { industry: 'devtools', alternativeTo: ['Bugsnag', 'Rollbar'] },
	'signoz/signoz': { industry: 'infrastructure', alternativeTo: ['Datadog', 'New Relic'], note: 'OpenTelemetry-native, storing traces, metrics and logs together in ClickHouse instead of three backends stitched together after the fact.' },
	'openobserve/openobserve': { industry: 'infrastructure', alternativeTo: ['Datadog', 'New Relic'], note: 'Stores logs, metrics and traces as Parquet files on S3-compatible storage instead of a database cluster, the tradeoff behind its lower cost claim.' },
	'openpanel-dev/openpanel': { industry: 'business', alternativeTo: ['Mixpanel', 'Amplitude'], note: 'Session replay with no event cap, unlike the tiered session limits Mixpanel and Amplitude both meter on.' },
	'highlight/highlight': { industry: 'devtools', alternativeTo: ['LogRocket', 'FullStory'] },

	// --- Developer tooling ---
	'oven-sh/bun': { industry: 'devtools', alternativeTo: ['Node.js'], note: 'Runtime, bundler, test runner and package manager in one binary.' },
	'denoland/deno': { industry: 'devtools', alternativeTo: ['Node.js'] },
	'astral-sh/uv': { industry: 'devtools', alternativeTo: ['pip', 'Poetry'], note: 'Rust-based Python packaging; the speed gap over pip is the whole argument.' },
	'astral-sh/ruff': { industry: 'devtools', alternativeTo: ['Flake8', 'Black'] },
	'zed-industries/zed': { industry: 'devtools', alternativeTo: ['VS Code', 'Sublime Text'] },
	'ghostty-org/ghostty': { industry: 'devtools', alternativeTo: ['iTerm2', 'Alacritty'] },
	'microsoft/playwright': { industry: 'devtools', alternativeTo: ['Selenium', 'Cypress'] },
	'gitea/gitea': { industry: 'devtools', alternativeTo: ['GitHub', 'GitLab'] },
	'vscodium/vscodium': { industry: 'devtools', alternativeTo: ['VS Code'], note: 'The same editor Microsoft ships, rebuilt from identical source with telemetry compiled out and Open VSX in place of the Microsoft marketplace.' },
	'hoppscotch/hoppscotch': { industry: 'devtools', alternativeTo: ['Postman'], note: "Runs as a browser PWA rather than a desktop install, with a self-hosted Docker option for teams that don't want requests leaving their network." },
	'usebruno/bruno': { industry: 'devtools', alternativeTo: ['Postman', 'Insomnia'], note: 'Stores collections as plain text files on disk instead of in a cloud account, so a request collection diffs and merges in git like any other file.' },
	'coollabsio/coolify': { industry: 'infrastructure', alternativeTo: ['Heroku', 'Vercel', 'Netlify'], note: 'Self-hosted PaaS that connects to servers over SSH and deploys via Docker Compose, so the configuration lives on infrastructure you keep even if you stop running Coolify.' },
	'dokploy/dokploy': { industry: 'infrastructure', alternativeTo: ['Heroku', 'Vercel', 'Netlify'], note: "Deploys across multiple nodes via Docker Swarm rather than one server, the layer Coolify's single-host model doesn't cover." },
	'dokku/dokku': { industry: 'infrastructure', alternativeTo: ['Heroku'], note: 'Single-server Heroku workflow: git push triggers a Docker build and deploy, with none of the multi-server orchestration Coolify or Kubernetes add.' },
	'localstack/localstack': { industry: 'devtools', alternativeTo: ['AWS'] },
	'cloudflare/workerd': { industry: 'infrastructure' },
	'withastro/astro': { industry: 'web' },
	'vitejs/vite': { industry: 'devtools', alternativeTo: ['webpack'] },
	'tailwindlabs/tailwindcss': { industry: 'web' },
	'biomejs/biome': { industry: 'devtools', alternativeTo: ['ESLint', 'Prettier'] },

	// --- Design and content ---
	'penpot/penpot': { industry: 'design', alternativeTo: ['Figma'] },
	'excalidraw/excalidraw': { industry: 'design', alternativeTo: ['Miro', 'Whimsical'], note: 'Ships as an embeddable npm component as often as a standalone app, so the same hand-drawn canvas turns up inside other products, not just at excalidraw.com.' },
	// tldraw is a React SDK for building canvas apps, gated by a commercial licence past a revenue
	// threshold - not a ready-to-use whiteboard a team adopts in place of Miro. No substitution claim.
	'tldraw/tldraw': { industry: 'design' },
	'strapi/strapi': { industry: 'media', alternativeTo: ['Contentful'], note: 'Headless CMS with a visual content-type builder and auto-generated REST and GraphQL APIs over Postgres, MySQL, MariaDB or SQLite.' },
	'directus/directus': { industry: 'media', alternativeTo: ['Contentful'], note: 'Wraps an existing SQL database rather than owning the schema, generating REST and GraphQL APIs straight from whatever tables are already there.' },
	'payloadcms/payload': { industry: 'media', alternativeTo: ['Contentful', 'Sanity'], note: "Installs into an existing Next.js app's /app folder instead of running as a separate service, so the admin panel and content API share a codebase with the frontend." },

	// --- Productivity and collaboration ---
	'nextcloud/server': { industry: 'productivity', alternativeTo: ['Dropbox', 'Google Drive'] },
	'haiwen/seafile': { industry: 'productivity', alternativeTo: ['Dropbox', 'Google Drive'], note: "Splits sync into separately-shareable 'libraries' with delta-sync and resumable transfers, a different storage model from Nextcloud's single unified filesystem." },
	'toeverything/affine': { industry: 'productivity', alternativeTo: ['Notion'], note: 'Local-first workspace storing data on disk with CRDT sync, combining a document editor, whiteboard canvas and databases in one block-based interface.' },
	'outline/outline': { industry: 'productivity', alternativeTo: ['Notion', 'Confluence'], note: 'Real-time collaborative wiki storing documents as markdown over Postgres, shipped as a Docker image for self-hosting.' },
	'appflowy-io/appflowy': { industry: 'productivity', alternativeTo: ['Notion'], note: 'Rust core with a Flutter UI, so the same codebase runs desktop, mobile and web clients against a self-hosted sync server.' },
	'mattermost/mattermost': { industry: 'productivity', alternativeTo: ['Slack'], note: 'Single Go binary against a Postgres database, with enterprise features gated behind a separate licence file rather than a hosted-only tier.' },
	'rocketchat/rocket.chat': { industry: 'productivity', alternativeTo: ['Slack'], note: "Supports native federation and air-gapped deployment, aimed at the compliance-heavy customers Slack's cloud-only model doesn't reach." },
	'jitsi/jitsi-meet': { industry: 'productivity', alternativeTo: ['Zoom'] },
	'bigbluebutton/bigbluebutton': { industry: 'productivity', alternativeTo: ['Zoom'], note: "Built for the classroom rather than the meeting room: breakout rooms, a multi-user whiteboard and a learning-analytics dashboard Zoom's education tier doesn't match feature for feature." },
	'calcom/cal.com': { industry: 'business', alternativeTo: ['Calendly'] },
	'alextselegidis/easyappointments': { industry: 'business', alternativeTo: ['Calendly'], note: "A PHP/MySQL booking system with a decade of history predating Cal.com, trading its newer competitor's polish for a smaller, simpler codebase." },
	'documenso/documenso': { industry: 'business', alternativeTo: ['DocuSign'] },
	'docusealco/docuseal': { industry: 'business', alternativeTo: ['DocuSign'], note: 'PDF form-field builder with a WYSIWYG editor and multi-party signing order, self-hosted via Docker in about the time a DocuSign trial signup takes.' },
	'formbricks/formbricks': { industry: 'business', alternativeTo: ['Typeform', 'SurveyMonkey'] },
	'baptistearno/typebot.io': { industry: 'business', alternativeTo: ['Typeform'], note: 'Turns a form into a branching conversation instead of a static field list; licensed Fair Source, converting to Apache 2.0 two years after each release rather than being permissive from day one.' },
	'n8n-io/n8n': { industry: 'business', alternativeTo: ['Zapier'], note: 'Visual workflow canvas that drops into JavaScript or Python code nodes mid-workflow, licensed under Sustainable Use rather than a permissive licence.' },
	'activepieces/activepieces': { industry: 'business', alternativeTo: ['Zapier'], note: 'Integrations are TypeScript npm packages rather than a closed plugin format, so a missing connector is a pull request away instead of a support ticket.' },
	'twentyhq/twenty': { industry: 'business', alternativeTo: ['Salesforce', 'HubSpot'] },
	'salesagility/suitecrm': { industry: 'business', alternativeTo: ['Salesforce'], note: 'Started as a community fork of SugarCRM after it went closed-source, so the migration path off a Salesforce-style object model is worn in rather than theoretical.' },
	'mautic/mautic': { industry: 'business', alternativeTo: ['HubSpot', 'Mailchimp'], note: "Lead scoring, segment automation and drip campaigns cover HubSpot Marketing Hub's scope, beyond the send-a-newsletter job Mailchimp and listmonk do." },
	'chatwoot/chatwoot': { industry: 'business', alternativeTo: ['Intercom', 'Zendesk'] },
	'chaskiq/chaskiq': { industry: 'business', alternativeTo: ['Intercom'], note: 'Live chat and a support inbox with built-in video calls on a Rails-and-React stack, an Intercom-shaped feature set rather than a ticketing queue.' },
	'zammad/zammad': { industry: 'business', alternativeTo: ['Zendesk'], note: 'SLA policies and escalation rules on a Rails/Vue stack, built around the structured ticket queue rather than live chat first.' },
	'listmonk/listmonk': { industry: 'business', alternativeTo: ['Mailchimp'] },

	// --- Security ---
	'bitwarden/server': { industry: 'security', alternativeTo: ['1Password', 'LastPass'], note: 'Self-hosted backend for a client-side-encrypted vault, distributed as Docker containers with a published security-audit history.' },
	'keepassxreboot/keepassxc': { industry: 'security', alternativeTo: ['1Password'], note: 'No server or account at all - the vault is a single encrypted file you sync yourself, which also means there is no vendor to lose access to.' },
	'authelia/authelia': { industry: 'security', alternativeTo: ['Auth0', 'Okta'], note: 'Sits in front of an existing reverse proxy as a forward-auth server rather than replacing it, adding SSO and 2FA to whatever nginx, Traefik or Caddy already routes.' },
	'keycloak/keycloak': { industry: 'security', alternativeTo: ['Auth0', 'Okta'], note: 'Full OIDC and SAML identity provider with built-in user federation, maintained by Red Hat and used as the identity layer inside many other self-hosted stacks.' },
	'supertokens/supertokens-core': { industry: 'security', alternativeTo: ['Auth0'], note: 'Session verification happens inside the backend SDK without a network call to the core service, so one instance can back tens of thousands of sessions.' },
	'infisical/infisical': { industry: 'security', alternativeTo: ['HashiCorp Vault', 'Doppler'] },
	'trufflesecurity/trufflehog': { industry: 'security' },
	'aquasecurity/trivy': { industry: 'security', alternativeTo: ['Snyk'] },
};

/** Keyword fallback for anything not curated above. Order matters. */
const INDUSTRY_RULES: [Industry, RegExp][] = [
	['ai', /\b(llm|gpt|ai|agent|inference|embedding|rag|transformer|diffusion|neural|machine[- ]learning|ml|fine[- ]tun|prompt|chatbot|vector[- ]db)\b/i],
	['security', /\b(security|auth|oauth|encrypt|vulnerab|secret|password|firewall|pentest|malware|cve)\b/i],
	['data', /\b(database|sql|analytics|warehouse|etl|dataframe|query engine|olap|search engine|index)\b/i],
	['infrastructure', /\b(kubernetes|docker|container|deploy|serverless|infra|cloud|proxy|load[- ]balanc|storage|s3|cdn)\b/i],
	['design', /\b(design|figma|canvas|whiteboard|diagram|ui kit|icon|font|illustrat)\b/i],
	['productivity', /\b(notes|note[- ]taking|todo|calendar|knowledge base|wiki|chat|collaborat|meeting)\b/i],
	['business', /\b(crm|billing|invoice|payment|ecommerce|marketing|survey|automation|workflow|newsletter)\b/i],
	['media', /\b(video|audio|image|cms|content|stream|podcast|photo|music)\b/i],
	['web', /\b(react|vue|svelte|frontend|css|browser|web framework|ssr|static site)\b/i],
];

function normalize(slug: string) {
	return slug.toLowerCase();
}

export function curatedFor(slug: string): Entry | undefined {
	return CURATED[normalize(slug)];
}

/** Industry for a repo: curated first, keywords second, devtools as the floor. */
export function industryFor(slug: string, text: string): Industry {
	const curated = curatedFor(slug);
	if (curated) return curated.industry;
	for (const [industry, re] of INDUSTRY_RULES) {
		if (re.test(text)) return industry;
	}
	return 'devtools';
}

export function aiCategoryFor(slug: string, text: string): AiCategory | undefined {
	const curated = curatedFor(slug);
	if (curated?.ai) return curated.ai;
	if (industryFor(slug, text) !== 'ai') return undefined;
	if (/\b(serve|serving|inference|throughput|quantiz|runtime)\b/i.test(text)) return 'inference';
	if (/\b(agent|autonomous|tool[- ]use|browser[- ]use)\b/i.test(text)) return 'agents';
	if (/\b(train|fine[- ]tun|lora|dataset)\b/i.test(text)) return 'training';
	if (/\b(rag|retrieval|vector|embedding|semantic search)\b/i.test(text)) return 'rag';
	if (/\b(weights|checkpoint|model card|\d+b\b)\b/i.test(text)) return 'models';
	return 'tooling';
}

export function alternativesFor(slug: string): string[] {
	return curatedFor(slug)?.alternativeTo ?? [];
}

/** Every proprietary product we claim an alternative to, with its repos. */
export function alternativeIndex(): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const [slug, entry] of Object.entries(CURATED)) {
		for (const product of entry.alternativeTo ?? []) {
			const list = index.get(product) ?? [];
			list.push(slug);
			index.set(product, list);
		}
	}
	return new Map([...index.entries()].sort((a, b) => b[1].length - a[1].length));
}

/**
 * The products we claim substitutes for, and whether "open source
 * alternative to X" is a coherent thing to ask about them.
 *
 * `proprietary` is false for products that are themselves open source. A
 * substitution claim against them is still useful editorially - polars really
 * does replace pandas, uv really does replace pip - but it is a
 * like-for-like comparison, not the search a reader with a licence bill
 * types, so those products do not get their own page.
 *
 * Source-available-but-not-OSI products (Vault under BUSL, Insomnia,
 * open-core products whose hosted service is the actual competitor) count as
 * proprietary here, because that is the substitution a reader is looking for.
 */
export const PRODUCTS: Record<string, { proprietary: boolean }> = {
	'1Password': { proprietary: true },
	'AWS': { proprietary: true },
	'Alacritty': { proprietary: false },
	'Algolia': { proprietary: true },
	'Amazon S3': { proprietary: true },
	'Amplitude': { proprietary: true },
	'Anthropic API': { proprietary: true },
	'Auth0': { proprietary: true },
	'BigQuery': { proprietary: true },
	'Black': { proprietary: false },
	'Bugsnag': { proprietary: true },
	'Calendly': { proprietary: true },
	'Confluence': { proprietary: true },
	'Contentful': { proprietary: true },
	'Cursor': { proprietary: true },
	'Cypress': { proprietary: false },
	'DALL-E': { proprietary: true },
	'Datadog': { proprietary: true },
	'DocuSign': { proprietary: true },
	'Doppler': { proprietary: true },
	'Dropbox': { proprietary: true },
	'ESLint': { proprietary: false },
	'Figma': { proprietary: true },
	'Firebase': { proprietary: true },
	'Flake8': { proprietary: false },
	'FullStory': { proprietary: true },
	'GitHub': { proprietary: true },
	'GitHub Copilot': { proprietary: true },
	'GitLab': { proprietary: true },
	'Google Analytics': { proprietary: true },
	'Google Drive': { proprietary: true },
	'HashiCorp Vault': { proprietary: true },
	'Heroku': { proprietary: true },
	'HubSpot': { proprietary: true },
	'Insomnia': { proprietary: true },
	'Intercom': { proprietary: true },
	'LastPass': { proprietary: true },
	'LogRocket': { proprietary: true },
	'Looker': { proprietary: true },
	'Mailchimp': { proprietary: true },
	'Midjourney': { proprietary: true },
	'Miro': { proprietary: true },
	'Mixpanel': { proprietary: true },
	'Netlify': { proprietary: true },
	'New Relic': { proprietary: true },
	'Node.js': { proprietary: false },
	'Notion': { proprietary: true },
	'Okta': { proprietary: true },
	'OpenAI API': { proprietary: true },
	'Pinecone': { proprietary: true },
	'PlanetScale': { proprietary: true },
	'Poetry': { proprietary: false },
	'Postman': { proprietary: true },
	'Prettier': { proprietary: false },
	'Rollbar': { proprietary: true },
	'Salesforce': { proprietary: true },
	'Sanity': { proprietary: true },
	'Selenium': { proprietary: false },
	'Slack': { proprietary: true },
	'Snowflake': { proprietary: true },
	'Snyk': { proprietary: true },
	'Sublime Text': { proprietary: true },
	'SurveyMonkey': { proprietary: true },
	'Tableau': { proprietary: true },
	'Typeform': { proprietary: true },
	'VS Code': { proprietary: true },
	'Vercel': { proprietary: true },
	'Whimsical': { proprietary: true },
	'Zapier': { proprietary: true },
	'Zendesk': { proprietary: true },
	'Zoom': { proprietary: true },
	'iTerm2': { proprietary: false },
	'pandas': { proprietary: false },
	'pip': { proprietary: false },
	'webpack': { proprietary: false },
};

/**
 * Products in CURATED that PRODUCTS does not classify. Surfaced at build time
 * so adding a substitution claim without deciding whether it is proprietary
 * is noticed rather than silently defaulting.
 */
export function unclassifiedProducts(): string[] {
	const seen = new Set<string>();
	for (const entry of Object.values(CURATED)) {
		for (const product of entry.alternativeTo ?? []) {
			if (!PRODUCTS[product]) seen.add(product);
		}
	}
	return [...seen].sort();
}

export function isProprietary(product: string): boolean {
	return PRODUCTS[product]?.proprietary ?? false;
}
