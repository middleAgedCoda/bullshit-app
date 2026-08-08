// taxonomy.js
// The Bullshit Taxonomy™ — a closed, named set of tactics. Both the
// heuristics engine and the LLM mesh are constrained to pick from this
// list rather than freestyling labels. This consistency is the brand:
// over time these categories become Bullshit's own language, not just
// AI-generated commentary that varies every run.

export const TAXONOMY = [
  { id: 'emotional_manipulation', name: '🎭 Emotional Manipulation', icon: 'bs-icon-emotional',
    explain: 'Charged language is used to trigger a reaction before the claim itself has been evaluated.' },
  { id: 'selling_disguised', name: '🛒 Selling Disguised as Advice', icon: 'bs-icon-selling',
    explain: 'Reads like neutral information or a tip, but the underlying goal is to sell something.' },
  { id: 'engagement_fishing', name: '🎣 Engagement Fishing', icon: 'bs-icon-engagement',
    explain: 'Structured to bait replies, shares, or arguments rather than to inform.' },
  { id: 'outrage_farming', name: '📣 Outrage Farming', icon: 'bs-icon-outrage',
    explain: 'Frames something to provoke anger because anger drives shares.' },
  { id: 'authority_cosplay', name: '🥸 Authority Cosplay', icon: 'bs-icon-authority',
    explain: 'Borrows the tone or trappings of expertise without citing real credentials or sources.' },
  { id: 'statistical_acrobatics', name: '📊 Statistical Acrobatics', icon: 'bs-icon-statistical',
    explain: 'Numbers are technically true but framed or selected to imply more than the data supports.' },
  { id: 'missing_context', name: '🧩 Missing Context', icon: 'bs-icon-context',
    explain: 'The core fact may be accurate, but leaves out context that would change how it reads.' },
  { id: 'ai_slop', name: '🤖 AI Slop', icon: 'bs-icon-aislop',
    explain: 'Bears the hallmarks of low-effort AI-generated filler produced to fill space, not to inform.' },
  { id: 'science_ish', name: '🧪 Science-ish', icon: 'bs-icon-science',
    explain: 'Uses scientific-sounding language without real evidence, citations, or methodology behind it.' },
  { id: 'crypto_energy', name: '💸 Crypto Energy', icon: 'bs-icon-crypto',
    explain: 'Hype-driven, guaranteed-returns framing typical of speculative financial pitches.' },
  { id: 'trust_me_bro', name: '👀 Trust Me Bro™', icon: 'bs-icon-trustmebro',
    explain: 'Asserts a claim with confidence but offers no source, evidence, or way to verify it.' },
  { id: 'curiosity_gap', name: '🪤 Curiosity Gap', icon: 'bs-icon-curiosity',
    explain: 'Withholds the actual information to force a click, rather than leading with the fact.' },
  { id: 'manufactured_urgency', name: '⏰ Manufactured Urgency', icon: 'bs-icon-urgency',
    explain: 'Pressure to act or believe immediately, which short-circuits normal scrutiny.' },
  { id: 'shouting', name: '📢 Shouting', icon: 'bs-icon-shouting',
    explain: 'Excessive capitalization or punctuation used to simulate urgency or volume rather than inform.' }
];

export function findTaxonomy(id){
  return TAXONOMY.find(t => t.id === id);
}

export function findTaxonomyByName(name){
  return TAXONOMY.find(t => t.name === name);
}

export function taxonomyPromptList(){
  return TAXONOMY.map(t => `- "${t.name}": ${t.explain}`).join('\n');
}
