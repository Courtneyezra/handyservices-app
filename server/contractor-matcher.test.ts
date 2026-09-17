/**
 * Anyone can sign up and switch on a public profile, but only a contractor an admin has activated is
 * ever put in front of a customer: the quote matcher, the location ranking and the site-visit
 * placeholder all refuse a contractor with no activation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
    skills: [] as Row[],
    profiles: [] as Row[],
    users: [] as Row[],
    findManyWheres: [] as unknown[],
}));

vi.mock('./db', async () => {
    const schema = await import('../shared/schema');
    const rowsFor = (table: unknown): Row[] => {
        if (table === schema.handymanSkills) return state.skills;
        if (table === schema.handymanProfiles) return state.profiles;
        if (table === schema.users) return state.users;
        return [];
    };
    const selectChain = (): any => {
        let table: unknown;
        const p: any = { then: (ok: any, err: any) => Promise.resolve().then(() => rowsFor(table)).then(ok, err) };
        p.from = (t: unknown) => { table = t; return p; };
        for (const m of ['where', 'innerJoin', 'leftJoin', 'orderBy', 'limit']) p[m] = () => p;
        return p;
    };
    return {
        db: {
            select: () => selectChain(),
            query: {
                handymanProfiles: {
                    findMany: async (opts: { where?: unknown }) => { state.findManyWheres.push(opts.where); return []; },
                },
            },
        },
    };
});

import { findCandidateContractors } from './contractor-matcher';
import { findBestContractors } from './availability-engine';

const profile = (id: string, over: Row = {}): Row => ({
    id, userId: `user-${id}`, latitude: null, longitude: null, radiusMiles: 10,
    verificationStatus: 'unverified', publicProfileEnabled: false, activatedAt: null,
    ...over,
});

beforeEach(() => {
    state.skills = [];
    state.profiles = [];
    state.users = [];
    state.findManyWheres = [];
});

function seed(...profiles: Row[]) {
    state.profiles = profiles;
    state.skills = profiles.map((p) => ({ handymanId: p.id, categorySlug: 'shelving', proficiency: 'competent' }));
    state.users = profiles.map((p) => ({ id: p.userId, firstName: p.id, lastName: 'Test' }));
}

const matchedIds = async () =>
    (await findCandidateContractors({ categorySlugs: ['shelving'] })).candidates.map((c) => c.contractorId).sort();

describe('findCandidateContractors', () => {
    it('never matches a self-signed-up contractor with a public profile who is not activated', async () => {
        seed(profile('selfsignup', { publicProfileEnabled: true }));
        const result = await findCandidateContractors({ categorySlugs: ['shelving'] });
        expect(result.candidates).toEqual([]);
        expect(result.uncoveredCategories).toEqual(['shelving']);
    });

    it('never matches a verified contractor who is not activated (deactivated)', async () => {
        seed(profile('deactivated', { verificationStatus: 'verified', publicProfileEnabled: true }));
        expect(await matchedIds()).toEqual([]);
    });

    it('still matches an activated contractor with a public profile, or verified', async () => {
        const at = new Date('2026-09-01T00:00:00Z');
        seed(
            profile('public', { publicProfileEnabled: true, activatedAt: at }),
            profile('verified', { verificationStatus: 'verified', activatedAt: at }),
            profile('selfsignup', { publicProfileEnabled: true }),
        );
        expect(await matchedIds()).toEqual(['public', 'verified']);
    });

    it('activation alone is not enough: an activated contractor needs a public profile or verification', async () => {
        seed(profile('bare', { activatedAt: new Date() }));
        expect(await matchedIds()).toEqual([]);
    });
});

describe('findBestContractors', () => {
    it('asks only for public profiles an admin has activated', async () => {
        await findBestContractors({ lat: 52.95, lng: -1.15 });
        const q = new PgDialect().sqlToQuery(state.findManyWheres[0] as SQL);
        expect(q.sql).toContain('"public_profile_enabled" =');
        expect(q.sql).toContain('"activated_at" is not null');
    });
});
