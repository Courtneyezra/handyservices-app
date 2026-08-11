// Scope-risk heuristic — flags CONTEXTUAL jobs whose real scope is likely to
// change once someone's actually on-site, so they shouldn't be priced &
// committed sight-unseen. Drives the "require a survey first" suggestion in the
// quote builder (auto-suggest, Ben confirms — never silently forced).
//
// Deterministic + transparent on purpose: it runs on every line-item edit (the
// builder's live preview cadence), costs nothing, and every trigger returns a
// human-readable reason so Ben can see WHY it fired and overrule it. It mirrors
// the intent of the existing classifyLead brain (vague / complex / fault /
// project ⇒ needs a visit), reduced to the signals available client-side.

export type ScopeRiskLevel = 'none' | 'possible' | 'likely';

export interface ScopeRiskLine {
  description?: string;
  category?: string;
  source?: 'sku' | 'custom';
  estimatedMinutes?: number;
  materialsCostPounds?: number;
}

export interface ScopeRiskResult {
  level: ScopeRiskLevel;
  /** Short, plain-English reasons — shown to Ben verbatim. */
  reasons: string[];
  /** A sensible starting survey fee (pence), scaled to the job. Ben can edit. */
  suggestedFeePence: number;
}

// Trades where hidden conditions / variable substrate routinely move the scope
// once the work is actually opened up or measured on-site.
const HIGH_RISK_CATEGORIES: Record<string, string> = {
  bathroom_fitting: 'Bathroom fitting — hidden pipework & rot are common',
  kitchen_fitting: 'Kitchen fitting — services and levels vary on-site',
  plastering: 'Plastering — substrate condition unknown until seen',
  plumbing_minor: 'Plumbing — the real fault often differs on inspection',
  electrical_minor: 'Electrical — existing condition unknown sight-unseen',
  tiling: 'Tiling — surface prep and area routinely change on-site',
  flooring: 'Flooring — subfloor condition unknown until lifted',
  guttering: 'Guttering — access and extent of damage vary',
  fencing: 'Fencing — ground and existing posts vary along the run',
};

// Softer signals — worth a look, but not risky on their own.
const MEDIUM_RISK_CATEGORIES: Record<string, string> = {
  carpentry: 'Carpentry repair — extent often only clear on-site',
  door_fitting: 'Door fitting — frames/openings can be out of true',
  painting: 'Painting — making-good of surfaces can expand',
  other: 'Uncategorised work — scope not well defined',
};

// Wording that implies an unknown, a diagnosis, or open-ended "make good" work —
// the classic sight-unseen trap. Mirrors classifyLead's vague/fault cues.
const VAGUE_PATTERN =
  /\b(leak|damp|rot|mould|mold|smell|damp\s*proof|water\s*damage|investigat\w*|diagnos\w*|assess\w*|survey|unknown|unsure|not\s+sure|trace|source\s+of|find\s+the|could\s+be|might\s+need|may\s+need|if\s+needed|tbc|to\s+be\s+confirmed|depend\w*|suspect\w*|possib\w*|structural|subsidence|movement|crack\w*|make\s+good)\b/i;

function roundToPounds(pence: number, step = 500): number {
  return Math.max(step, Math.round(pence / step) * step);
}

/**
 * Assess scope-change risk for a set of quote line items.
 *
 * @param lines      the entered line items
 * @param totalPence the live-preview job total (drives value-based signals); 0 if unknown
 */
export function assessScopeRisk(lines: ScopeRiskLine[], totalPence = 0): ScopeRiskResult {
  const highReasons: string[] = [];
  const mediumReasons: string[] = [];
  const riskyCategories = new Set<string>();

  for (const li of lines) {
    const cat = li.category || '';
    if (HIGH_RISK_CATEGORIES[cat]) {
      riskyCategories.add(cat);
      if (!highReasons.includes(HIGH_RISK_CATEGORIES[cat])) highReasons.push(HIGH_RISK_CATEGORIES[cat]);
    } else if (MEDIUM_RISK_CATEGORIES[cat]) {
      if (!mediumReasons.includes(MEDIUM_RISK_CATEGORIES[cat])) mediumReasons.push(MEDIUM_RISK_CATEGORIES[cat]);
    }
  }

  // Wording cue anywhere in the descriptions.
  const vagueHit = lines.some((li) => li.description && VAGUE_PATTERN.test(li.description));

  // Bespoke, un-catalogued work of real size (a full day+ or heavy materials) —
  // no SKU baseline to lean on. Deliberately high so ordinary custom lines
  // (a few hours' painting/carpentry) don't trip it.
  const bigCustom = lines.some(
    (li) => li.source === 'custom' && ((li.estimatedMinutes ?? 0) >= 360 || (li.materialsCostPounds ?? 0) >= 300),
  );

  // Multiple variable trades bundled into one job.
  const multiTrade = riskyCategories.size >= 2;

  // High-value commitment — worth eyes-on before locking a price.
  const highValue = totalPence >= 150000; // £1,500

  // Meaningful triggers. Medium-risk categories are supporting context only —
  // never the sole reason to suggest a survey (keeps noise down).
  const hasMeaningfulSignal =
    highReasons.length > 0 || vagueHit || multiTrade || bigCustom || highValue;

  if (!hasMeaningfulSignal) {
    return { level: 'none', reasons: [], suggestedFeePence: 0 };
  }

  // Assemble the shown reasons in priority order.
  const reasons: string[] = [...highReasons];
  if (vagueHit) reasons.push('Wording suggests an unknown or diagnostic element');
  if (multiTrade) reasons.push('Multiple variable trades in one job');
  if (bigCustom) reasons.push('Sizeable bespoke work with no catalogue baseline');
  if (highValue) reasons.push('High-value job — confirm scope on-site before committing');
  reasons.push(...mediumReasons); // supporting context, last

  // "Likely" when a strong signal (or a stack of them) is present.
  const strong =
    vagueHit ||
    multiTrade ||
    riskyCategories.has('bathroom_fitting') ||
    riskyCategories.has('kitchen_fitting') ||
    (highReasons.length > 0 && (highValue || bigCustom)) ||
    totalPence >= 250000; // £2,500
  const level: ScopeRiskLevel = strong ? 'likely' : 'possible';

  // Fee scales modestly with the job: bigger/riskier jobs justify a higher
  // (still fully credited) survey fee. Ben can override.
  let feePence = 4900; // £49 default
  if (strong) feePence = 7500; // £75
  if (totalPence >= 250000) feePence = 9500; // £95 on big jobs
  feePence = roundToPounds(feePence);

  return { level, reasons, suggestedFeePence: feePence };
}
