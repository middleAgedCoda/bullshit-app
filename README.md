# Bullshit™ shared proxy — deploy to Render

This holds your Groq key server-side so real users get analysis with zero setup.

## Deploy steps

1. Create a **new GitHub repo** for this proxy — e.g. `bullshit-proxy` (separate from `bullshit-app`; this one is server code, not a static site).
2. Upload `server.js` and `package.json` to it.
3. In Render: **New → Web Service** → connect the `bullshit-proxy` repo.
4. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Under **Environment** → add a variable:
   - `GROQ_API_KEY` = your Groq key (the same one from console.groq.com)
   - Never put this in the code or commit it — env var only.
6. Deploy. Render gives you a URL like `https://bullshit-proxy.onrender.com`.
7. Come back and tell me that exact URL — I'll wire it into `js/llm-mesh.js` in the app (currently pointing at a placeholder `bullshit-proxy.onrender.com`, which needs to match your real one exactly).
8. Once wired, re-upload the updated `llm-mesh.js` and `index.html`/`app.js` to the `bullshit-app` repo.

## Heads up: Render free tier sleeps

Free Render services spin down after ~15 minutes of no traffic and take ~30-50 seconds to wake up on the next request. First share after a quiet period will feel slow. Options later: a paid Render instance, or a cron ping to keep it warm, or migrate to Cloudflare Workers (no cold start, generous free tier) once this proves out.

## Rate limiting

Currently: 20 analyses per IP per hour, shared across everyone hitting this instance. Since Render's free tier is a single instance, this resets whenever it restarts/sleeps — fine for prototyping, not durable. Revisit once you have real traffic.
