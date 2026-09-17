/**
 * Contractor desk skills - a tick list of categories, each with a proficiency.
 *
 * The categories are the fixed slugs of `CATEGORY_LABELS` in shared/categories.ts. A skill is one
 * `handyman_skills` row per contractor per category (unique index, migration
 * 20260917_handyman_skills_unique_slug.sql). The per-skill hourly and day rates are money and are
 * neither returned nor written here: an upsert sets the proficiency only.
 */
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { handymanProfiles, handymanSkills } from '../../shared/schema';
import { CATEGORY_LABELS, getTradeForCategory, type BroadTradeId, type JobCategory } from '../../shared/categories';

export const PROFICIENCIES = ['basic', 'competent', 'expert'] as const;
export type Proficiency = typeof PROFICIENCIES[number];

export interface DeskCategory {
  slug: JobCategory;
  label: string;
  /** The broad trade the category sits under; null for 'other'. */
  trade: BroadTradeId | null;
}

export interface DeskSkill extends DeskCategory {
  proficiency: Proficiency;
}

export function deskCategories(): DeskCategory[] {
  return (Object.keys(CATEGORY_LABELS) as JobCategory[]).map(describeCategory);
}

function describeCategory(slug: JobCategory): DeskCategory {
  return { slug, label: CATEGORY_LABELS[slug], trade: getTradeForCategory(slug) };
}

export function isCategorySlug(value: unknown): value is JobCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value);
}

export function isProficiency(value: unknown): value is Proficiency {
  return typeof value === 'string' && (PROFICIENCIES as readonly string[]).includes(value);
}

/** A stored proficiency outside the three (old rows, a null) reads as the column default. */
export function asProficiency(value: string | null | undefined): Proficiency {
  return isProficiency(value) ? value : 'competent';
}

export interface StoredSkillRow {
  categorySlug: string | null;
  proficiency: string | null;
}

/** Stored rows as the page sees them: known categories only, in the category list's order. */
export function shapeSkills(rows: StoredSkillRow[]): DeskSkill[] {
  const bySlug = new Map<string, Proficiency>();
  for (const r of rows) {
    if (isCategorySlug(r.categorySlug) && !bySlug.has(r.categorySlug)) bySlug.set(r.categorySlug, asProficiency(r.proficiency));
  }
  return deskCategories()
    .filter((c) => bySlug.has(c.slug))
    .map((c) => ({ ...c, proficiency: bySlug.get(c.slug)! }));
}

/** Keeps the last entry for each category slug, so a replace-all write cannot hit the unique index. */
export function lastPerSlug<T extends { categorySlug?: string | null }>(skills: T[]): T[] {
  const bySlug = new Map<string, T>();
  const noSlug: T[] = [];
  for (const s of skills) {
    if (s.categorySlug) {
      bySlug.delete(s.categorySlug);
      bySlug.set(s.categorySlug, s);
    } else {
      noSlug.push(s);
    }
  }
  return [...noSlug, ...Array.from(bySlug.values())];
}

export interface SkillStore {
  contractorExists(id: string): Promise<boolean>;
  list(contractorId: string): Promise<StoredSkillRow[]>;
  /** Sets the proficiency, adding the row when absent. Returns whether the row was added. */
  upsert(contractorId: string, slug: JobCategory, proficiency: Proficiency): Promise<{ created: boolean }>;
  /** Returns whether a row was removed. */
  remove(contractorId: string, slug: JobCategory): Promise<{ removed: boolean }>;
}

export const dbSkillStore: SkillStore = {
  async contractorExists(id) {
    const rows = await db.select({ id: handymanProfiles.id }).from(handymanProfiles).where(eq(handymanProfiles.id, id)).limit(1);
    return rows.length > 0;
  },

  async list(contractorId) {
    return db
      .select({ categorySlug: handymanSkills.categorySlug, proficiency: handymanSkills.proficiency })
      .from(handymanSkills)
      .where(and(eq(handymanSkills.handymanId, contractorId), isNotNull(handymanSkills.categorySlug)))
      .orderBy(asc(handymanSkills.id));
  },

  async upsert(contractorId, slug, proficiency) {
    const rows = await db
      .insert(handymanSkills)
      .values({ id: uuidv4(), handymanId: contractorId, categorySlug: slug, proficiency })
      .onConflictDoUpdate({
        target: [handymanSkills.handymanId, handymanSkills.categorySlug],
        set: { proficiency },
      })
      // xmax is 0 only on a freshly inserted row version.
      .returning({ created: sql<boolean>`(xmax = 0)` });
    return { created: rows[0]?.created === true };
  },

  async remove(contractorId, slug) {
    const rows = await db
      .delete(handymanSkills)
      .where(and(eq(handymanSkills.handymanId, contractorId), eq(handymanSkills.categorySlug, slug)))
      .returning({ id: handymanSkills.id });
    return { removed: rows.length > 0 };
  },
};
