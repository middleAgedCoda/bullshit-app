# Bullshit™ shared proxy — deploy to Cloudflare Workers

This holds your Groq key server-side so real users get analysis with zero setup — nobody needs their own API key. Deployed entirely from Cloudflare's mobile dashboard, no git repo or CLI required.

> **Note:** an earlier version of this doc described deploying to Render. That path was abandoned — Render's free web-service tier turned out to require a paid plan on this account, and even where available, Render's free tier sleeps after ~15 min of inactivity with a 30-50s cold-start on the next request. Cloudflare Workers has no cold start and a genuinely free tier (100k requests/day, no card required), so the proxy lives there instead.
>
> **Deployment has also since moved from manual paste-into-editor to Git-based auto-deploy** (see "Auto-deploy from GitHub" below) — this is now the recommended path, since it eliminates the "did the deploy actually take?" failures that came up repeatedly during manual deploys. The steps below describe the very first one-time Worker creation; after that, routine changes go through GitHub instead.

## Deploy steps

1. Go to `dash.cloudflare.com` → sign up free (email + password, no card needed).
2. **Workers & Pages → Create → Create Worker.**
3. Give it a name → **Deploy** (this deploys a placeholder first, that's fine).
4. Tap **Edit code** (sometimes labeled **Quick Edit**) — this opens Cloudflare's in-browser code editor.
5. Select all the placeholder code, delete it, paste in the full contents of `worker.js`.
6. Tap **Deploy** (not "Save version" — that doesn't go live).
7. Go to the Worker's **Settings → Variables and Secrets** → **Add**:
   - Name: `GROQ_API_KEY`, Value: your Groq key (from console.groq.com)
   - **Type must be set to "Secret"**, not "Text" — this encrypts it. Never put this in the code.
8. Deploy again after saving the variable.
9. Your Worker's URL (e.g. `https://your-worker-name.your-subdomain.workers.dev`) is visible on the Worker's Overview page. This must exactly match the `PROXY_URL` constant in `js/llm-mesh.js` in the `bullshit-app` repo.

## Rate limiting (Workers KV)

The code checks for a `RATE_LIMIT_KV` binding and silently skips limiting if it's not set up — but it **is** currently bound and working. To set up (or verify) it:

1. **Workers & Pages → KV** (may be under "Storage & Databases") → **Create a namespace**.
2. On the Worker → **Settings → Bindings → Add binding → KV Namespace**.
3. Variable name must be exactly `RATE_LIMIT_KV`, bound to that namespace.

Current limit: **200 analyses per IP per hour** (raised for public beta from 20→60→200 during testing/soft-launch phases). Important nuance: this is *per IP address*, not a single shared pool — but on many African mobile networks, carrier-grade NAT means genuinely different users can share the same public IP, so "per IP" can still mean "per group of strangers on the same carrier." That's part of why this is set generously rather than tightly. Also protects against Groq's own quota being drained by one abusive visitor.

## Auto-deploy from GitHub (replaces manual paste-and-deploy)

Cloudflare's own Git integration ("Workers Builds") connects this Worker directly to a GitHub repo — every push to `main` auto-builds and deploys, no more pasting code into the dashboard editor. This is what eliminates the "did it actually deploy?" guessing game.

**One-time setup:**
1. Create a GitHub repo (or reuse this one, `bullshit-proxy`) containing `worker.js` and `wrangler.jsonc`.
2. In Cloudflare dashboard → your Worker → **Settings → Builds → Connect**.
3. Authorize GitHub, select this repo, production branch = `main`.
4. Push a commit — Cloudflare auto-builds and deploys within seconds, and shows a check mark/status directly on the GitHub commit.

**From then on:** edit `worker.js` on GitHub the normal way (tap file → pencil → edit → commit) — no more visiting Cloudflare's editor at all for routine changes. Every commit is now a permanent, inspectable version, and every deploy is guaranteed to match what's actually in the file, since a machine does it instead of a manual copy-paste.

## Real-time error alerts

Every `catch` block in `worker.js` now calls `notifyError()`, which pushes a phone notification via [ntfy.sh](https://ntfy.sh) — free, no signup, no API key — whenever something genuinely breaks (not routine rate limits, those are excluded on purpose).

**Setup (2 minutes):**
1. Install the **ntfy** app (Android/iOS, free) from your app store.
2. In the app, subscribe to a topic name of your choosing — treat it like a password, e.g. `bullshit-alerts-x7k2m` (anyone who knows the exact topic name can see your alerts, so don't use something guessable).
3. On the Worker → **Settings → Variables and Secrets** → add `NTFY_TOPIC` = that same topic name (plain text is fine, it's not truly sensitive, but Secret works too).
4. Deploy. From now on, any real server-side failure pushes straight to your phone within seconds — this replaces "notice a broken receipt, screenshot it, describe it" with an immediate, specific alert.

If `NTFY_TOPIC` isn't set, alerting is simply skipped — never blocks or slows down the actual response to a user.

## Two kinds of "rate limited" — don't confuse them

The Worker distinguishes between hitting *our own* 200/hour per-IP KV limit and hitting *Groq's own* per-key rate limit (a separate thing, on Groq's side, that can happen well before our limit if there's a burst of traffic). Both return an HTTP 429, but with different message text, so the client can show the right advice ("wait an hour" vs. "try again in a few seconds"). If you ever see requests failing in a way that looks like rate limiting but isn't matching either message, check the Worker's **Metrics** tab — specifically the subrequest panel for `api.groq.com` — to see the actual pass/fail split against Groq directly.

## Endpoints

```
POST /analyze        { text }              → { verdict, score, note, tricks, source }
POST /analyze-image   { image: dataURL }     → same shape, via a vision-capable model
```

Both are constrained to the same closed taxonomy (`js/taxonomy.js` on the client, duplicated inline in `worker.js` — keep these two in sync manually if the taxonomy ever changes).

## Models currently in use

- **Text:** `openai/gpt-oss-120b`, with `reasoning_effort: 'low'` and `max_tokens: 1200`.
- **Vision:** `qwen/qwen3.6-27b`, with `reasoning_effort: 'none'` and `max_tokens: 700`.

Both are reasoning-capable models whose hidden "thinking" consumes the same token budget as the visible answer — at lower token budgets both returned empty responses. If either model is ever swapped out, check the new model's docs for how to minimize/disable reasoning before assuming a plain higher `max_tokens` will fix any similar issue; the two models here needed different parameters for the same underlying problem. See `HANDOFF.md` §6 for the full story.
