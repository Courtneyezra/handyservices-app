/**
 * Handy Desk - where the ask agent's sessions and messages live: comms_v2_ask_sessions and
 * comms_v2_ask_messages (migrations/20260917_comms_v2_ask_sessions.sql), on the app's database,
 * shaped on the wire as OpsSessionDTO and AskMessageDTO (shared/ops-types.ts). One session per
 * person per London day. A memory store stands in for tests.
 */
import { randomUUID } from 'node:crypto';
import type { AskContext, AskMessageDTO, AskVia, LeanRunStep, OpsAnswer, OpsSessionDTO } from '@shared/ops-types';

/** The London calendar day, YYYY-MM-DD: "one session per day" is Ben's day, not UTC's. */
export function londonDay(at: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function dayTitle(at: Date): string {
    return `Handy Desk, ${at.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' })}`;
}

export interface NewAskMessage {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    via?: AskVia | null;
    context?: AskContext | null;
    runId?: string | null;
    transcript?: LeanRunStep[] | null;
    answer?: OpsAnswer | null;
    usage?: unknown;
}

export interface AskSessionStore {
    /** The person's active session for the day, created when there is none. */
    forDay(person: string, day: string, title: string): Promise<OpsSessionDTO>;
    create(person: string, day: string, title: string): Promise<OpsSessionDTO>;
    /** The person's active sessions, newest first. */
    list(person: string, limit: number): Promise<OpsSessionDTO[]>;
    get(id: string): Promise<{ session: OpsSessionDTO; messages: AskMessageDTO[] } | null>;
    append(message: NewAskMessage): Promise<AskMessageDTO>;
    touch(id: string): Promise<void>;
    archive(id: string): Promise<OpsSessionDTO | null>;
}

interface SessionRecord { id: string; title: string; createdBy: string; day: string; status: 'active' | 'archived'; createdAt: Date; updatedAt: Date }

function sessionDTO(r: SessionRecord): OpsSessionDTO {
    return { id: r.id, title: r.title, createdBy: r.createdBy, status: r.status, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

function messageDTO(r: { id: string; sessionId: string; role: string; content: string; via: string | null; askContext: unknown; runId: string | null; transcript: unknown; answer: unknown; usage: unknown; createdAt: Date }): AskMessageDTO {
    const via = r.via === 'typed' || r.via === 'voice' || r.via === 'tap' ? r.via : null;
    return {
        id: r.id,
        sessionId: r.sessionId,
        role: r.role === 'assistant' ? 'assistant' : 'user',
        content: r.content,
        via,
        context: (r.askContext as AskContext | null) ?? null,
        runId: r.runId,
        transcript: (r.transcript as LeanRunStep[] | null) ?? null,
        answer: (r.answer as OpsAnswer | null) ?? null,
        usage: r.usage ?? null,
        createdAt: r.createdAt.toISOString(),
    };
}

export class MemoryAskSessionStore implements AskSessionStore {
    private sessions = new Map<string, SessionRecord>();
    private messages: Array<Parameters<typeof messageDTO>[0]> = [];
    private tick = 0;
    constructor(private readonly clock: () => Date = () => new Date()) {}
    private at(): Date { return new Date(this.clock().getTime() + this.tick++); }

    async forDay(person: string, day: string, title: string) {
        const found = Array.from(this.sessions.values()).filter((s) => s.createdBy === person && s.day === day && s.status === 'active').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return found ? sessionDTO(found) : this.create(person, day, title);
    }
    async create(person: string, day: string, title: string) {
        const at = this.at();
        const r: SessionRecord = { id: randomUUID(), title, createdBy: person, day, status: 'active', createdAt: at, updatedAt: at };
        this.sessions.set(r.id, r);
        return sessionDTO(r);
    }
    async list(person: string, limit: number) {
        return Array.from(this.sessions.values()).filter((s) => s.createdBy === person && s.status === 'active').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map(sessionDTO);
    }
    async get(id: string) {
        const s = this.sessions.get(id);
        if (!s) return null;
        return { session: sessionDTO(s), messages: this.messages.filter((m) => m.sessionId === id).map(messageDTO) };
    }
    async append(m: NewAskMessage) {
        const row = { id: randomUUID(), sessionId: m.sessionId, role: m.role, content: m.content, via: m.via ?? null, askContext: m.context ?? null, runId: m.runId ?? null, transcript: m.transcript ?? null, answer: m.answer ?? null, usage: m.usage ?? null, createdAt: this.at() };
        this.messages.push(row);
        return messageDTO(row);
    }
    async touch(id: string) {
        const s = this.sessions.get(id);
        if (s) s.updatedAt = this.at();
    }
    async archive(id: string) {
        const s = this.sessions.get(id);
        if (!s) return null;
        s.status = 'archived';
        s.updatedAt = this.at();
        return sessionDTO(s);
    }
}

async function tables() {
    const { db } = await import('../../db');
    const schema = await import('@shared/schema');
    const orm = await import('drizzle-orm');
    return { db, s: schema.commsV2AskSessions, m: schema.commsV2AskMessages, ...orm };
}

function statusOf(v: string): 'active' | 'archived' {
    return v === 'archived' ? 'archived' : 'active';
}

export const databaseAskSessionStore: AskSessionStore = {
    async forDay(person, day, title) {
        const { db, s, and, eq, desc } = await tables();
        const [row] = await db.select().from(s).where(and(eq(s.createdBy, person), eq(s.day, day), eq(s.status, 'active'))).orderBy(desc(s.createdAt)).limit(1);
        return row ? sessionDTO({ ...row, status: statusOf(row.status) }) : this.create(person, day, title);
    },
    async create(person, day, title) {
        const { db, s } = await tables();
        const [row] = await db.insert(s).values({ id: randomUUID(), title, createdBy: person, day, status: 'active' }).returning();
        return sessionDTO({ ...row, status: statusOf(row.status) });
    },
    async list(person, limit) {
        const { db, s, and, eq, desc } = await tables();
        const rows = await db.select().from(s).where(and(eq(s.createdBy, person), eq(s.status, 'active'))).orderBy(desc(s.createdAt)).limit(limit);
        return rows.map((r) => sessionDTO({ ...r, status: statusOf(r.status) }));
    },
    async get(id) {
        const { db, s, m, eq, asc } = await tables();
        const [row] = await db.select().from(s).where(eq(s.id, id));
        if (!row) return null;
        const msgs = await db.select().from(m).where(eq(m.sessionId, id)).orderBy(asc(m.createdAt));
        return { session: sessionDTO({ ...row, status: statusOf(row.status) }), messages: msgs.map(messageDTO) };
    },
    async append(msg) {
        const { db, m } = await tables();
        const [row] = await db.insert(m).values({
            id: randomUUID(), sessionId: msg.sessionId, role: msg.role, content: msg.content, via: msg.via ?? null,
            askContext: msg.context ?? null, runId: msg.runId ?? null, transcript: msg.transcript ?? null, answer: msg.answer ?? null, usage: msg.usage ?? null,
        }).returning();
        return messageDTO(row);
    },
    async touch(id) {
        const { db, s, eq } = await tables();
        await db.update(s).set({ updatedAt: new Date() }).where(eq(s.id, id));
    },
    async archive(id) {
        const { db, s, eq } = await tables();
        const [row] = await db.update(s).set({ status: 'archived', updatedAt: new Date() }).where(eq(s.id, id)).returning();
        return row ? sessionDTO({ ...row, status: statusOf(row.status) }) : null;
    },
};
