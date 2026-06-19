/**
 * Dispatch TEST-MODE isolation — the single source of truth for what counts as a
 * "dummy" dispatch job and how the pool/write-paths must fence test work off from
 * real, paid customer work.
 *
 * SAFETY CONTRACT (do not weaken):
 *  - Seeded dummy jobs have a quote id starting with `TEST_QUOTE_PREFIX`. No real
 *    quote id uses this prefix, so the prefix is an exact, collision-free marker.
 *  - Pool loaders take a `testOnly` flag:
 *      testOnly === true   → include ONLY ids LIKE 'test_q_flex_%'
 *      testOnly falsy (DEFAULT) → EXCLUDE ids LIKE 'test_q_flex_%' (real jobs only)
 *    The DEFAULT-EXCLUDE is the critical guarantee: seeded dummies are INVISIBLE in
 *    the normal (real) console, and a real run can never surface a dummy.
 *  - The booking write-path (/dispatch-run) uses `isTestQuoteId` as a hard guard:
 *    the real path books only NON-test ids; the test path books only test ids. A
 *    dummy can never be booked from the real path, and a real job can never be
 *    booked from the test path.
 */

/** Prefix marking a seeded test/dummy flexible-pool quote. FROZEN — seed + UI rely on it. */
export const TEST_QUOTE_PREFIX = 'test_q_flex_';

/** SQL LIKE pattern for the test prefix (centralised so every query matches identically). */
export const TEST_QUOTE_LIKE = `${TEST_QUOTE_PREFIX}%`;

/** True iff `id` is a seeded test/dummy quote id (starts with TEST_QUOTE_PREFIX). */
export function isTestQuoteId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(TEST_QUOTE_PREFIX);
}
