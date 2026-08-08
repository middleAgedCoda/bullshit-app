import { scoreContent } from './heuristics.js';
import { analyzeWithMesh, analyzeImageWithMesh, saveKeys, hasAnyKey } from './llm-mesh.js';
import { findTaxonomyByName } from './taxonomy.js';

const $ = (id) => document.getElementById(id);

const inputField = $('inputField');
const analyzeBtn = $('analyzeBtn');
const againBtn = $('againBtn');
const intake = $('intake');
const loading = $('loading');
const receiptWrap = $('receiptWrap');
const receiptEl = $('receipt');
const shareReceiptBtn = $('shareReceiptBtn');

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

// ---- Camera capture ----
const cameraInput = $('cameraInput');
cameraInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;

  const dataUrl = await fileToDataUrl(file);

  intake.classList.add('hidden');
  loading.classList.remove('hidden');
  receiptWrap.classList.add('hidden');

  try{
    const result = await analyzeImageWithMesh(dataUrl);
    loading.classList.add('hidden');
    renderReceipt(result);
    receiptWrap.classList.remove('hidden');
  }catch(err){
    loading.classList.add('hidden');
    renderReceipt({
      verdict: 'caution',
      score: 0,
      note: 'Could not analyze that image — try again, or type/paste the text instead.',
      tricks: [],
      source: 'error'
    });
    receiptWrap.classList.remove('hidden');
  }
  cameraInput.value = ''; // allow re-selecting the same file next time
});

async function fileToDataUrl(file){
  // Resize/compress before sending — raw phone camera photos are often
  // 3-5MB+ (12MP+), and decoding that at full resolution just to shrink
  // it is exactly what was causing "low memory" warnings on capture.
  // createImageBitmap's resize options let the browser decode straight
  // to target size, without ever fully allocating the original in memory.
  const maxWidth = 1024;

  if('createImageBitmap' in window){
    try{
      const probe = await createImageBitmap(file);
      const scale = Math.min(1, maxWidth / probe.width);
      const targetW = Math.round(probe.width * scale);
      const targetH = Math.round(probe.height * scale);
      probe.close();

      const bitmap = await createImageBitmap(file, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'medium'
      });
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.75);
    }catch(e){
      // fall through to the Image-based approach below
    }
  }

  // Fallback for browsers without createImageBitmap resize support
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
      const msg = err.message || '';
      let isRateLimit = false;
      if(/overloaded/i.test(msg)) isRateLimit = 'overload';
      else if(/Too many analyses|rate_limited/i.test(msg)) isRateLimit = true;
      final = heuristicOnlyResult(heuristic, true, isRateLimit);
    }
  }else{
    final = heuristicOnlyResult(heuristic, shouldEscalate && !hasAnyKey());
  }

  loading.classList.add('hidden');
  renderReceipt(final);
  receiptWrap.classList.remove('hidden');
}

function heuristicOnlyResult(h, noKeyOrFailed, isRateLimit){
  let verdict = 'clean';
  if(h.isOpinion) verdict = 'opinion';
  else if(h.score >= 60) verdict = 'bullshit';
  else if(h.score >= 30) verdict = 'caution';

  let note = 'Strong enough structural signal to call this without a model.';
  if(isRateLimit === 'overload'){
    note = 'The shared analysis engine hit a brief traffic spike — try running it again in a few seconds.';
  }else if(isRateLimit){
    note = 'You\'ve hit the shared analysis limit for this hour — showing the structural read instead. Try again shortly, or add your own free Groq key in Settings.';
  }else if(noKeyOrFailed){
    note = 'Deeper analysis is temporarily unavailable — showing the structural read instead.';
  }

  return {
    verdict,
    score: h.score,
    note,
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
  bullshit: { label: 'BULLSHIT', icon: 'bs-icon-bullshit', cls: '' },
  clean: { label: 'CLEAN', icon: 'bs-icon-clean', cls: 'ok' },
  caution: { label: 'PROCEED WITH CAUTION', icon: 'bs-icon-caution', cls: 'caution' },
  opinion: { label: 'OPINION', icon: 'bs-icon-opinion', cls: 'opinion' }
};

function generateBsId(r){
  // Deterministic short hash of the result content + a coarse timestamp
  // bucket, so re-running similar content produces a stable-ish ID
  // without needing a backend. Not cryptographic — just a citable
  // reference for this receipt.
  let hash = 0;
  const str = (r.note || '') + r.score + (r.verdict || '') + new Date().toISOString().slice(0, 10);
  for(let i = 0; i < str.length; i++){
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash).toString().padStart(8, '0').slice(0, 8);
  const year = new Date().getFullYear();
  return `BS-${year}-${positive}`;
}

function resolveIconSvg(iconId, className){
  // html2canvas can't reliably render <use> references, even inline
  // ones — so for anything that might get captured to an image, we
  // build a standalone <svg> with the real path data embedded directly.
  const symbol = document.getElementById(iconId);
  if(!symbol) return '';
  const viewBox = symbol.getAttribute('viewBox') || '0 0 24 24';
  return `<svg class="${className}" viewBox="${viewBox}" fill="none" stroke="currentColor">${symbol.innerHTML}</svg>`;
}

function buildCaptureHtml(r){
  // A parallel, capture-safe version of the receipt: no <details>
  // (html2canvas renders these with stray numbering), no <use> icon
  // references — just plain divs and fully-inlined SVGs. Used only
  // for the shared image; the on-screen interactive receipt is
  // untouched.
  const v = VERDICT_LABELS[r.verdict] || VERDICT_LABELS.caution;
  const stampIcon = resolveIconSvg(v.icon, 'stamp-icon');

  const tricksHtml = (r.tricks && r.tricks.length)
    ? `<div class="tricks">
        ${r.tricks.map(t => {
          const taxEntry = findTaxonomyByName(t.name);
          const iconId = t.icon || (taxEntry && taxEntry.icon);
          const cleanName = t.name.replace(/^\S+\s/, '');
          const iconHtml = iconId ? resolveIconSvg(iconId, 'trick-icon') : '';
          return `
          <div class="trick-item">
            <div class="trick-item-title">${iconHtml}<span>${escapeHtml(cleanName)}</span></div>
            <p>${escapeHtml(t.explain)}</p>
          </div>`;
        }).join('')}
       </div>`
    : '';

  return `
    <div class="receipt-title">Bullshit™ Receipt</div>
    <div class="receipt-id">${generateBsId(r)}</div>
    <div class="receipt-row"><span class="k">BS Score</span><span class="v">${r.score}/100</span></div>
    ${r.domain ? `<div class="receipt-row"><span class="k">Source</span><span class="v">${escapeHtml(r.domain)}</span></div>` : ''}
    <hr class="receipt-divider">
    <div class="verdict-stamp ${v.cls}">${stampIcon}${v.label}</div>
    <p class="receipt-note">${escapeHtml(r.note)}</p>
    ${tricksHtml}
  `;
}

let lastResult = null;

function renderReceipt(r){
  lastResult = r;
  const v = VERDICT_LABELS[r.verdict] || VERDICT_LABELS.caution;

  const tricksHtml = (r.tricks && r.tricks.length)
    ? `<div class="tricks">
        ${r.tricks.map(t => {
          const taxEntry = findTaxonomyByName(t.name);
          const iconId = t.icon || (taxEntry && taxEntry.icon);
          const cleanName = t.name.replace(/^\S+\s/, ''); // strip leading emoji glyph, icon replaces it
          const iconHtml = iconId
            ? `<svg class="trick-icon" aria-hidden="true"><use href="#${iconId}"></use></svg>`
            : '';
          return `
          <details class="trick-item">
            <summary>${iconHtml}<span>${escapeHtml(cleanName)}</span></summary>
            <p>${escapeHtml(t.explain)}</p>
          </details>
        `;
        }).join('')}
       </div>`
    : '';

  receiptEl.innerHTML = `
    <div class="receipt-title">Bullshit™ Receipt</div>
    <div class="receipt-id">${generateBsId(r)}</div>
    <div class="receipt-row"><span class="k">BS Score</span><span class="v">${r.score}/100</span></div>
    ${r.domain ? `<div class="receipt-row"><span class="k">Source</span><span class="v">${escapeHtml(r.domain)}</span></div>` : ''}
    <hr class="receipt-divider">
    <div class="verdict-stamp ${v.cls}"><svg class="stamp-icon" aria-hidden="true"><use href="#${v.icon}"></use></svg>${v.label}</div>
    <p class="receipt-note">${escapeHtml(r.note)}</p>
    ${tricksHtml}
  `;
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ---- Share receipt as an image ----
shareReceiptBtn.addEventListener('click', async () => {
  if(typeof html2canvas === 'undefined' || !lastResult){
    alert('Sharing isn\'t available right now — try again in a moment.');
    return;
  }

  shareReceiptBtn.disabled = true;
  const originalLabel = shareReceiptBtn.textContent;
  shareReceiptBtn.textContent = 'Preparing…';

  // Build a detached, capture-safe copy of the receipt off-screen —
  // same width as the live one so layout matches exactly, but using
  // markup html2canvas can actually render correctly.
  const captureNode = document.createElement('div');
  captureNode.className = 'receipt';
  captureNode.style.position = 'fixed';
  captureNode.style.top = '0';
  captureNode.style.left = '-9999px';
  captureNode.style.width = receiptEl.getBoundingClientRect().width + 'px';
  captureNode.innerHTML = buildCaptureHtml(lastResult);
  document.body.appendChild(captureNode);

  try{
    // Custom font must be fully loaded before capture, or html2canvas
    // silently falls back to a system font and the receipt looks plain.
    if(document.fonts && document.fonts.ready){
      await document.fonts.ready;
    }

    const canvas = await html2canvas(captureNode, {
      backgroundColor: '#EDE7D9',
      scale: 2
    });

    canvas.toBlob(async (blob) => {
      const file = new File([blob], 'bullshit-receipt.png', { type: 'image/png' });

      if(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({
            files: [file],
            title: 'Bullshit™ Receipt',
            text: 'Ran this through Bullshit™ — know what you\'re looking at.'
          });
        }catch(shareErr){
          // user cancelled the share sheet — not an error, do nothing
        }
      }else{
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bullshit-receipt.png';
        a.click();
        URL.revokeObjectURL(url);
      }

      captureNode.remove();
      shareReceiptBtn.disabled = false;
      shareReceiptBtn.textContent = originalLabel;
    }, 'image/png');

  }catch(err){
    captureNode.remove();
    shareReceiptBtn.disabled = false;
    shareReceiptBtn.textContent = originalLabel;
    alert('Could not generate the receipt image — try again.');
  }
});

// ---- Splash screen ----
const splash = document.getElementById('splash');
if(splash){
  const isShareIntent = new URLSearchParams(window.location.search).get('auto') === '1';
  if(isShareIntent){
    splash.remove();
  }else{
    setTimeout(() => splash.remove(), 2900);
  }
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
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
      const isRateLimit = /Too many analyses|rate_limited/i.test(err.message || '');
      final = heuristicOnlyResult(heuristic, true, isRateLimit);
    }
  }else{
    final = heuristicOnlyResult(heuristic, shouldEscalate && !hasAnyKey());
  }

  loading.classList.add('hidden');
  renderReceipt(final);
  receiptWrap.classList.remove('hidden');
}

function heuristicOnlyResult(h, noKeyOrFailed, isRateLimit){
  let verdict = 'clean';
  if(h.isOpinion) verdict = 'opinion';
  else if(h.score >= 60) verdict = 'bullshit';
  else if(h.score >= 30) verdict = 'caution';

  let note = 'Strong enough structural signal to call this without a model.';
  if(isRateLimit){
    note = 'You\'ve hit the shared analysis limit for this hour — showing the structural read instead. Try again shortly, or add your own free Groq key in Settings.';
  }else if(noKeyOrFailed){
    note = 'Deeper analysis is temporarily unavailable — showing the structural read instead.';
  }

  return {
    verdict,
    score: h.score,
    note,
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
  bullshit: { label: 'BULLSHIT', icon: 'bs-icon-bullshit', cls: '' },
  clean: { label: 'CLEAN', icon: 'bs-icon-clean', cls: 'ok' },
  caution: { label: 'PROCEED WITH CAUTION', icon: 'bs-icon-caution', cls: 'caution' },
  opinion: { label: 'OPINION', icon: 'bs-icon-opinion', cls: 'opinion' }
};

function generateBsId(r){
  // Deterministic short hash of the result content + a coarse timestamp
  // bucket, so re-running similar content produces a stable-ish ID
  // without needing a backend. Not cryptographic — just a citable
  // reference for this receipt.
  let hash = 0;
  const str = (r.note || '') + r.score + (r.verdict || '') + new Date().toISOString().slice(0, 10);
  for(let i = 0; i < str.length; i++){
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash).toString().padStart(8, '0').slice(0, 8);
  const year = new Date().getFullYear();
  return `BS-${year}-${positive}`;
}

function resolveIconSvg(iconId, className){
  // html2canvas can't reliably render <use> references, even inline
  // ones — so for anything that might get captured to an image, we
  // build a standalone <svg> with the real path data embedded directly.
  const symbol = document.getElementById(iconId);
  if(!symbol) return '';
  const viewBox = symbol.getAttribute('viewBox') || '0 0 24 24';
  return `<svg class="${className}" viewBox="${viewBox}" fill="none" stroke="currentColor">${symbol.innerHTML}</svg>`;
}

function buildCaptureHtml(r){
  // A parallel, capture-safe version of the receipt: no <details>
  // (html2canvas renders these with stray numbering), no <use> icon
  // references — just plain divs and fully-inlined SVGs. Used only
  // for the shared image; the on-screen interactive receipt is
  // untouched.
  const v = VERDICT_LABELS[r.verdict] || VERDICT_LABELS.caution;
  const stampIcon = resolveIconSvg(v.icon, 'stamp-icon');

  const tricksHtml = (r.tricks && r.tricks.length)
    ? `<div class="tricks">
        ${r.tricks.map(t => {
          const taxEntry = findTaxonomyByName(t.name);
          const iconId = t.icon || (taxEntry && taxEntry.icon);
          const cleanName = t.name.replace(/^\S+\s/, '');
          const iconHtml = iconId ? resolveIconSvg(iconId, 'trick-icon') : '';
          return `
          <div class="trick-item">
            <div class="trick-item-title">${iconHtml}<span>${escapeHtml(cleanName)}</span></div>
            <p>${escapeHtml(t.explain)}</p>
          </div>`;
        }).join('')}
       </div>`
    : '';

  return `
    <div class="receipt-title">Bullshit™ Receipt</div>
    <div class="receipt-id">${generateBsId(r)}</div>
    <div class="receipt-row"><span class="k">BS Score</span><span class="v">${r.score}/100</span></div>
    ${r.domain ? `<div class="receipt-row"><span class="k">Source</span><span class="v">${escapeHtml(r.domain)}</span></div>` : ''}
    <hr class="receipt-divider">
    <div class="verdict-stamp ${v.cls}">${stampIcon}${v.label}</div>
    <p class="receipt-note">${escapeHtml(r.note)}</p>
    ${tricksHtml}
  `;
}

let lastResult = null;

function renderReceipt(r){
  lastResult = r;
  const v = VERDICT_LABELS[r.verdict] || VERDICT_LABELS.caution;

  const tricksHtml = (r.tricks && r.tricks.length)
    ? `<div class="tricks">
        ${r.tricks.map(t => {
          const taxEntry = findTaxonomyByName(t.name);
          const iconId = t.icon || (taxEntry && taxEntry.icon);
          const cleanName = t.name.replace(/^\S+\s/, ''); // strip leading emoji glyph, icon replaces it
          const iconHtml = iconId
            ? `<svg class="trick-icon" aria-hidden="true"><use href="#${iconId}"></use></svg>`
            : '';
          return `
          <details class="trick-item">
            <summary>${iconHtml}<span>${escapeHtml(cleanName)}</span></summary>
            <p>${escapeHtml(t.explain)}</p>
          </details>
        `;
        }).join('')}
       </div>`
    : '';

  receiptEl.innerHTML = `
    <div class="receipt-title">Bullshit™ Receipt</div>
    <div class="receipt-id">${generateBsId(r)}</div>
    <div class="receipt-row"><span class="k">BS Score</span><span class="v">${r.score}/100</span></div>
    ${r.domain ? `<div class="receipt-row"><span class="k">Source</span><span class="v">${escapeHtml(r.domain)}</span></div>` : ''}
    <hr class="receipt-divider">
    <div class="verdict-stamp ${v.cls}"><svg class="stamp-icon" aria-hidden="true"><use href="#${v.icon}"></use></svg>${v.label}</div>
    <p class="receipt-note">${escapeHtml(r.note)}</p>
    ${tricksHtml}
  `;
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ---- Share receipt as an image ----
shareReceiptBtn.addEventListener('click', async () => {
  if(typeof html2canvas === 'undefined' || !lastResult){
    alert('Sharing isn\'t available right now — try again in a moment.');
    return;
  }

  shareReceiptBtn.disabled = true;
  const originalLabel = shareReceiptBtn.textContent;
  shareReceiptBtn.textContent = 'Preparing…';

  // Build a detached, capture-safe copy of the receipt off-screen —
  // same width as the live one so layout matches exactly, but using
  // markup html2canvas can actually render correctly.
  const captureNode = document.createElement('div');
  captureNode.className = 'receipt';
  captureNode.style.position = 'fixed';
  captureNode.style.top = '0';
  captureNode.style.left = '-9999px';
  captureNode.style.width = receiptEl.getBoundingClientRect().width + 'px';
  captureNode.innerHTML = buildCaptureHtml(lastResult);
  document.body.appendChild(captureNode);

  try{
    // Custom font must be fully loaded before capture, or html2canvas
    // silently falls back to a system font and the receipt looks plain.
    if(document.fonts && document.fonts.ready){
      await document.fonts.ready;
    }

    const canvas = await html2canvas(captureNode, {
      backgroundColor: '#EDE7D9',
      scale: 2
    });

    canvas.toBlob(async (blob) => {
      const file = new File([blob], 'bullshit-receipt.png', { type: 'image/png' });

      if(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({
            files: [file],
            title: 'Bullshit™ Receipt',
            text: 'Ran this through Bullshit™ — know what you\'re looking at.'
          });
        }catch(shareErr){
          // user cancelled the share sheet — not an error, do nothing
        }
      }else{
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bullshit-receipt.png';
        a.click();
        URL.revokeObjectURL(url);
      }

      captureNode.remove();
      shareReceiptBtn.disabled = false;
      shareReceiptBtn.textContent = originalLabel;
    }, 'image/png');

  }catch(err){
    captureNode.remove();
    shareReceiptBtn.disabled = false;
    shareReceiptBtn.textContent = originalLabel;
    alert('Could not generate the receipt image — try again.');
  }
});

// ---- Splash screen ----
const splash = document.getElementById('splash');
if(splash){
  const isShareIntent = new URLSearchParams(window.location.search).get('auto') === '1';
  if(isShareIntent){
    splash.remove();
  }else{
    setTimeout(() => splash.remove(), 2900);
  }
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
