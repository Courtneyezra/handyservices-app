import type { CatalogSku } from '@/components/admin/SkuPicker';

const STOP = new Set(['the','a','an','and','or','to','of','for','with','my','our','your','please','need','want','it','is','are','some','this','that','i','we','on','in','at','fix','sort','get','can','you']);

// Colloquial → catalog vocabulary (bidirectional).
const SYN: Record<string, string[]> = {
  tv: ['telly','television'],
  tap: ['faucet','mixer'],
  toilet: ['loo','wc','cistern','lavatory'],
  light: ['lighting','lamp','downlight','spotlight'],
  socket: ['plug','outlet','sockets'],
  paint: ['painting','decorate','decorating','emulsion'],
  radiator: ['rad'],
  shelf: ['shelves','shelving'],
  flatpack: ['flat','ikea','assemble','assembly'],
  mount: ['mounting','bracket','wallmount'],
};

function expand(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const [k, syns] of Object.entries(SYN)) {
      if (t === k) syns.forEach((s) => out.add(s));
      else if (syns.includes(t)) out.add(k);
    }
  }
  return [...out];
}

export function tokenize(q: string): string[] {
  return expand(
    q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t)),
  );
}

// edit distance <= 1
function lev1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

// word-exact > prefix > substring > fuzzy
function fieldScore(text: string, token: string): number {
  const t = text.toLowerCase();
  const words = t.split(/[^a-z0-9]+/);
  if (words.includes(token)) return 1.0;
  if (token.length >= 3 && words.some((w) => w.startsWith(token))) return 0.7;
  if (t.includes(token)) return 0.4;
  if (token.length >= 4 && words.some((w) => lev1(w, token))) return 0.5;
  return 0;
}

const FIELD_WEIGHTS: Array<[keyof CatalogSku, number]> = [
  ['name', 10],
  ['skuCode', 4],
  ['customerDescription', 4],
  ['adminDescription', 3],
];

const RELEVANCE_FLOOR = 5;

export function searchSkus(catalog: CatalogSku[], query: string, limit = 8): CatalogSku[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scored: Array<{ sku: CatalogSku; score: number }> = [];
  for (const sku of catalog) {
    if (!sku.isActive) continue;
    let total = 0, matched = 0;
    for (const tok of tokens) {
      let best = 0;
      for (const [field, w] of FIELD_WEIGHTS) {
        const text = sku[field];
        if (typeof text === 'string' && text) best = Math.max(best, fieldScore(text, tok) * w);
      }
      if (best > 0) matched++;
      total += best;
    }
    if (matched === 0) continue;
    const coverage = matched / tokens.length;
    let score = total * (0.4 + 0.6 * coverage);
    score += Math.log1p(sku.pickCount || 0) * 0.4;
    if (score >= RELEVANCE_FLOOR) scored.push({ sku, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.sku);
}
