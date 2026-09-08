/**
 * THE REGISTRY TEST (0.2, 8 Sep 2026) — "no customer send exists outside the registry".
 *
 * This is the item's real deliverable; everything else in it is bookkeeping without this file.
 * It is the check that stays true after the people who wrote 0.2 have moved on: it walks the
 * source tree, finds every place a customer message can leave, and asserts each one is a
 * REGISTERED sender or is the gate itself.
 *
 * Three separate claims, because they fail for three different reasons:
 *
 *   1. The registry is complete and self-consistent (every approver has a row, transactional rows
 *      carry no switch, every other row does, switch keys are unique).
 *   2. Every call site of `sendCustomerMessage` names an approver the registry knows. A string
 *      literal must be in the enum; an indirect expression must be one of the handful listed here,
 *      so a NEW indirection is a failing test and a decision, not a silent hole.
 *   3. The two wire functions are called only from the gate, and the gate really does consult the
 *      registry before it sends.
 *
 * Pure file reads plus one import of the registry module (no db, no network: sender-registry.ts
 * imports only ./approver and a type). Same scanner idiom as architecture.test.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AUTOMATED_APPROVERS } from '../approver';
import { SENDER_REGISTRY, registryEntryFor, senderSwitchKeys, HUMAN_SENDER, CONTRACTOR_SENDER } from '../sender-registry';

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

// ---------------------------------------------------------------- scanner

function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
                walk(full);
            } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
                out.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
            }
        }
    };
    walk(dir);
    return out.sort();
}

/**
 * Strip comments, keep string contents. Same character walk as architecture.test.ts, and needed
 * for the same reason: `server/tenant-issues.ts` mentions sendWhatsAppMessage in a "in a real
 * implementation you would…" comment, and a scanner that counts that as a call cries wolf.
 */
function stripComments(source: string): string {
    let out = '';
    let i = 0;
    const n = source.length;
    while (i < n) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') { while (i < n && source[i] !== '\n') i++; continue; }
        if (c === '/' && next === '*') { i += 2; while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            out += c; i++;
            while (i < n && source[i] !== quote) {
                if (source[i] === '\\') { out += source[i]; i++; }
                if (i < n) { out += source[i]; i++; }
            }
            if (i < n) { out += source[i]; i++; }
            continue;
        }
        out += c; i++;
    }
    return out;
}

const SERVER_FILES = listTsFiles(SERVER_ROOT);
const cache = new Map<string, string>();
function src(rel: string): string {
    let c = cache.get(rel);
    if (c === undefined) {
        c = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
        cache.set(rel, c);
    }
    return c;
}

/** Every `sendCustomerMessage({ … })` in the tree, with the approver expression as written. */
interface GateCall { file: string; line: number; approver: string }

function gateCalls(): GateCall[] {
    const out: GateCall[] = [];
    for (const file of SERVER_FILES) {
        if (file === 'server/outbound.ts') continue;   // the gate is not a caller of itself
        const s = src(file);
        const re = /sendCustomerMessage\(\s*\{/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s))) {
            // Brace-match the object literal so a nested object cannot end the block early.
            let i = re.lastIndex - 1;
            let depth = 0;
            for (; i < s.length; i++) {
                if (s[i] === '{') depth++;
                else if (s[i] === '}') { depth--; if (depth === 0) break; }
            }
            const block = s.slice(m.index, i + 1);
            // `approver: <expr>` or the shorthand `approver,` / `approver }`.
            const named = block.match(/\bapprover:\s*([^,\n]+)/);
            const shorthand = /\bapprover\s*[,}]/.test(block);
            const approver = named ? named[1].trim() : shorthand ? 'approver' : '';
            out.push({ file, line: s.slice(0, m.index).split('\n').length, approver });
        }
    }
    return out;
}

/**
 * Approver expressions that are NOT a literal: a value passed in, or a constant defined elsewhere.
 * Each is listed with the reason it is safe — in every case the value is typed `Approver`, so it
 * can only ever hold a name the registry covers, and the gate's runtime check catches the JS-shaped
 * caller the type cannot see.
 *
 * A new entry appearing here is a new indirection and should be read before it is added.
 */
const ALLOWED_INDIRECT_APPROVERS: Record<string, string> = {
    'approver': 'approveAndSendDraft, the price screen and the variation route pass the Approver they were given',
    'input.approver': 'contractor-relay: the contractor:<id> the route resolved',
    'options.approver': 'conversationEngine.sendMessage: the Approver its caller named',
    'JOB_PACK_APPROVER': "server/spine/job-pack-notify.ts — the constant 'rules.job_pack'",
};

const isHumanExpr = (e: string) => /^humanApprover\(/.test(e) || /^`human:/.test(e) || /^'human:/.test(e);
const isContractorExpr = (e: string) => /^`contractor:/.test(e) || /^'contractor:/.test(e);
const literalOf = (e: string) => (/^'([^']+)'$/.exec(e) ?? /^"([^"]+)"$/.exec(e))?.[1] ?? null;

// ---------------------------------------------------------------- 1. the registry itself

describe('the sender registry is complete and self-consistent', () => {
    it('every automated approver has an entry', () => {
        const missing = AUTOMATED_APPROVERS.filter((a) => !(a in SENDER_REGISTRY));
        expect(missing, 'an approver with no registry row cannot send').toEqual([]);
    });

    it('the registry names nothing that is not an approver', () => {
        const extra = Object.keys(SENDER_REGISTRY).filter((k) => !(AUTOMATED_APPROVERS as readonly string[]).includes(k));
        expect(extra).toEqual([]);
    });

    it('a transactional sender carries NO switch key — turning one off would silently break a paid job', () => {
        const switchable = Object.entries(SENDER_REGISTRY)
            .filter(([, e]) => e.kind === 'transactional' && e.switchKey !== null)
            .map(([a]) => a);
        expect(switchable).toEqual([]);
        expect(HUMAN_SENDER.switchKey).toBeNull();
        expect(CONTRACTOR_SENDER.switchKey).toBeNull();
    });

    it('every operational and agent sender HAS a switch key, and no two share one', () => {
        const unswitchable = Object.entries(SENDER_REGISTRY)
            .filter(([, e]) => e.kind !== 'transactional' && !e.switchKey)
            .map(([a]) => a);
        expect(unswitchable).toEqual([]);
        const keys = senderSwitchKeys();
        expect(keys.length).toBe(new Set(keys).size);
    });

    it('the three senders a paid job depends on are transactional: they all send as system.notification', () => {
        // The booking confirmation (email-service → conversation-engine), the job-lifecycle
        // notifications (customer-notifications) and the Twilio failure-recovery SMS (whatsapp-api)
        // all carry this one name — s29 finding 1.16.
        expect(SENDER_REGISTRY['system.notification'].kind).toBe('transactional');
        expect(SENDER_REGISTRY['system.notification'].switchKey).toBeNull();
        expect(SENDER_REGISTRY['system.notification'].purpose).toBe('service_reply');
    });

    it('a person and a contractor are registered, with no registered purpose of their own', () => {
        expect(registryEntryFor('human:ben@handyservices.app')).toBe(HUMAN_SENDER);
        expect(registryEntryFor('contractor:hp_1')).toBe(CONTRACTOR_SENDER);
        // Only the call site knows whether a person is answering or starting something, so the
        // gate's fail-closed 'marketing' default still applies to one that says nothing.
        expect(HUMAN_SENDER.purpose).toBeNull();
        expect(CONTRACTOR_SENDER.purpose).toBeNull();
    });

    it('an unregistered name gets nothing', () => {
        expect(registryEntryFor('agent.rogue')).toBeNull();
        expect(registryEntryFor('human:')).toBeNull();
        expect(registryEntryFor('contractor:')).toBeNull();
        expect(registryEntryFor('')).toBeNull();
        expect(registryEntryFor(undefined)).toBeNull();
        expect(registryEntryFor(42)).toBeNull();
    });
});

// ---------------------------------------------------------------- 2. every call site of the gate

describe('every caller of sendCustomerMessage names a registered sender', () => {
    const calls = gateCalls();

    it('found the call sites at all (a scanner that matches nothing proves nothing)', () => {
        expect(calls.length).toBeGreaterThan(20);
        expect(calls.every((c) => !!c.approver), `a call site with no approver: ${JSON.stringify(calls.filter((c) => !c.approver))}`).toBe(true);
    });

    it('every string-literal approver is in the registry', () => {
        const unregistered = calls
            .map((c) => ({ ...c, literal: literalOf(c.approver) }))
            .filter((c) => c.literal !== null && !(c.literal! in SENDER_REGISTRY))
            .map((c) => `${c.file}:${c.line} → ${c.literal}`);
        expect(unregistered, 'add the sender to server/sender-registry.ts, saying what it is for').toEqual([]);
    });

    it('every non-literal approver is a known indirection', () => {
        const unknown = calls
            .filter((c) => literalOf(c.approver) === null && !isHumanExpr(c.approver) && !isContractorExpr(c.approver))
            .filter((c) => !(c.approver in ALLOWED_INDIRECT_APPROVERS))
            .map((c) => `${c.file}:${c.line} → ${c.approver}`);
        expect(unknown, 'a new way of naming a sender: read it, then list it in ALLOWED_INDIRECT_APPROVERS').toEqual([]);
    });

    it('the allowlist has no dead entries', () => {
        const used = new Set(calls.map((c) => c.approver));
        expect(Object.keys(ALLOWED_INDIRECT_APPROVERS).filter((k) => !used.has(k))).toEqual([]);
    });
});

// ---------------------------------------------------------------- 3. the wire, and the gate

describe('the wire is reachable only from the gate, and the gate consults the registry', () => {
    /** A call of `name(` that is not a definition and not a property access. */
    const invokes = (rel: string, name: string) => new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(src(rel));

    it('sendWhatsAppMessage is invoked only by outbound.ts and its own module', () => {
        const callers = SERVER_FILES.filter((f) => f !== 'server/meta-whatsapp.ts' && invokes(f, 'sendWhatsAppMessage'));
        expect(callers).toEqual(['server/outbound.ts']);
    });

    it('sendSmsMessage is invoked only by outbound.ts and its own module', () => {
        const callers = SERVER_FILES.filter((f) => f !== 'server/sms.ts' && invokes(f, 'sendSmsMessage'));
        expect(callers).toEqual(['server/outbound.ts']);
    });

    it('the composer no longer imports the wire function (0.2 part B: the last bypass)', () => {
        expect(src('server/whatsapp-api.ts')).not.toMatch(/from ["']\.\/meta-whatsapp["']/);
    });

    it('outbound.ts refuses an unregistered approver and applies the registered purpose', () => {
        const gate = src('server/outbound.ts');
        expect(gate).toMatch(/from '\.\/sender-registry'/);
        expect(gate).toMatch(/registryEntryFor\(approver\)/);
        expect(gate).toMatch(/SENDER_NOT_REGISTERED/);
        expect(gate).toMatch(/isSenderEnabled\(sender\.switchKey\)/);
        expect(gate).toMatch(/input\.purpose \?\? sender\.purpose \?\? 'marketing'/);
    });

    it('the booking confirmation passes the transactional purpose (0.2 part C)', () => {
        // S27 §3.1 A6 / §7.3: it passed none, so the gate read it as marketing and a plain STOP
        // blocked a paying customer's confirmation.
        const email = src('server/email-service.ts');
        const block = email.slice(email.indexOf('sendBookingConfirmationWhatsApp'));
        expect(block.slice(0, block.indexOf('\n}\n'))).toMatch(/purpose: 'service_reply'/);
    });
});
