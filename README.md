# Bullshit™ shared proxy — deploy to Cloudflare Workers

This holds your Groq key server-side so real users get analysis with zero setup — nobody needs their own API key. Deployed entirely from Cloudflare's mobile dashboard, no git repo or CLI required.

> **Note:** an earlier version of this doc described deploying to Render. That path was abandoned — Render's free web-service tier turned out to require a paid plan on this account, and even where available, Render's free tier sleeps after ~15 min of inactivity with a 30-50s cold-start on the next request. Cloudflare Workers has no cold start and a genuinely free tier (100k requests/day, no card required), so the proxy lives there instead. The `bullshit-proxy` GitHub repo (if you still have it) contains only the old Render-targeted `server.js`/`package.json` — that's dead code, safe to ignore or delete. `worker.js` is the live code, currently version-controlled only informally (pasted directly into Cloudflare's editor).

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

Current limit: 60 analyses per IP per hour, shared across everyone hitting this Worker (raised from an initial 20, which was too tight even for solo testing). This also protects against Groq's own quota being drained by one abusive visitor.

## Two kinds of "rate limited" — don't confuse them

The Worker distinguishes between hitting *our own* 60/hour KV limit and hitting *Groq's own* per-key rate limit (a separate thing, on Groq's side, that can happen well before our limit if there's a burst of traffic). Both return an HTTP 429, but with different message text, so the client can show the right advice ("wait an hour" vs. "try again in a few seconds"). If you ever see requests failing in a way that looks like rate limiting but isn't matching either message, check the Worker's **Metrics** tab — specifically the subrequest panel for `api.groq.com` — to see the actual pass/fail split against Groq directly.

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
