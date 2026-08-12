# Bullshit™ — Project Handoff

**Status as of this doc:** stable, working PWA, ready for a small private beta (Phase 0 — see §18). Live, installable, share-target working on Android, camera analysis working, shareable receipt images working, shared analysis working for anonymous users with no key required, local history working, feedback and privacy channels in place. All major bugs from the initial build-out are resolved (see §6). Built under the Kuro Digital model.

**Live app:** https://middleagedcoda.github.io/bullshit-app/
**Shared analysis backend:** Cloudflare Worker at `https://polished-fire-59b0.brentonchimzy2802.workers.dev`

---

## 1. What this is

Bullshit™ is a PWA that analyzes a piece of text (or, as of this update, a photo) and tells you what tactics it's using — clickbait, emotional manipulation, manufactured urgency, missing context, etc — rather than declaring it objectively "true" or "false." That framing is deliberate and load-bearing: it's what keeps the product out of "Ministry of Truth" territory and defensible against bias accusations.

Core UX metaphor: every analysis produces a **Receipt** — styled like a torn thermal-printer receipt — with a BS Score (0–100), a verdict stamp (CLEAN / CAUTION / BULLSHIT / OPINION), and a list of specific tactics detected, each pulled from a fixed taxonomy (see §4).

---

## 2. Constraints that shaped every technical decision

- **Owner works entirely from a phone**, using the Acode app to edit files, uploading to GitHub via the mobile web UI. No local dev environment, no CLI, no `git push` from a terminal.
- This ruled out anything requiring `npm run build`, a bundler, or a CLI-based deploy step. Everything is deployed either via GitHub Pages (static) or pasted directly into Cloudflare's in-browser Worker editor (no repo needed for the backend).
- **Cost must stay near zero.** No paid infrastructure by default. This is why the architecture is heuristics-first with LLM calls only on escalation (see §3).

---

## 3. Architecture

```
User pastes text / shares from another app / takes a photo
                    │
                    ▼
        js/heuristics.js  (runs on EVERY request, free, instant)
        - regex/keyword scoring: clickbait phrases, emotional words,
          urgency words, selling language, evidence markers, caps abuse,
          a small seed list of known-good/known-bad domains
        - outputs a 0-100 score + a confidence level (low/medium/high)
                    │
                    ▼
        Escalation gate (js/app.js: shouldEscalate)
        - only calls an LLM if heuristic confidence isn't "high",
          or the content reads as opinion
        - most obviously-clickbait or obviously-clean content NEVER
          triggers an LLM call — this is what keeps API cost near zero
                    │
                    ▼ (only when escalating)
        js/llm-mesh.js → Cloudflare Worker (worker.js)
        - client calls the Worker's /analyze (text) or /analyze-image
          (photo) endpoint — no API key needed from the user
        - Worker holds the Groq key server-side as an encrypted secret,
          calls Groq (openai/gpt-oss-120b for text, qwen/qwen3.6-27b
          for images — both reasoning-capable models, see §6 for the
          token-budget gotcha this caused), constrained to the fixed
          taxonomy (§4)
        - if the shared Worker fails or a user added their OWN Groq/
          OpenRouter key in Settings, falls back to calling those
          providers directly from the browser
                    │
                    ▼
        js/app.js renders the result into the Receipt UI
```

### Why heuristics-first
Every other misinformation-detection product defaults to "AI on everything." This one only spends an LLM call when the cheap deterministic layer genuinely can't tell. That's the core cost-control decision and should NOT be casually removed — it's why this can run indefinitely on free tiers.

### Why a server-side proxy at all
The Groq key cannot live in client-side JS on GitHub Pages (anyone could view-source and steal it, or drain your quota). The Worker exists purely to hold that secret server-side. This was originally attempted on Render, which turned out to require a paid plan on this account (their free web-service tier has tightened/become inconsistent in 2026) — pivoted to **Cloudflare Workers** instead: genuinely free, no cold-start (unlike Render's 15-min sleep + ~30-60s wake), and can be edited entirely from the Cloudflare dashboard on mobile, no git repo required.

There is an orphaned `bullshit-proxy` GitHub repo containing the original Render-targeted `server.js`/`package.json` — **this is dead code, not in use.** Safe to delete or ignore. The live backend is the Cloudflare Worker, whose source lives in `bullshit-proxy/worker.js` locally (not currently pushed anywhere as a repo — it was pasted directly into Cloudflare's editor). **TODO for next dev: put `worker.js` in a repo somewhere for version history, even though Cloudflare doesn't require it to deploy.**

---

## 4. The Bullshit Taxonomy™

A closed, fixed list of 14 named tactics (`js/taxonomy.js` on the client, duplicated inline in `worker.js` on the backend — **these two copies must be kept in sync manually**, there's no shared source of truth between repos yet). Both the heuristics engine and the LLM are constrained to only use these names, never invent new ones. This consistency is intentional — it's what turns "AI commentary" into a recognizable, ownable vocabulary over time (the founder's stated long-term differentiation/moat, pending a real dataset to back it — see §8).

Current taxonomy: Emotional Manipulation, Selling Disguised as Advice, Engagement Fishing, Outrage Farming, Authority Cosplay, Statistical Acrobatics, Missing Context, AI Slop, Science-ish, Crypto Energy, Trust Me Bro™, Curiosity Gap, Manufactured Urgency, Shouting.

Each tactic also has a custom SVG icon (not emoji) for cross-device visual consistency — defined inline in `index.html`'s hidden sprite `<defs>` block, referenced by id in `js/taxonomy.js`. Emoji were deliberately replaced because they render differently across OSes/fonts; the custom sprite renders identically everywhere. Note: the shared/exported receipt image does *not* use these icons — see §6 for why.

---

## 5. File map

**`bullshit-app` repo (GitHub Pages, live site):**
```
index.html          — app shell, intake form, camera button, settings panel,
                       inlined icon sprite (see §6), Open Graph/share meta tags
share-target.html    — landing page for Android share-sheet intents, redirects into index.html
manifest.json         — PWA manifest incl. share_target registration
service-worker.js     — offline shell caching; CACHE_NAME must be bumped on any JS/CSS change
css/style.css         — forensic-receipt visual design system, responsive/fluid sizing
js/app.js             — orchestration: UI wiring, escalation logic, receipt rendering,
                         BS ID generation, shareable-image capture logic
js/heuristics.js      — deterministic scoring engine
js/llm-mesh.js        — calls the shared Worker, falls back to user's own keys
js/taxonomy.js         — the 14-tactic closed list (client copy) incl. icon id mapping
js/history.js         — IndexedDB wrapper for local receipt history
HANDOFF.md             — this file
```

**Cloudflare Worker (`worker.js`, deployed via dashboard, not currently in a repo):**
```
/analyze        POST { text }  → { verdict, score, note, tricks, source }
/analyze-image  POST { image: dataURL }  → same shape, via vision model
```
Env vars/secrets on the Worker: `GROQ_API_KEY` (encrypted secret). Optional binding: `RATE_LIMIT_KV` (Workers KV namespace) — this **is** bound and confirmed working. Current limit: 200 requests/IP/hour (raised 20→60→200 across testing and pre-beta hardening; see §17 for why 200 specifically).

---

## 6. Bugs hit and resolved during build-out (keep this — the lessons are durable)

**Reasoning models silently returning empty responses.** Both Groq models used here (`qwen/qwen3.6-27b` for vision, `openai/gpt-oss-120b` for text) are *reasoning* models — they think before answering, and that thinking consumes the same `max_tokens` budget as the visible answer. At the original `max_tokens: 400`, both models burned the entire budget on hidden reasoning and returned empty `content`, which surfaced as a confusing generic failure ("Deeper analysis is temporarily unavailable") with no indication of the real cause. Fixes differ per model:
- Qwen 3.6 supports `reasoning_effort: 'none'` — genuinely disables thinking. Used for the vision path, `max_tokens: 700`.
- `gpt-oss-120b` does **not** support `'none'` — only `low`/`medium`/`high` — and per Groq's docs, its reasoning goes into a separate `reasoning` field, not mixed into `content`. Still consumes the shared token budget though. Fix: `reasoning_effort: 'low'` + `max_tokens: 1200`.
- **If this recurs with a future model swap:** check `finish_reason` in the response first. `"length"` means token/reasoning budget, not a prompt or parsing bug. Both endpoints now throw a specific `empty_response — finish_reason: X` error when content comes back empty, so this is diagnosable immediately rather than requiring another multi-round debugging chain.

**Groq's own rate limiting looked identical to our rate limiting.** Groq's free-tier per-key RPM/TPM limit and our own Worker-side 60/hour KV limit both produce a "too many requests" style failure, but they need different user-facing advice (wait an hour vs. just retry in a few seconds). The Worker now detects a 429 specifically *from Groq* and forwards it as our own 429 with distinct wording ("briefly overloaded... try again in a few seconds"), separate from the KV limiter's message. The client (`js/app.js`) pattern-matches on the message text to show the right one.

**html2canvas cannot reliably render inline SVG.** The share-receipt image repeatedly lost all icons and the entire verdict stamp despite the on-screen version rendering fine. Root causes, in order of how they were found: (1) `<use>` references to a `<symbol>`, even inline in the same document, frequently fail — fixed by embedding real `<path>` data instead; (2) `<details>/<summary>` gets rendered with unwanted browser-default numbering — fixed by using plain `<div>`s for the capture-only markup; (3) an `opacity:0` CSS entrance animation on the stamp gets captured mid-animation (its starting frame) since html2canvas doesn't run animation timelines — fixed by forcing `opacity:1; animation:none` inline on the capture copy; (4) even after all of that, the stamp was *still* invisible — turned out html2canvas's inline SVG support is just fundamentally unreliable for this use case. **Final fix: the capture-only receipt markup (`buildCaptureHtml` in `app.js`) contains zero `<svg>` elements at all** — a plain colored bullet character stands in for icons. The interactive on-screen receipt keeps its real SVG icons and animations; only the exported image avoids SVG entirely. If icons are ever wanted in the shared image again, don't retry `<use>` or inline `<svg>` — render the icon to a `<canvas>`/PNG first and use an `<img>` tag instead, which html2canvas handles natively.

**GitHub's mobile "Add file → Upload files" silently fails to overwrite.** Happened at least three times — once appending a full second copy of a file instead of replacing it (causing duplicate top-level `const`/`function` declarations that likely broke the entire module and killed every button on the page), other times just not taking at all. **The reliable method, every time: tap the file directly → pencil/edit icon → select-all in the editor → delete → paste new content → commit.** Never use the upload-files flow for an existing file.

**Camera "low memory" warnings.** Raw phone camera photos (12MP+, 3-5MB) were being fully decoded into memory by the old `Image`-element approach just to immediately downscale them. Fixed by using `createImageBitmap` with `resizeWidth`/`resizeHeight` options, which lets the browser decode directly at target size (1024px wide, JPEG quality 0.75) without ever allocating the full original.

## 7. Other things to know

- **CORS on the Worker** is locked to `https://middleagedcoda.github.io`. If the app ever moves domains, this must be updated in `worker.js` or every request will be blocked.
- **iOS share-target support is untested and likely doesn't work** — Apple's PWA share_target support is historically limited/absent. Android-only for now.
- **Two copies of the taxonomy** (`js/taxonomy.js` and inline in `worker.js`) must be manually kept in sync if it's ever edited. `js/taxonomy.js` additionally carries the `icon` id mapping the backend copy doesn't need.
- **No persistence layer.** Every analysis is stateless — nothing is logged or stored anywhere. This is fine for the current state but blocks the "dataset companies could pay to access" ambition (§8) until deliberately built.
- **Orphaned `bullshit-proxy` GitHub repo** contains the original Render-targeted `server.js`/`package.json` (dead code) alongside the real `worker.js` and `wrangler.jsonc`. **Git-based auto-deploy (Cloudflare's "Workers Builds") is NOT yet working** — attempted from a mobile browser, but the GitHub↔Cloudflare OAuth handoff kept looping back to the install screen instead of completing the connection. Parked for now; the plan is to retry from an actual desktop browser, where this kind of OAuth redirect is generally far more reliable. **Until that's connected, deploys are still manual paste-into-Cloudflare's-editor** — see §6 for why that's error-prone, and always verify a deploy actually landed via the `WORKER_VERSION` canary (§17) rather than trusting the editor's UI.
- **Real-time error alerting is code-complete but not yet activated.** `notifyError()` in `worker.js` pushes to ntfy.sh on genuine failures (excludes routine rate-limit responses), but this only does anything once an `NTFY_TOPIC` env var is set and the ntfy app is installed/subscribed on a phone. As of this doc, that setup step hasn't been done yet — full instructions are in `bullshit-proxy/README.md`.

---

## 8. Deliberately NOT built yet

- **Backend/dataset layer** — needed if the long-term plan is a "Bullshit Taxonomy" dataset product companies pay to access. This requires an actual database (Supabase free tier is a reasonable next step, pairs naturally with Cloudflare) and a decision about what's logged, anonymization, and consent/privacy posture before any company-facing product is built on top of it.
- **Personality/flavor verdicts** (🤡 Professional Yapper, etc.) — cosmetic layer on top of the existing taxonomy, low effort whenever wanted.
- **"Estimated read/share ratio" style stats** — flagged as risky: unless backed by real telemetry, this is the LLM inventing statistics, which is exactly the kind of thing Bullshit exists to catch. Don't add without real data behind it.
- **History/streak/gamification views** (Daily Bullshit Diet, etc.) — local per-device history is now implemented (§14); a *synced-across-devices* version still needs the account/persistence layer above. Streak/gamification cosmetic layers not started.

---

## 9. Brand/voice notes for whoever writes copy

- Name is deliberately "Bullshit" not "TruthAI" or similar — confident but not claiming omniscience.
- Never let it become a political app — it should flag tactics "from any side" and manipulation broadly (crypto scams, health cures, ragebait, corporate PR spin, political spin from any side) rather than being perceived as partisan.
- The engine/model used should stay invisible to the end user — the receipt no longer shows "Engine: groq" for this reason. The judgment should feel like Bullshit's, not a visible AI wrapper.

## 10. The Bullshit Inspection Framework™ (BIF)

The house rule, worth protecting as the product grows: **classify before you conclude.** Bullshit never jumps straight to "this is fake" — it first asks what something *is* (opinion, marketing, satire, manipulation, advertising, AI-generated) via the taxonomy, and only then renders a verdict. This is the actual mechanism behind "Bullshit doesn't decide what's true, it decides what you're looking at," and it's why the architecture is heuristics-first with taxonomy-constrained escalation rather than "ask an AI, get an opinion."

As external positioning: *"Bullshit uses the Bullshit Inspection Framework™, a deterministic-first methodology that classifies persuasion techniques and credibility signals before selectively invoking language models for ambiguous cases."* The LLM is one interchangeable component inside the framework, not the product itself — useful framing since models will keep changing, but the framework, taxonomy, and scoring methodology are the durable IP.

**A related principle to hold the line on as monetization is ever explored:** payment must never influence a score, ever, in any form (no "sponsored" lower scores, no pay-to-improve-rating). The score is the entire product; the day it's perceived as purchasable, the brand is dead.

## 11. BS IDs (implemented)

Every receipt shows a deterministic, shareable ID — `BS-2026-XXXXXXXX` — generated client-side (`generateBsId` in `app.js`) from a hash of the result content + a coarse timestamp, no backend required. Not cryptographic, just citable/referenceable. Working today; only becomes more valuable once a persistence layer exists to actually look receipts up by ID.

## 12. Anonymous event schema (design now, build later)

If/when the persistence layer from §8 gets built, the shape should be decided in advance so nobody's tempted to bolt on accounts or PII as an afterthought. Proposed shape, intentionally minimal:

```
{ receipt_id, timestamp, content_hash, taxonomy_tags[], score, verdict, language, content_length, platform (optional), anonymous_device_id }
```

No names, no emails, no raw content stored beyond what's needed for the hash/dedup. Accounts, if ever added, should unlock *extra value* (saved history, search) — never be required for the core free experience. This is a design commitment, not yet implemented.

## 13. Explicitly out of scope, flagged as a real risk

**Do not build "predicted spread," "read ratio," "share ratio," or similar forecasting numbers without real aggregated telemetry behind them.** This came up twice now (once from ChatGPT feedback, addressed in §8; reinforced again as "Cognitive Threat Intelligence" framing) and the answer is the same both times: presenting invented numbers as measured fact is precisely the failure mode Bullshit exists to catch in *other* content. This isn't "later" — it's a standing guardrail, revisit only once there's real scale data to back it, and even then be transparent about methodology.

## 14. Local history (implemented)

`js/history.js` wraps IndexedDB to save every real analysis (text or image) on-device — score, verdict, note, tricks, a short preview of the input, timestamp. No backend, works offline, nothing is sent anywhere. Accessible via a **History** icon in the header (opens the same overlay-panel pattern as Settings), showing newest-first, tap to reopen a past receipt, swipe-delete or clear all.

This is deliberately built as the local half of the anonymous event schema from §12 — when accounts eventually exist, this IndexedDB store is exactly what gets migrated up to the account on first sign-in, so nobody loses history by creating one. Each receipt's BS ID (§11) is generated once and stored permanently on the entry (`r.id`), so reopening an old receipt from history always shows the same ID it originally displayed — `generateBsId()` is only used as a fallback for brand-new receipts, never recomputed for stored ones (recomputing could drift if reopened on a different day, since the hash includes a date component).

## 15. Feedback & Privacy (implemented)

Both live inside the Settings panel:
- **"📩 Send feedback"** — a `mailto:` link to `kurodigitalarchitects@gmail.com` with a pre-filled subject/body, so reporting a bug is one tap from any screen in the app. This exists because every single bug found during development was found by the founder manually screenshotting something broken — real beta users won't do that unprompted unless it's this easy.
- **"🔒 Privacy & Data"** — opens a dedicated overlay panel (same pattern as Settings/History) with five expandable sections: what gets sent off-device and to whom (names Groq/OpenRouter explicitly), what's *not* collected (no accounts, no ad tracking, no analytics), how local history works, how IP-based rate limiting works (stored max 1 hour, then auto-deleted), and contact info. Written in plain language, not legalese — the standard applied is "would this survive Bullshit analyzing itself," which is a real test worth reapplying if this copy is ever revised.

## 16. Visual identity v2

Palette changed from the original "Forensic Paper" (charcoal/cream/bright-red/amber) to a deliberate blend of two alternative directions that were mocked up and compared side-by-side (see `palette-preview.html` if it still exists locally — not part of the deployed app):
- **Ink-navy background** (`#10151A`) instead of warm charcoal — cooler, more institutional.
- **Burgundy stamp/accent** (`#8B3A3A`) instead of bright red — reads as premium ink rather than alarm-red.
- **Muted gold** (`#C79143`) instead of bright amber.
- **Warm parchment paper** (`#EAE0C8`) — kept warm even though the background went cooler, deliberately blending the two source directions rather than picking one wholesale.

App icon also regenerated in this palette (same ring+"BS" concept as before — five alternative logo directions were sketched and compared, including a receipt-scroll shape and a magnifying-glass concept, but the recolored original ring won out as the strongest option: already proven, already recognizable).

**Polish layer added on top of the repaint:** the Settings panel was restructured from an inline dropdown (which visually blended into the page behind it) into a true overlay — dim scrim, blur backdrop, slide animation, tap-outside-to-close. Buttons got tactile tap feedback (a light diagonal shimmer sweep + press-depth, evoking "touching glass" without making the flat print-style surfaces literally translucent, which would have fought the receipt aesthetic). Icons get a small pop/twist on tap; the camera icon specifically also gets a rare, brief idle nudge (~every 6s) as a quiet invitation to tap it. The wordmark has a very faint persistent breathing glow. The Kuro Digital footer badge — treated deliberately as prime real estate, since it's the app's actual lead-gen surface — got real glass treatment (frosted blur, bright top-edge rim highlight) plus a persistent light-sweep animation.

**Also added:** an "Upload a screenshot" button alongside the camera button. The camera button's `capture="environment"` attribute forces Android straight into the live camera, skipping the gallery — so a second file input *without* that attribute was added specifically so people can analyze a screenshot they already took (e.g. of a Facebook/Instagram post) without needing to physically point the camera at their own screen.

## 17. Operational hardening (in progress — pre-beta)

Prompted by an honest self-audit before any public sharing. Status of each:

- **Rate limit raised 20→60→200/hour per IP.** Important nuance worth remembering: this is *per IP address*, not one shared pool — but carrier-grade NAT (common on African mobile networks) means genuinely different real users can share a public IP, so "per IP" can still functionally mean "per group of strangers on one carrier." That's why it's set generously rather than tightly, and why it may need raising further once there's real traffic data.
- **Error alerting: code-complete, not yet activated.** See §7 — needs `NTFY_TOPIC` set and the ntfy app installed to actually start pushing notifications. This is the next immediate step.
- **Git-based auto-deploy: attempted, blocked, parked.** See §7 — retry from desktop.
- **`WORKER_VERSION` canary marker** added to `worker.js` — visiting the Worker's root URL shows `Bullshit™ proxy is running. (vX)`. Bump this constant with any meaningful change; it's the fastest way to confirm a deploy (manual or eventually Git-based) actually landed, without digging through dashboard tabs.
- **Not yet done:** automated tests, a staging environment, iOS testing (no iOS device available to the founder — untested, share-target is known to not work on iOS/Safari, but paste/camera/upload should still function via plain browser inputs).

## 18. Public rollout plan

Sequenced deliberately to control the volume and visibility of whatever breaks, since every bug so far has been found by manual testing rather than any monitoring system (partially addressed by §17, not fully yet):

- **Phase 0 — private beta (current target).** Share directly (WhatsApp/DM, not public posts) with ~10-20 people personally known to the founder. Goal: surface real-device/real-stranger confusion and bugs at a volume the rate limit and founder's attention can actually absorb.
- **Phase 1 — soft public push.** Once Phase 0 runs clean for a few days: one modest, lower-traffic public post (relevant subreddit, LinkedIn to existing network) — not a big blast. Watch how the rate limit and Groq's own quota hold up under real strangers.
- **Phase 2 — real social push.** Once Phase 1 holds up. The camera feature ("point your phone at a suspicious post, get an instant verdict") is genuinely strong short-form video material (TikTok/Reels) — this is the natural point to go wide.

**Checklist before starting Phase 0:** rate limit reviewed (done, §17) · feedback link live (done, §15) · privacy panel live (done, §15) · ntfy alerting actually activated (pending) · one full clean-install test pass across text/camera/upload/share right before sharing.
