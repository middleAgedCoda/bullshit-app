// taxonomy.js
// The Bullshit Taxonomy™ — a closed, named set of tactics. Both the
// heuristics engine and the LLM mesh are constrained to pick from this
// list rather than freestyling labels. This consistency is the brand:
// over time these categories become Bullshit's own language, not just
// AI-generated commentary that varies every run.

export const TAXONOMY = [
  { id: 'emotional_manipulation', name: '🎭 Emotional Manipulation',
    explain: 'Charged language is used to trigger a reaction before the claim itself has been evaluated.' },
  { id: 'selling_disguised', name: '🛒 Selling Disguised as Advice',
    explain: 'Reads like neutral information or a tip, but the underlying goal is to sell something.' },
  { id: 'engagement_fishing', name: '🎣 Engagement Fishing',
    explain: 'Structured to bait replies, shares, or arguments rather than to inform.' },
  { id: 'outrage_farming', name: '📣 Outrage Farming',
    explain: 'Frames something to provoke anger because anger drives shares.' },
  { id: 'authority_cosplay', name: '🥸 Authority Cosplay',
    explain: 'Borrows the tone or trappings of expertise without citing real credentials or sources.' },
  { id: 'statistical_acrobatics', name: '📊 Statistical Acrobatics',
    explain: 'Numbers are technically true but framed or selected to imply more than the data supports.' },
  { id: 'missing_context', name: '🧩 Missing Context',
    explain: 'The core fact may be accurate, but leaves out context that would change how it reads.' },
  { id: 'ai_slop', name: '🤖 AI Slop',
    explain: 'Bears the hallmarks of low-effort AI-generated filler produced to fill space, not to inform.' },
  { id: 'science_ish', name: '🧪 Science-ish',
    explain: 'Uses scientific-sounding language without real evidence, citations, or methodology behind it.' },
  { id: 'crypto_energy', name: '💸 Crypto Energy',
    explain: 'Hype-driven, guaranteed-returns framing typical of speculative financial pitches.' },
  { id: 'trust_me_bro', name: '👀 Trust Me Bro™',
    explain: 'Asserts a claim with confidence but offers no source, evidence, or way to verify it.' },
  { id: 'curiosity_gap', name: '🪤 Curiosity Gap',
    explain: 'Withholds the actual information to force a click, rather than leading with the fact.' },
  { id: 'manufactured_urgency', name: '⏰ Manufactured Urgency',
    explain: 'Pressure to act or believe immediately, which short-circuits normal scrutiny.' },
  { id: 'shouting', name: '📢 Shouting',
    explain: 'Excessive capitalization or punctuation used to simulate urgency or volume rather than inform.' }
];

export function findTaxonomy(id){
  return TAXONOMY.find(t => t.id === id);
}

export function taxonomyPromptList(){
  return TAXONOMY.map(t => `- "${t.name}": ${t.explain}`).join('\n');
}
