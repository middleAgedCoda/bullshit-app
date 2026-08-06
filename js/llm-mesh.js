// llm-mesh.js
// Called ONLY when heuristics.js reports low/medium confidence. Tries
// each configured provider in order until one succeeds. All of these
// have free tiers and run open-weight models, so cost stays near zero
// as long as escalation is rare (which the heuristics layer enforces).
//
// API keys are entered by the user in Settings and stored in
// localStorage only — never hardcoded, never sent anywhere but the
// provider's own endpoint.

const SYSTEM_PROMPT = `You are the analysis engine for Bullshit™, a tool that helps people
see the tactics used in a piece of text — NOT a tool that rules on objective truth.
You judge tactics: manipulation, missing evidence, framing, selling intent, fallacies.
You do not declare political or contested claims true/false; you flag them as opinion
or contested and explain what's missing.
Respond with STRICT JSON only, no markdown fences, no preamble, matching this shape:
{
  "verdict": "bullshit" | "clean" | "opinion" | "caution",
  "score": 0-100,
  "note": "one sentence, plain language, in Bullshit's voice — direct, not preachy",
  "tricks": [{"name": "short trick name", "explain": "one sentence explaining the tactic generically"}]
}`;

function getKeys(){
  try{
    return JSON.parse(localStorage.getItem('bs_api_keys') || '{}');
  }catch(e){ return {}; }
}

export function saveKeys(keys){
  localStorage.setItem('bs_api_keys', JSON.stringify(keys));
}

export function hasAnyKey(){
  const k = getKeys();
  return !!(k.groq || k.openrouter || k.hf);
}

async function callGroq(text, key){
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    })
  });
  if(!res.ok) throw new Error('groq_failed_' + res.status);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callOpenRouter(text, key){
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ]
    })
  });
  if(!res.ok) throw new Error('openrouter_failed_' + res.status);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callHuggingFace(text, key){
  const res = await fetch('https://api-inference.huggingface.co/models/meta-llama/Llama-3.1-8B-Instruct', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      inputs: `${SYSTEM_PROMPT}\n\nText to analyze:\n${text}`,
      parameters: { max_new_tokens: 400, temperature: 0.2, return_full_text: false }
    })
  });
  if(!res.ok) throw new Error('hf_failed_' + res.status);
  const data = await res.json();
  return Array.isArray(data) ? data[0].generated_text : data.generated_text;
}

function extractJSON(raw){
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if(start === -1 || end === -1) throw new Error('no_json_found');
  return JSON.parse(raw.slice(start, end + 1));
}

// Order = priority. Groq first: fastest free tier, strong open model,
// generous rate limits. Falls through if a key is missing or a call fails.
const PROVIDERS = [
  { name: 'groq', call: callGroq, keyName: 'groq' },
  { name: 'openrouter', call: callOpenRouter, keyName: 'openrouter' },
  { name: 'huggingface', call: callHuggingFace, keyName: 'hf' }
];

export async function analyzeWithMesh(text){
  const keys = getKeys();
  let lastError = null;

  for(const provider of PROVIDERS){
    const key = keys[provider.keyName];
    if(!key) continue;
    try{
      const raw = await provider.call(text, key);
      const parsed = extractJSON(raw);
      return { ...parsed, source: provider.name };
    }catch(err){
      lastError = err;
      continue; // try next provider in the mesh
    }
  }

  throw new Error(lastError ? lastError.message : 'no_provider_configured');
}
