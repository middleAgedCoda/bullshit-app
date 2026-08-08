# Bullshit™ — Project Handoff

**Status as of this doc:** working prototype, live, installable, shared analysis working for anonymous users. Built under the Kuro Digital model.

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
          calls Groq (Llama 3.3 70B for text, Llama 3.2 11B Vision for
          images), constrained to the fixed taxonomy (§4)
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

A closed, fixed list of 14 named tactics (`js/taxonomy.js` on the client, duplicated inline in `worker.js` on the backend — **these two copies must be kept in sync manually**, there's no shared source of truth between repos yet). Both the heuristics engine and the LLM are constrained to only use these names, never invent new ones. This consistency is intentional — it's what turns "AI commentary" into a recognizable, ownable vocabulary over time (the founder's stated long-term differentiation/moat, pending a real dataset to back it — see §7).

Current taxonomy: Emotional Manipulation, Selling Disguised as Advice, Engagement Fishing, Outrage Farming, Authority Cosplay, Statistical Acrobatics, Missing Context, AI Slop, Science-ish, Crypto Energy, Trust Me Bro™, Curiosity Gap, Manufactured Urgency, Shouting.

---

## 5. File map

**`bullshit-app` repo (GitHub Pages, live site):**
```
index.html          — app shell, intake form, camera button, settings panel
share-target.html    — landing page for Android share-sheet intents, redirects into index.html
manifest.json         — PWA manifest incl. share_target registration
service-worker.js     — offline shell caching; CACHE_NAME must be bumped on any JS/CSS change
css/style.css         — forensic-receipt visual design system
js/app.js             — orchestration: UI wiring, escalation logic, receipt rendering
js/heuristics.js      — deterministic scoring engine
js/llm-mesh.js        — calls the shared Worker, falls back to user's own keys
js/taxonomy.js         — the 14-tactic closed list (client copy)
```

**Cloudflare Worker (`worker.js`, deployed via dashboard, not currently in a repo):**
```
/analyze        POST { text }  → { verdict, score, note, tricks, source }
/analyze-image  POST { image: dataURL }  → same shape, via vision model
```
Env vars/secrets on the Worker: `GROQ_API_KEY` (encrypted secret). Optional binding: `RATE_LIMIT_KV` (Workers KV namespace) — enables the per-IP rate limit (20/hour) that's already coded in; **confirm this binding was actually added**, the code silently skips limiting if it's absent.

---

## 6. Known issues / things to verify

- **Vision model name** in `worker.js` (`llama-3.2-11b-vision-preview`) should be double-checked against Groq's current model list before relying on the Camera feature — model availability/names change over time and this wasn't verified against live Groq docs at time of writing.
- **Vision model resolved:** the camera feature initially failed for a while — root cause was that `qwen/qwen3.6-27b` (Groq's current vision model) is a *thinking* model that writes hidden chain-of-thought before its answer. At default settings this reasoning consumed the entire token budget before ever writing the visible JSON, returning an empty response. Fix: request body sets `reasoning_effort: 'none'`, which puts the model in its documented non-thinking/efficient-dialogue mode. `max_tokens: 700` is sufficient once reasoning is off. If Groq changes this model's behavior again, check `finish_reason` in the error detail first — `"length"` means token/reasoning budget, not a prompt or parsing problem.
- **CORS on the Worker** is locked to `https://middleagedcoda.github.io`. If the app ever moves domains, this must be updated in `worker.js` or every request will be blocked.
- **Rate limiting** only works if the `RATE_LIMIT_KV` binding was completed in the Cloudflare dashboard (see §5). Verify this before assuming the shared key is protected.
- **iOS share-target support is untested and likely doesn't work** — Apple's PWA share_target support is historically limited/absent. Android-only for now.
- **Two copies of the taxonomy** (`js/taxonomy.js` and inline in `worker.js`) must be manually kept in sync if it's ever edited.
- **No persistence layer.** Every analysis is stateless — nothing is logged or stored anywhere. This is fine for the current prototype but blocks the "dataset companies could pay to access" ambition (§7) until deliberately built.
- File uploads to the `bullshit-app` GitHub repo have twice silently failed to actually overwrite (via "Add file → Upload files") even though the UI showed no error — the reliable method found was: tap the file directly → pencil/edit icon → select-all, replace, commit. Worth remembering for future updates.

---

## 7. Deliberately NOT built yet

- **Backend/dataset layer** — needed if the long-term plan is a "Bullshit Taxonomy" dataset product companies pay to access. This requires an actual database (Supabase free tier is a reasonable next step, pairs naturally with Cloudflare) and a decision about what's logged, anonymization, and consent/privacy posture before any company-facing product is built on top of it.
- **Personality/flavor verdicts** (🤡 Professional Yapper, etc.) — cosmetic layer on top of the existing taxonomy, low effort whenever wanted.
- **"Estimated read/share ratio" style stats** — flagged as risky: unless backed by real telemetry, this is the LLM inventing statistics, which is exactly the kind of thing Bullshit exists to catch. Don't add without real data behind it.
- **History/streak/gamification views** (Daily Bullshit Diet, etc.) — needs the persistence layer first.

---

## 8. Brand/voice notes for whoever writes copy

- Name is deliberately "Bullshit" not "TruthAI" or similar — confident but not claiming omniscience.
- Never let it become a political app — it should flag tactics "from any side" and manipulation broadly (crypto scams, health cures, ragebait, corporate PR spin, political spin from any side) rather than being perceived as partisan.
- The engine/model used should stay invisible to the end user — the receipt no longer shows "Engine: groq" for this reason. The judgment should feel like Bullshit's, not a visible AI wrapper.

## 9. The Bullshit Inspection Framework™ (BIF)

The house rule, worth protecting as the product grows: **classify before you conclude.** Bullshit never jumps straight to "this is fake" — it first asks what something *is* (opinion, marketing, satire, manipulation, advertising, AI-generated) via the taxonomy, and only then renders a verdict. This is the actual mechanism behind "Bullshit doesn't decide what's true, it decides what you're looking at," and it's why the architecture is heuristics-first with taxonomy-constrained escalation rather than "ask an AI, get an opinion."

As external positioning: *"Bullshit uses the Bullshit Inspection Framework™, a deterministic-first methodology that classifies persuasion techniques and credibility signals before selectively invoking language models for ambiguous cases."* The LLM is one interchangeable component inside the framework, not the product itself — useful framing since models will keep changing, but the framework, taxonomy, and scoring methodology are the durable IP.

**A related principle to hold the line on as monetization is ever explored:** payment must never influence a score, ever, in any form (no "sponsored" lower scores, no pay-to-improve-rating). The score is the entire product; the day it's perceived as purchasable, the brand is dead.

## 10. BS IDs (not yet built, cheap to add)

Every receipt could get a deterministic, shareable ID — e.g. `BS-2026-00019472` — generated client-side from a hash of the content + timestamp, no backend required to start. This is what makes a receipt citable/referenceable later (journalists, teachers, disputes) even before any persistence layer exists. Worth adding to `app.js`'s `renderReceipt` whenever picked up.

## 11. Anonymous event schema (design now, build later)

If/when the persistence layer from §7 gets built, the shape should be decided in advance so nobody's tempted to bolt on accounts or PII as an afterthought. Proposed shape, intentionally minimal:

```
{ receipt_id, timestamp, content_hash, taxonomy_tags[], score, verdict, language, content_length, platform (optional), anonymous_device_id }
```

No names, no emails, no raw content stored beyond what's needed for the hash/dedup. Accounts, if ever added, should unlock *extra value* (saved history, search) — never be required for the core free experience. This is a design commitment, not yet implemented.

## 12. Explicitly out of scope, flagged as a real risk

**Do not build "predicted spread," "read ratio," "share ratio," or similar forecasting numbers without real aggregated telemetry behind them.** This came up twice now (once from ChatGPT feedback, addressed in §7; reinforced again as "Cognitive Threat Intelligence" framing) and the answer is the same both times: presenting invented numbers as measured fact is precisely the failure mode Bullshit exists to catch in *other* content. This isn't "later" — it's a standing guardrail, revisit only once there's real scale data to back it, and even then be transparent about methodology.
