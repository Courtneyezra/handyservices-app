# Module 13: Design System

**Status:** spec — Wave 3
**Depends on:** —
**Consumed by:** Module 09 (contractor app v2), Module 14 (test page → production), Module 15 (day-pack page production)

## 1. Purpose

Codifies brand tokens and the component library extracted from the
dispatch-preview MVP at `client/src/pages/contractor/DispatchPreviewPage.tsx`
— the **design specification**. Future contractor surfaces inherit the same
visual language without copy-pasting Tailwind classes.

Goals: one source of truth for colours/type/radii/shadows/motion; 14
pre-styled components covering nav, hero, timeline, feedback, layout;
Tailwind theme additions so `bg-navy`, `text-yellow`, `shadow-hero` are
first-class utilities; a shared motion vocabulary. Aesthetic matches the
`handy-services-pdf` skill (navy + gold premium operator).

---

## 2. Brand tokens

```ts
// client/src/design-system/tokens.ts
export const BRAND = {
  colors: {
    navy:        '#1B2A4A',  // primary surface + text on light
    navyDeep:    '#152340',  // hero gradient mid stop
    navyDeepest: '#0E1933',  // hero gradient end stop
    yellow:      '#F5A623',  // accent — CTAs, completion bonus
    yellowLight: '#FFF8EC',  // highlight bg (trophy unlock row)
    yellowText:  '#92591E',  // legible text on yellowLight
    bgLight:     '#F7F8FC',  // page background
    textDark:    '#111827',  // primary body text
    textMuted:   '#6B7280',  // secondary / supporting text
    border:      '#D0D5E3',  // hairline divider, card border
    white:       '#FFFFFF',
  },
  font: {
    family: 'Poppins, sans-serif',
    weights: { regular: 400, medium: 500, semibold: 600, bold: 700, extra: 800 },
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 20, full: 9999 },
  shadow: {
    card:     '0 1px 2px rgba(0,0,0,0.04)',
    elevated: '0 4px 12px rgba(0,0,0,0.08)',
    hero:     '0 12px 40px rgba(27,42,74,0.18)',
  },
  motion: {
    spring:  { type: 'spring', stiffness: 300, damping: 18 },
    easeOut: { duration: 0.2, ease: 'easeOut' },
  },
} as const;
```

`client/src/design-system/motion.ts` re-exports the framer-motion configs plus
the shared `fadeInUp` view variant used by every section block on the MVP.

---

## 3. Tailwind config additions

Append to `tailwind.config.ts` (preserving existing `jobber.*` and shadcn HSL
variable colours):

```ts
import { BRAND } from "./client/src/design-system/tokens";

theme: {
  extend: {
    colors: {
      navy: BRAND.colors.navy,
      'navy-deep': BRAND.colors.navyDeep,
      'navy-deepest': BRAND.colors.navyDeepest,
      yellow: BRAND.colors.yellow,
      'yellow-light': BRAND.colors.yellowLight,
      'yellow-text': BRAND.colors.yellowText,
      'bg-light': BRAND.colors.bgLight,
      'text-dark': BRAND.colors.textDark,
      'text-muted': BRAND.colors.textMuted,
      'brand-border': BRAND.colors.border,
    },
    fontFamily: { sans: ['Poppins', 'sans-serif'] },
    boxShadow: {
      card: BRAND.shadow.card,
      elevated: BRAND.shadow.elevated,
      hero: BRAND.shadow.hero,
    },
    borderRadius: {
      'brand-sm': '8px', 'brand-md': '12px',
      'brand-lg': '16px', 'brand-xl': '20px',
    },
  },
},
```

Tokens are namespaced (`navy`, `bg-light`) to avoid colliding with Tailwind
defaults or shadcn's CSS-variable colours.

---

## 4. Component library

All components live under `client/src/components/<group>/` and accept
`className` overrides via `cn()`.

**`<BrandNavBar />`** — `components/brand/BrandNavBar.tsx`
Navy header with logo, 5★ rating, tap-to-call phone.
Props: `{ phone?: string; ratingStars?: number; reviewCount?: number; logoSrc?: string; }`
Style: `bg-navy text-white max-w-[680px] py-2.5 px-4`; yellow `★★★★★` at 10px.

**`<BrandFooter />`** — `components/brand/BrandFooter.tsx`
Navy footer mirroring the PDF: logo + yellow tagline + phone CTA.
Props: `{ tagline?: string; phone?: string; }`
Style: `bg-navy text-white py-5`; tagline `text-yellow text-[10px]`.

**`<BrandAccentStrip />`** — `components/brand/BrandAccentStrip.tsx`
Yellow strip below nav for page subtitle (`DAY-PACK · FRIDAY 8 MAY`).
Props: `{ children: ReactNode; }`
Style: `bg-yellow text-navy py-1.5 px-4 text-[11px] font-bold tracking-[0.04em] uppercase text-center`.

**`<HeroNavyCard />`** — `components/brand/HeroNavyCard.tsx`
Navy gradient hero with yellow blur "glow" blobs and `shadow-hero` elevation.
Composable inner content (eyebrow, gold £ headline, progress, footer).
Props: `{ children: ReactNode; glow?: boolean; }`
Style: `bg-gradient-to-br from-navy via-navy-deep to-navy-deepest rounded-2xl p-6 sm:p-7 shadow-hero relative overflow-hidden`. Glow blobs `bg-yellow/15 rounded-full blur-3xl` top-right + bottom-left.
Animation: wraps with `fadeInUp`.

**`<NumberedDot />`** — `components/timeline/NumberedDot.tsx`
Numbered circle. *Pending:* white bg + 2px navy border + navy text.
*Complete:* navy bg + white check.
Props: `{ num: number | ReactNode; complete: boolean; size?: 'sm' | 'md'; ariaLabel?: string; }`
Style: `w-7 h-7 rounded-full text-[11px] font-bold tabular-nums flex items-center justify-center transition-all`.

**`<TimelineConnector />`** — `components/timeline/TimelineConnector.tsx`
2px vertical line joining NumberedDots. Auto-positions `left-[29px] top-[44px] -bottom-4`.
Props: `{ active: boolean; }`
Style: `absolute w-[2px] transition-colors z-0`; navy when active, brand-border otherwise.

**`<MarkCompleteButton />`** — `components/timeline/MarkCompleteButton.tsx`
Pill CTA. Pending = navy filled `Mark complete`. Complete = white outlined `✓ Done` chip.
Props: `{ complete: boolean; onClick: () => void; pendingLabel?: string; doneLabel?: string; }`
Pending: `bg-navy text-white rounded-full px-3.5 py-1.5 text-[12px] font-bold active:scale-[0.97]`. Done: `bg-white border border-navy/30 text-navy rounded-full px-3 py-1 text-[11px]`. Wrapper enforces 44×44 hit area.

**`<TrophyUnlockNode />`** — `components/timeline/TrophyUnlockNode.tsx`
Final timeline row for all-or-nothing completion bonus. Activates with
`bg-yellow-light` + 4px `border-l-yellow` when `allComplete`.
Props: `{ allComplete: boolean; bonusPence: number; pendingLabel?: string; doneLabel?: string; }`
Animation: `animate={{ scale: allComplete ? [1.02, 1] : 1 }}` ~0.4s pulse.

**`<ToastStack />` + `useToast()`** — `components/feedback/ToastStack.tsx`
Uber-style transient toast, top-of-page, auto-dismiss 2.4s. Mount once;
hook exposes `showToast(msg, tone?)`. Tones: `bonus` = navy bg, `win` =
yellow gradient bg. Spring 280/20 in (`y:-60 → 0`); `z-[55]`.

**`<ConfettiBurst />`** — `components/feedback/ConfettiBurst.tsx`
36-particle falling confetti. Auto-unmounts ~4s.
Props: `{ active: boolean; particleCount?: number; colors?: string[]; }`
Per-particle randomisation: `left 0–100%`, `delay 0–0.4s`, `duration 1.8–3.4s`,
`size 8–14px`, `xDrift ±100px`, `rotate 0–720°`. Mounts in `fixed inset-0 pointer-events-none z-[54]`.

**`<ProgressBar />`** — `components/feedback/ProgressBar.tsx`
Horizontal bar with animated gradient fill.
Props: `{ value: number; max: number; tone?: 'yellow' | 'green-yellow'; trackTone?: 'light' | 'dark'; }`
Style: `h-2 rounded-full`; track `bg-white/10` (dark) or `bg-bg-light` (light); fill animated `0 → ${pct}%` over 0.5s `easeOut`.

**`<CounterTicker />`** — `components/feedback/CounterTicker.tsx`
Animated number that springs on value change.
Props: `{ value: number; format?: (v: number) => string; }`
`motion.span` keyed by value, `initial={{ scale: 1.15 }} animate={{ scale: 1 }}` with `BRAND.motion.spring`.

**`<MaterialChip />`** — `components/material/MaterialChip.tsx`
Light gray pill listing one material item.
Props: `{ name: string; }`
Style: `text-[11px] bg-bg-light text-text-muted px-2 py-0.5 rounded-md`.

**`<DetailsCollapsible />`** — `components/layout/DetailsCollapsible.tsx`
Native `<details>` styled with brand. Used for pay-protection collapsed row.
Props: `{ icon?: ReactNode; title: string; subtitle?: string; children: ReactNode; defaultOpen?: boolean; }`
Style: `bg-white rounded-2xl border border-brand-border`; chevron rotates 180° on open.

---

## 5. Animation primitives

```ts
// client/src/design-system/motion.ts
import { BRAND } from './tokens';

export const fadeInUp = {
  initial: { opacity: 0, y: 8 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.35 },
};
export const spring  = BRAND.motion.spring;
export const easeOut = BRAND.motion.easeOut;
```

`spring` powers counter ticker, scale-in nudges, toast slide. `easeOut`
handles `<DetailsCollapsible>` and expandable timeline rows. Confetti
randomisation stays inside `<ConfettiBurst />`.

---

## 6. Accessibility

- Interactive elements carry `aria-label`; `<NumberedDot>` and
  `<TimelineConnector>` are `aria-hidden`.
- Focus rings: `focus-visible:ring-2 ring-yellow ring-offset-2`.
- 44×44 px minimum tap targets on all buttons.
- Contrast: navy/white = 12.6:1; text-muted/white = 4.6:1; yellow-text/yellow-light = 5.1:1 — WCAG AA+.
- `design-system/contrast.spec.ts` asserts every pair via `wcag-contrast`.

---

## 7. Storybook plan

Phases 9–10 add Storybook. Each component ships one MDX story with:

1. **Default** — primary appearance.
2. **Key states** — e.g. `<NumberedDot>` pending vs complete; `<TrophyUnlockNode>` locked vs unlocked.
3. **Composition** — short sibling combo (timeline row).

Config in `.storybook/`, excluded from production bundles.

---

## 8. File structure

```
client/src/
├── design-system/
│   ├── tokens.ts            ← BRAND const
│   └── motion.ts            ← fadeInUp + spring + easeOut
└── components/
    ├── brand/      (BrandNavBar, BrandFooter, BrandAccentStrip, HeroNavyCard)
    ├── timeline/   (NumberedDot, TimelineConnector, MarkCompleteButton, TrophyUnlockNode)
    ├── feedback/   (ToastStack [+ useToast], ConfettiBurst, ProgressBar, CounterTicker)
    ├── material/   (MaterialChip)
    └── layout/     (DetailsCollapsible)
```

---

## 9. Adoption plan

| Phase | Surface | Depth |
|---|---|---|
| 1 | flex picker, date picker | tokens + `<BrandAccentStrip>` |
| 7 | contractor portal, day-pack offer, job sheet | full library |
| 8 | legacy `DispatchLinkPage` migration | replace inline classes |
| 10 | admin Control Tower headers | tokens + `<HeroNavyCard>` |

Adoption is opt-in per page — no big-bang rewrite. Existing pages keep their
inline styling until a sweep is scheduled.

---

## 10. Tests

- **Unit:** React Testing Library snapshots + interaction tests per component.
- **Visual regression:** Chromatic snapshots tied to Storybook stories.
- **Accessibility:** `axe-core` in Vitest for every story; CI fails on any
  violation.
- **Contrast:** `design-system/contrast.spec.ts` enforces WCAG AA per pair.

---

## 11. Rollback

Library only — no flag. Components are additive: not importing = no change.
Tokens are namespaced; removing them only affects opted-in files.

---

## 12. Cross-references

- `master-plan.md` — "Brand identity" section (token table that seeds this doc).
- `handy-services-pdf` skill — original PDF brand spec; visual parent of the
  digital system.
- `client/src/pages/contractor/DispatchPreviewPage.tsx` — MVP test page, the
  living source from which every component here was extracted.
- `client/src/pages/contractor/DispatchLinkPage.tsx` — premium-operator
  light-mode reference; first legacy page migrated in Phase 8.
- Module 09 — primary consumer, full adoption.
- Module 14 — uses primitives to harden the MVP.
- Module 15 — composes `<HeroNavyCard>` + timeline + feedback layer end-to-end.
