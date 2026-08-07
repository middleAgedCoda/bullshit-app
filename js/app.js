import { scoreContent } from './heuristics.js';
import { analyzeWithMesh, saveKeys, hasAnyKey } from './llm-mesh.js';

const $ = (id) => document.getElementById(id);

const inputField = $('inputField');
const analyzeBtn = $('analyzeBtn');
const againBtn = $('againBtn');
const intake = $('intake');
const loading = $('loading');
const receiptWrap = $('receiptWrap');
const receiptEl = $('receipt');

const settingsToggle = $('settingsToggle');
const settingsPanel = $('settingsPanel');
const saveKeysBtn = $('saveKeysBtn');
const groqKeyInput = $('groqKey');
const orKeyInput = $('orKey');

// ---- Settings ----
settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
saveKeysBtn.addEventListener('click', () => {
  saveKeys({ groq: groqKeyInput.value.trim(), openrouter: orKeyInput.value.trim() });
  settingsPanel.classList.add('hidden');
});

// ---- Run analysis ----
analyzeBtn.addEventListener('click', () => runAnalysis(inputField.value));
againBtn.addEventListener('click', () => {
  receiptWrap.classList.add('hidden');
  intake.classList.remove('hidden');
  inputField.value = '';
  inputField.focus();
});

async function runAnalysis(raw){
  const text = (raw || '').trim();
  if(!text) return;

  intake.classList.add('hidden');
  loading.classList.remove('hidden');
  receiptWrap.classList.add('hidden');

  const heuristic = scoreContent(text);
  let final;

  // Escalate to the LLM mesh only when the deterministic layer isn't
  // confident, or the content reads as opinion (needs nuance a keyword
  // scorer can't give). This is what keeps API spend near zero.
  const shouldEscalate = heuristic.confidence !== 'high' || heuristic.isOpinion;

  if(shouldEscalate && hasAnyKey()){
    try{
      const llmResult = await analyzeWithMesh(text);
      final = mergeResults(heuristic, llmResult);
    }catch(err){
      final = heuristicOnlyResult(heuristic, true);
    }
  }else{
    final = heuristicOnlyResult(heuristic, shouldEscalate && !hasAnyKey());
  }

  loading.classList.add('hidden');
  renderReceipt(final);
  receiptWrap.classList.remove('hidden');
}

function heuristicOnlyResult(h, noKeyOrFailed){
  let verdict = 'clean';
  if(h.isOpinion) verdict = 'opinion';
  else if(h.score >= 60) verdict = 'bullshit';
  else if(h.score >= 30) verdict = 'caution';

  return {
    verdict,
    score: h.score,
    note: noKeyOrFailed
      ? 'Deeper analysis is temporarily unavailable — showing the structural read instead.'
      : 'Strong enough structural signal to call this without a model.',
    tricks: h.matchedTricks,
    domain: h.domain,
    source: 'heuristics'
  };
}

function mergeResults(h, llm){
  return {
    verdict: llm.verdict || (h.isOpinion ? 'opinion' : 'caution'),
    score: typeof llm.score === 'number' ? llm.score : h.score,
    note: llm.note || 'Analyzed.',
    tricks: (llm.tricks && llm.tricks.length ? llm.tricks : h.matchedTricks),
    domain: h.domain,
    source: llm.source || 'mesh'
  };
}

const VERDICT_LABELS = {
  bullshit: { label: '🐂💩 BULLSHIT', cls: '' },
  clean: { label: '✅ CLEAN', cls: 'ok' },
  caution: { label: '⚠ PROCEED WITH CAUTION', cls: 'caution' },
  opinion: { label: '🤷 OPINION', cls: 'opinion' }
};

function renderReceipt(r){
  const v = VERDICT_LABELS[r.verdict] || VERDICT_LABELS.caution;

  const tricksHtml = (r.tricks && r.tricks.length)
    ? `<div class="tricks">
        ${r.tricks.map(t => `
          <details class="trick-item">
            <summary>${escapeHtml(t.name)}</summary>
            <p>${escapeHtml(t.explain)}</p>
          </details>
        `).join('')}
       </div>`
    : '';

  receiptEl.innerHTML = `
    <div class="receipt-title">Bullshit™ Receipt</div>
    <div class="receipt-row"><span class="k">BS Score</span><span class="v">${r.score}/100</span></div>
    ${r.domain ? `<div class="receipt-row"><span class="k">Source</span><span class="v">${escapeHtml(r.domain)}</span></div>` : ''}
    <hr class="receipt-divider">
    <div class="verdict-stamp ${v.cls}">${v.label}</div>
    <p class="receipt-note">${escapeHtml(r.note)}</p>
    ${tricksHtml}
  `;
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ---- Handle incoming share-target payload ----
(function initFromShare(){
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('input');
  if(shared){
    inputField.value = decodeURIComponent(shared);
    if(params.get('auto') === '1') runAnalysis(inputField.value);
  }
})();

// ---- Register service worker ----
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/bullshit-app/service-worker.js').catch(() => {});
  });
}
