# PersonalizedQuotePage.tsx - Required Changes

## Current Problem (Lines 2062-2084 & 2146-2149)

You're showing **3 tiers** to BUSY_PRO customers:

```tsx
if (quote.segment === 'BUSY_PRO') {
  if (pkg.tier === 'enhanced') {
    pkg.name = "Priority Service";     // Tier 2
  } else if (pkg.tier === 'elite') {
    pkg.name = "Premium Express";      // Tier 3
  }
  // Tier 1 (essential) also shown
}
```

**This is wrong per Ramanujam**: You're creating Good/Better/Best tiers and asking them to choose.

---

## What Ramanujam Says To Do

**BUSY_PRO should see ONLY "Priority Service"** - that's THE product for them.

---

## Implementation Options

### Option 1: Filter Out Other Tiers (Quick Fix)

```tsx
// BEFORE rendering packages, filter by segment
let packagesToShow = packages;

if (quote.segment === 'BUSY_PRO') {
  // Only show 'enhanced' tier (renamed to "Priority Service")
  packagesToShow = packages.filter(pkg => pkg.tier === 'enhanced');

  // Rename it
  packagesToShow[0].name = "Priority Service";
  packagesToShow[0].description = "Designed for busy professionals";
}

// Then render packagesToShow instead of packages
{packagesToShow.map((pkg) => { ... })}
```

### Option 2: Add Meaningful Variables (Better)

Show ONE product with timing/add-on choices:

```tsx
if (quote.segment === 'BUSY_PRO') {
  // Show ONLY Priority Service
  packagesToShow = packages.filter(pkg => pkg.tier === 'enhanced');
  packagesToShow[0].name = "Priority Service";

  // Add timing variables as options, not tiers
  const timingOptions = [
    { label: "This week", price: packagesToShow[0].price, days: 4 },
    { label: "Next week", price: packagesToShow[0].price - 60, days: 7 }
  ];

  // Add optional add-ons
  const addOns = [
    { label: "Photo documentation", price: 30 },
    { label: "Extended guarantee", price: 40 }
  ];
}
```

---

## Segment-by-Segment Implementation

```tsx
// Segment-specific product filtering
const getProductsForSegment = (segment: string, packages: EEEPackage[]) => {
  switch(segment) {
    case 'BUSY_PRO':
      // ONLY show Priority Service (enhanced tier)
      return packages
        .filter(pkg => pkg.tier === 'enhanced')
        .map(pkg => ({
          ...pkg,
          name: "Priority Service",
          description: "For busy professionals who value speed and convenience"
        }));

    case 'PROP_MGR':
      // ONLY show Partner Program (enhanced tier)
      return packages
        .filter(pkg => pkg.tier === 'enhanced')
        .map(pkg => ({
          ...pkg,
          name: "Partner Program",
          description: "Ongoing reliability for property managers"
        }));

    case 'SMALL_BIZ':
      // ONLY show After-Hours Service (enhanced tier)
      return packages
        .filter(pkg => pkg.tier === 'enhanced')
        .map(pkg => ({
          ...pkg,
          name: "After-Hours Service",
          description: "Zero disruption to your business"
        }));

    case 'DIY_DEFERRER':
      // ONLY show Batch Service (essential tier with batch discount)
      return packages
        .filter(pkg => pkg.tier === 'essential')
        .map(pkg => ({
          ...pkg,
          name: "Batch Service",
          description: "Get multiple jobs done efficiently"
        }));

    case 'BUDGET':
      // ONLY show Standard Service (essential tier)
      return packages
        .filter(pkg => pkg.tier === 'essential')
        .map(pkg => ({
          ...pkg,
          name: "Standard Service",
          description: "Quality work at fair pricing"
        }));

    default:
      // Fallback: show all tiers for unknown segments
      return packages;
  }
};

// Then use it:
const packagesToShow = getProductsForSegment(quote.segment, packages);
```

---

## UI Changes Needed

### Current (WRONG)
```
[Card: Essential]  [Card: Priority ⭐]  [Card: Premium Express]
     $300               $420                   $525
```

### Fixed (RIGHT)
```
[Card: Priority Service ⭐]
         $420

When do you need it?
○ This week: $420
○ Next week: $360

Optional Add-ons:
□ Photo updates: +$30
```

---

## Quick Action Checklist

- [ ] Add `getProductsForSegment()` function
- [ ] Replace `packages.map()` with `packagesToShow.map()`
- [ ] Remove tier selection for segmented customers
- [ ] Add timing/add-on variables (optional, Phase 2)
- [ ] Test each segment sees ONLY their product
- [ ] Update pricing display to show variables, not tiers

---

## Testing

For each segment, verify:
- **BUSY_PRO** → Sees ONLY "Priority Service"
- **PROP_MGR** → Sees ONLY "Partner Program"
- **SMALL_BIZ** → Sees ONLY "After-Hours Service"
- **DIY_DEFERRER** → Sees ONLY "Batch Service"
- **BUDGET** → Sees ONLY "Standard Service"

No segment should see 3 cards to choose from (except unknown/default segments as fallback).

---

## Files to Update

1. `/Users/courtneebonnick/v6-switchboard/client/src/pages/PersonalizedQuotePage.tsx` (main fixes)
2. `/Users/courtneebonnick/v6-switchboard/.agent/skill/code-reviewer/Handyman Business: Segmentation & Pricing Strategy/Plan` (✅ Already updated)

---

## Key Principle to Remember

> **Productize BY segment, NOT tier ONE product**

Each segment gets THE product designed for them. No arbitrary Good/Better/Best choices.

If you want to offer choices, make them:
- **Timing variables** (this week vs next week)
- **Specific add-ons** (photo updates, extended guarantee)
- **Commitment levels** (one-time vs ongoing)

NOT arbitrary quality/feature tiers.
