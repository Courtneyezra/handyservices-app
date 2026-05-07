# ADR-005: Real-Work-Time vs Pricing-Time Separation

**Status:** stub — to be written in Wave 2
**Depends on:** —

## Purpose

Decouple `pricing_time_minutes` (used by EVE for customer £) from `real_work_minutes` (used by ops/routing/contractor pay). Pricing engine currently inflates time to justify £/hr — breaks downstream.

## Sections (placeholder)

- Context
- The inflation problem
- Decision
- Schema impact
- Migration plan
- Consequences

## Reference

- See `master-plan.md` section "What this is" (problem 2)
- See `data-model.md`
- See `modules/02-job-tagging.md`
