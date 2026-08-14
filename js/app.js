import { scoreContent } from './heuristics.js';
import { analyzeWithMesh, analyzeImageWithMesh, saveKeys, hasAnyKey } from './llm-mesh.js';
import { findTaxonomyByName } from './taxonomy.js';
import { addReceipt, getHistory, deleteReceipt, clearAllHistory } from './history.js';

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
const settingsScrim = $('settingsScrim');
const saveKeysBtn = $('saveKeysBtn');
const groqKeyInput = $('groqKey');
const orKeyInput = $('orKey');
const historyToggle = $('historyToggle');
const historyPanel = $('historyPanel');
const historyList = $('historyList');
const clearHistoryBtn = $('clearHistoryBtn');
const privacyPanel = $('privacyPanel');
const privacyLinkBtn = $('privacyLinkBtn');

// ---- Overlay panels (settings + history + privacy) — shared scrim, mutually exclusive ----
function closeAllPanels(){
  settingsPanel.classList.remove('open');
  historyPanel.classList.remove('open');
  privacyPanel.classList.remove('open');
  settingsScrim.classList.add('hidden');
}
function openPanel(panel){
  closeAllPanels();
  panel.classList.add('open');
  settingsScrim.classList.remove('hidden');
}
privacyLinkBtn.addEventListener('click', () => openPanel(privacyPanel));
settingsToggle.addEventListener('click', () => {
  settingsToggle.classList.remove('spin');
  void settingsToggle.offsetWidth;
  settingsToggle.classList.add('spin');
  if(settingsPanel.classList.contains('open')) closeAllPanels();
  else openPanel(settingsPanel);
});
historyToggle.addEventListener('click', () => {
  if(historyPanel.classList.contains('open')){
    closeAllPanels();
  }else{
    openPanel(historyPanel);
    renderHistoryList();
  }
});
settingsScrim.addEventListener('click', closeAllPanels);
saveKeysBtn.addEventListener('click', () => {
  saveKeys({ groq: groqKeyInput.value.trim(), openrouter: orKeyInput.value.trim() });
  closeAllPanels();
});

// ---- History list rendering ----
async function renderHistoryList(){
  const items = await getHistory();
  if(!items.length){
    historyList.innerHTML = '<p class="history-empty">No receipts yet — analyses you run will show up here.</p>';
    return;
  }
  historyList.innerHTML = items.map(item => {
    const preview = (item.preview || '').slice(0, 60);
    const ellipsis = (item.preview || '').length > 60 ? '…' : '';
    return `
      <div class="history-item" data-id="${item.id}">
        <div class="history-item-main">
          <span class="history-score">${item.score}/100</span>
          <span class="history-preview">${escapeHtml(preview)}${ellipsis}</span>
        </div>
        <button class="history-delete" data-id="${item.id}" aria-label="Delete this entry">✕</button>
      </div>`;
  }).join('');
}

historyList.addEventListener('click', async (e) => {
  const delBtn = e.target.closest('.history-delete');
  if(delBtn){
    e.stopPropagation();
    await deleteReceipt(delBtn.dataset.id);
    renderHistoryList();
    return;
  }
  const row = e.target.closest('.history-item');
  if(row){
    const items = await getHistory();
    const found = items.find(i => i.id === row.dataset.id);
    if(found){
      closeAllPanels();
      intake.classList.add('hidden');
      renderReceipt(found);
      receiptWrap.classList.remove('hidden');
    }
  }
});

clearHistoryBtn.addEventListener('click', async () => {
  if(confirm('Clear all saved history? This can\'t be undone.')){
    await clearAllHistory();
    renderHistoryList();
  }
});

// ---- Link support info tooltip ----
const linkInfoBtn = $('linkInfoBtn');
const linkInfoTooltip = $('linkInfoTooltip');
linkInfoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  linkInfoTooltip.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if(!linkInfoTooltip.classList.contains('hidden') && !linkInfoTooltip.contains(e.target) && e.target !== linkInfoBtn){
    linkInfoTooltip.classList.add('hidden');
  }
});

// ---- Camera capture & file upload (screenshots, saved images) ----
const cameraInput = $('cameraInput');
const fileUploadInput = $('fileUploadInput');

async function handleImageFile(file){
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
    persistReceipt(result, '📷 Image analysis');
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
}

cameraInput.addEventListener('change', async (e) => {
  await handleImageFile(e.target.files[0]);
  cameraInput.value = ''; // allow re-selecting the same file next time
});

fileUploadInput.addEventListener('change', async (e) => {
  await handleImageFile(e.target.files[0]);
  fileUploadInput.value = '';
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
      final = heuristicOnlyResult(heuristic, true, isRateLimit, msg);
    }
  }else{
    final = heuristicOnlyResult(heuristic, shouldEscalate && !hasAnyKey());
  }

  loading.classList.add('hidden');
  renderReceipt(final);
  receiptWrap.classList.remove('hidden');
  persistReceipt(final, text);
}

function heuristicOnlyResult(h, noKeyOrFailed, isRateLimit, debugMsg){
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
  bullshit: { label: 'BULLSHIT', icon: 'bs-icon-bullshit', cls: '', colorVar: '--stamp-red' },
  clean: { label: 'CLEAN', icon: 'bs-icon-clean', cls: 'ok', colorVar: '--ok-green' },
  caution: { label: 'PROCEED WITH CAUTION', icon: 'bs-icon-caution', cls: 'caution', colorVar: '--amber' },
  opinion: { label: 'OPINION', icon: 'bs-icon-opinion', cls: 'opinion', colorVar: '--opinion-grey' }
};

async function persistReceipt(r, preview){
  // Save every real analysis to local history — this is the foundation
  // described in HANDOFF.md §11, works fully offline, never blocks the
  // UI if it fails (private browsing, storage quota, etc).
  const id = r.id || generateBsId(r);
  r.id = id;
  try{
    await addReceipt({
      id,
      timestamp: Date.now(),
      preview: (preview || '').slice(0, 140),
      score: r.score,
      verdict: r.verdict,
      note: r.note,
      tricks: r.tricks || [],
      domain: r.domain || null,
      source: r.source
    });
  }catch(e){
    // non-fatal — history is a bonus, not a requirement
  }
}

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

function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Rasterizes one of our sprite icons to a PNG data URL using the
// browser's own native SVG renderer (via an offscreen Image + canvas),
// rather than asking html2canvas to draw the SVG itself — html2canvas
// re-implements SVG rendering and handles it unreliably (this was the
// actual cause of the missing stamp/icons in shared images, confirmed
// across several rounds of testing), but it draws plain raster <img>
// elements perfectly well. Color must be baked in explicitly since a
// detached, standalone SVG can't rely on inherited `currentColor`.
function rasterizeIcon(iconId, color, size = 96){
  return new Promise((resolve) => {
    const symbol = document.getElementById(iconId);
    if(!symbol){ resolve(null); return; }
    const viewBox = symbol.getAttribute('viewBox') || '0 0 24 24';
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${symbol.innerHTML}</svg>`;
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function buildCaptureHtml(r){
  // A parallel, capture-safe version of the receipt: no <details>
  // (html2canvas renders these with stray numbering), and icons are
  // pre-rasterized to PNGs (see rasterizeIcon) rather than left as
  // SVG, since that's what actually made them render reliably.
  const v = VERDICT_LABELS[r.verdict] || VERDICT_LABELS.caution;
  const stampColor = cssVar(v.colorVar) || '#8B3A3A';
  const inkColor = cssVar('--ink') || '#241C14';

  // Explicit pixel display size, computed from the live root font-size
  // (matches the on-screen 1.3rem/1.1rem sizing) — set as HTML width/
  // height ATTRIBUTES below, not just a CSS class, since html2canvas
  // doesn't reliably apply class-based sizing to freshly injected
  // <img> elements and was rendering them at raw canvas resolution.
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const stampDisplayPx = Math.round(rootPx * 1.3);
  const trickDisplayPx = Math.round(rootPx * 1.1);
  const RASTER_SCALE = 3; // oversample for crispness at html2canvas's own 2x capture scale

  const stampIconPng = await rasterizeIcon(v.icon, stampColor, stampDisplayPx * RASTER_SCALE);
  const stampIconHtml = stampIconPng
    ? `<img src="${stampIconPng}" width="${stampDisplayPx}" height="${stampDisplayPx}" class="stamp-icon-img" alt="">`
    : '';

  let tricksHtml = '';
  if(r.tricks && r.tricks.length){
    const trickIconIds = r.tricks.map(t => {
      const taxEntry = findTaxonomyByName(t.name);
      return t.icon || (taxEntry && taxEntry.icon) || null;
    });
    const trickIconPngs = await Promise.all(
      trickIconIds.map(id => id ? rasterizeIcon(id, inkColor, trickDisplayPx * RASTER_SCALE) : Promise.resolve(null))
    );
    tricksHtml = `<div class="tricks">
      ${r.tricks.map((t, i) => {
        const cleanName = t.name.replace(/^\S+\s/, '');
        const iconHtml = trickIconPngs[i]
          ? `<img src="${trickIconPngs[i]}" width="${trickDisplayPx}" height="${trickDisplayPx}" class="trick-icon-img" alt="">`
          : `<span class="capture-bullet">●</span>`;
        return `
        <div class="trick-item">
          <div class="trick-item-title">${iconHtml}<span>${escapeHtml(cleanName)}</span></div>
          <p>${escapeHtml(t.explain)}</p>
        </div>`;
      }).join('')}
     </div>`;
  }

  return `
    <div class="receipt-title">Bullshit™ Receipt</div>
    <div class="receipt-id">${(r.id || generateBsId(r))}</div>
    <div class="receipt-row"><span class="k">BS Score</span><span class="v">${r.score}/100</span></div>
    ${r.domain ? `<div class="receipt-row"><span class="k">Source</span><span class="v">${escapeHtml(r.domain)}</span></div>` : ''}
    <hr class="receipt-divider">
    <div class="verdict-stamp ${v.cls}" style="opacity:1;animation:none;">${stampIconHtml}${v.label}</div>
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
    <div class="receipt-id">${(r.id || generateBsId(r))}</div>
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

  try{
    // Custom font must be fully loaded before capture, or html2canvas
    // silently falls back to a system font.
    if(document.fonts && document.fonts.ready){
      await document.fonts.ready;
    }

    // Capture the real, visible receipt element (correct size/position,
    // correct inherited styles) — but swap its content for the
    // capture-safe markup (no <details>, no <use> icons) inside the
    // clone only, via onclone. Manually detaching a fixed/off-screen
    // copy caused a black-bar/mis-sized capture — cloning in place
    // avoids that entirely.
    const canvas = await html2canvas(receiptEl, {
      backgroundColor: '#EDE7D9',
      scale: 2,
      onclone: async (clonedDoc) => {
        const clonedReceipt = clonedDoc.getElementById('receipt');
        if(clonedReceipt){
          clonedReceipt.innerHTML = await buildCaptureHtml(lastResult);
        }
      }
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

      shareReceiptBtn.disabled = false;
      shareReceiptBtn.textContent = originalLabel;
    }, 'image/png');

  }catch(err){
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
