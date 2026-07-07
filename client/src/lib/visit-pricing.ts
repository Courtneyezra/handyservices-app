/**
 * Visit-specific pricing constants.
 *
 * The exact-slot premium is a small flat fee — the job-side
 * computeSetDatePremiumPence (£30 + 6%) is calibrated for job-sized prices and
 * would dwarf a ~£45 assessment fee. This MUST mirror VISIT_SET_DATE_PREMIUM_PENCE
 * in server/stripe-routes.ts (the server re-derives the charge authoritatively).
 */
export const VISIT_SET_DATE_PREMIUM_PENCE = 1000; // £10

/** Days the flexible lane commits to visiting within. */
export const VISIT_FLEX_WINDOW_DAYS = 7;
