/**
 * A calendar-day availability override is a PURE DATE ("Craig is off on 5 Aug"),
 * not an instant. Store it at UTC midnight so every reader buckets it onto the
 * SAME calendar day regardless of the server's local timezone:
 *
 *  - the customer booking engine (`isContractorAvailableForSlot`) queries by
 *    UTC calendar day, and
 *  - the contractor app grid reads the same rows.
 *
 * The historical bug: writers built the date with `new Date(`${date}T00:00:00`)`
 * or `.setHours(0,0,0,0)` — LOCAL midnight. On a non-UTC server (e.g. the UTC+7
 * dev box) that lands 7h early, on the PREVIOUS UTC day, so the two readers
 * disagreed about which day the override belonged to.
 *
 * Always funnel availability-date writes through this so "5 Aug" means one
 * instant everywhere. Accepts a 'YYYY-MM-DD' string (the common case) or a Date.
 */
export function availabilityDayUTC(input: string | Date): Date {
  const s = typeof input === 'string' ? input : input.toISOString();
  const dayStr = s.slice(0, 10); // YYYY-MM-DD
  return new Date(`${dayStr}T00:00:00.000Z`);
}
