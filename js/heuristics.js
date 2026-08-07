// heuristics.js
import { findTaxonomy } from './taxonomy.js';

// Deterministic, zero-API-cost scoring layer. This runs on every single
// analysis. The LLM mesh is only consulted when this layer is not
// confident (see app.js escalation logic), which is what keeps
// Bullshit™ cheap to operate at scale.

const CLICKBAIT_PHRASES = [
  /won'?t believe/i, /one weird trick/i, /doctors hate/i, /this is why/i,
  /you'?ll never guess/i, /will shock you/i, /what happened next/i,
  /the reason (is|will)/i, /before it'?s too late/i, /number \d+ will/i,
  /this changes everything/i, /go(es)? viral/i, /broke the internet/i
];

const EMOTIONAL_WORDS = [
  'shocking','banned','exposed','secret','miracle','cure','hate','destroyed',
  'terrifying','outrageous','slam','slams','blast','blasts','fury','furious',
  'panic','chaos','bombshell','explosive','insane','unbelievable'
];

const URGENCY_WORDS = [
  'breaking','alert','warning','act now','before it\'s too late','urgent',
  'right now','immediately','last chance'
];

const SELLING_WORDS = [
  'buy now','limited offer','% off','click here','free trial','order today',
  'act fast','only $','subscribe now','sign up now'
];

const EVIDENCE_MARKERS = [
  'according to','study found','study shows','data shows','peer-reviewed',
  'researchers at','published in','cited','statistics show','survey found'
];

const OPINION_MARKERS = [
  'i think','in my opinion','op-ed','column','editorial','i believe','we argue'
];

// Small curated seed list — expand over time. Not exhaustive by design;
// domain reputation is a secondary signal, never the deciding one.
const KNOWN_LOW_QUALITY_DOMAINS = [
  'infowars.com','naturalnews.com','beforeitsnews.com','worldtruth.tv'
];
const KNOWN_ESTABLISHED_DOMAINS = [
  'reuters.com','apnews.com','bbc.com','nature.com','nasa.gov','who.int',
  'npr.org','sciencedirect.com'
];

function countMatches(text, list){
  const t = text.toLowerCase();
  return list.filter(w => t.includes(typeof w === 'string' ? w : '')).length
    + list.filter(w => w instanceof RegExp && w.test(text)).length;
}

function capsRatio(text){
  const letters = text.replace(/[^A-Za-z]/g,'');
  if(!letters.length) return 0;
  const caps = letters.replace(/[^A-Z]/g,'');
  return caps.length / letters.length;
}

function punctuationExcess(text){
  const bangs = (text.match(/!/g)||[]).length;
  const qmarks = (text.match(/\?{2,}/g)||[]).length;
  return bangs + qmarks;
}

function toTrick(taxonomyId){
  const t = findTaxonomy(taxonomyId);
  return { name: t.name, explain: t.explain };
}

function extractDomain(text){
  const m = text.match(/https?:\/\/([^\/\s]+)/i);
  return m ? m[1].replace(/^www\./,'').toLowerCase() : null;
}

export function scoreContent(rawText){
  const text = (rawText || '').trim();
  const domain = extractDomain(text);

  const clickbaitHits = CLICKBAIT_PHRASES.filter(r => r.test(text)).length;
  const emotionalHits = EMOTIONAL_WORDS.filter(w => text.toLowerCase().includes(w)).length;
  const urgencyHits = URGENCY_WORDS.filter(w => text.toLowerCase().includes(w)).length;
  const sellingHits = SELLING_WORDS.filter(w => text.toLowerCase().includes(w)).length;
  const evidenceHits = EVIDENCE_MARKERS.filter(w => text.toLowerCase().includes(w)).length;
  const opinionHits = OPINION_MARKERS.filter(w => text.toLowerCase().includes(w)).length;
  const caps = capsRatio(text);
  const punct = punctuationExcess(text);

  let domainAdj = 0;
  if(domain){
    if(KNOWN_LOW_QUALITY_DOMAINS.some(d => domain.includes(d))) domainAdj = 25;
    if(KNOWN_ESTABLISHED_DOMAINS.some(d => domain.includes(d))) domainAdj = -25;
  }

  // Weighted 0-100 bullshit score. Tuned to be conservative — heuristics
  // should push toward "escalate to LLM" rather than false-confident calls.
  let score = 0;
  score += clickbaitHits * 18;
  score += emotionalHits * 8;
  score += urgencyHits * 10;
  score += sellingHits * 14;
  score += Math.min(caps * 40, 20);
  score += Math.min(punct * 6, 18);
  score -= evidenceHits * 15;
  score += domainAdj;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const isOpinion = opinionHits > 0 && clickbaitHits === 0 && sellingHits === 0;

  // Confidence: how much we trust the heuristic score alone, without
  // spending an LLM call. Low confidence = ambiguous middle ground,
  // very short text, or no strong signals either way.
  const strongSignalCount = clickbaitHits + emotionalHits + urgencyHits + sellingHits + evidenceHits;
  let confidence = 'low';
  if(text.length > 15){
    if(score <= 15 && evidenceHits > 0) confidence = 'high';
    else if(score >= 70) confidence = 'high';
    else if(strongSignalCount >= 3) confidence = 'medium';
  }

  const matchedTricks = [];
  if(clickbaitHits > 0) matchedTricks.push(toTrick('curiosity_gap'));
  if(emotionalHits > 0) matchedTricks.push(toTrick('emotional_manipulation'));
  if(urgencyHits > 0) matchedTricks.push(toTrick('manufactured_urgency'));
  if(sellingHits > 0) matchedTricks.push(toTrick('selling_disguised'));
  if(caps > 0.3) matchedTricks.push(toTrick('shouting'));

  return {
    text, domain, score, confidence, isOpinion,
    signals: { clickbaitHits, emotionalHits, urgencyHits, sellingHits, evidenceHits, opinionHits, caps, punct, domainAdj },
    matchedTricks
  };
}
