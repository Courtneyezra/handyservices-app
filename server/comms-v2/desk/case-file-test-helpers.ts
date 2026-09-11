/** Re-exports for the case-file tests, plus the one narrowed identity type they build fixtures from. */
export * from './case-file';
import type { ResolveResult } from './identity';
export type ResolveOk = Extract<ResolveResult, { ok: true }>;
