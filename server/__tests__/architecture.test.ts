/**
 * Architecture tests — Phase 0 of the comms rebuild ("Close the doors", COMMS_AGENTS_V3_DESIGN §10).
 *
 * Pure file reads. No database, no imports of server modules. Each test states a structural rule
 * that the 31 Aug–2 Sep incident showed we need, and reads the source tree to check it still holds.
 *
 * Tests marked PHASE0_MERGED depend on the other two Phase 0 branches (exit guard, worker gate).
 * They are skipped until `PHASE0_MERGED=1` is set, so this file is green on its own branch today
 * and becomes the merge gate afterwards.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const merged = Boolean(process.env.PHASE0_MERGED);

// ---------------------------------------------------------------- scanner

/** Every .ts file under `dir`, repo-relative with forward slashes, excluding tests and deps. */
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
 * Strip comments but keep string contents intact (a URL inside a string carries `//`).
 * TS-agnostic character walk: tracks ' " ` strings and line/block comments. Template literal
 * `${}` nesting is not modelled — good enough for these rules, which never depend on it.
 */
function stripComments(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const next = src[i + 1];
        if (c === '/' && next === '/') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            out += c;
            i++;
            while (i < n && src[i] !== quote) {
                if (src[i] === '\\') { out += src[i]; i++; }
                if (i < n) { out += src[i]; i++; }
            }
            if (i < n) { out += src[i]; i++; }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

const cache = new Map<string, string>();
function code(rel: string): string {
    let c = cache.get(rel);
    if (c === undefined) {
        c = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
        cache.set(rel, c);
    }
    return c;
}

/** Module specifiers of every static, dynamic and require() import in the file. */
function importSpecifiers(rel: string): string[] {
    const c = code(rel);
    const specs: string[] = [];
    for (const m of c.matchAll(/\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) specs.push(m[1]);
    for (const m of c.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
    for (const m of c.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
    return specs;
}

const ident = (name: string) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`);

/** True if the file binds `name` from an import (static named import or destructured dynamic import). */
function importsSymbol(rel: string, name: string): boolean {
    const c = code(rel);
    const staticNamed = new RegExp(`\\bimport\\s*(?:type\\s*)?\\{[^}]*(?<![\\w$])${name}(?![\\w$])[^}]*\\}\\s*from\\s*['"]`, 's');
    const dynamicDestructured = new RegExp(`\\{[^}]*(?<![\\w$])${name}(?![\\w$])[^}]*\\}\\s*=\\s*await\\s+import\\(`, 's');
    return staticNamed.test(c) || dynamicDestructured.test(c);
}

function definesExport(rel: string, name: string): boolean {
    return new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${name}(?![\\w$])`).test(code(rel));
}

const SERVER_FILES = listTsFiles(SERVER_ROOT);
const AGENT_FILES = SERVER_FILES.filter((f) => f.startsWith('server/agents/'));

// ---------------------------------------------------------------- (a) V2 routing gone from agents

describe.skipIf(!merged)('(a) V2 pipeline routing is gone from server/agents [PHASE0_MERGED]', () => {
    it.each(['shouldUseV2', 'sendV2Reply'])('%s does not appear under server/agents', (name) => {
        const hits = AGENT_FILES.filter((f) => ident(name).test(code(f)));
        expect(hits, `${name} still referenced in agents`).toEqual([]);
    });
});

// ---------------------------------------------------------------- (b) approveAndSendDraft importers

const APPROVE_AND_SEND_ALLOWED = [
    'server/agents/comms.ts',
    'server/agents/comms-sweep.ts',
    'server/agents/sla-sweep.ts',
    'server/agents/promise-tracker.ts',
    'server/auto-ack-window.ts',
    'server/first-contact-ack.ts',
    'server/outbound.ts',
    'server/agent-staff.ts',
].sort();

function approveAndSendImporters(): string[] {
    return SERVER_FILES.filter((f) => importsSymbol(f, 'approveAndSendDraft'));
}

describe('(b) approveAndSendDraft is imported only by the allowed callers', () => {
    it('is defined in exactly one module, server/message-drafts.ts', () => {
        const definers = SERVER_FILES.filter((f) => definesExport(f, 'approveAndSendDraft'));
        expect(definers).toEqual(['server/message-drafts.ts']);
    });

    it('no file outside the allowed list imports it', () => {
        const outside = approveAndSendImporters().filter((f) => !APPROVE_AND_SEND_ALLOWED.includes(f));
        expect(outside).toEqual([]);
    });

    it('every reference outside the definer is a recognised import (no namespace/alias smuggling)', () => {
        const smuggled = SERVER_FILES.filter(
            (f) => f !== 'server/message-drafts.ts'
                && ident('approveAndSendDraft').test(code(f))
                && !importsSymbol(f, 'approveAndSendDraft')
        );
        expect(smuggled).toEqual([]);
    });

    describe.skipIf(!merged)('[PHASE0_MERGED]', () => {
        // The brief's allowed list above was built with a plain grep, which also counts the four
        // files that mention approveAndSendDraft only in comments (promise-tracker, outbound,
        // auto-ack-window, agent-staff). Real importers on 2 Sep 2026 are these four. If the
        // exit-guard branch migrates any of them to sendCustomerMessage, shrink this list.
        const EXPECTED_IMPORTERS_AFTER_MERGE = [
            'server/agents/comms.ts',
            'server/agents/comms-sweep.ts',
            'server/agents/sla-sweep.ts',
            'server/first-contact-ack.ts',
        ].sort();
        it('the importer set is exactly the expected list', () => {
            expect(approveAndSendImporters().sort()).toEqual(EXPECTED_IMPORTERS_AFTER_MERGE);
        });
    });
});

// ---------------------------------------------------------------- (c) Twilio / Meta send primitives

/**
 * Two layers. The wrapper layer is the module-level send functions; the raw layer is the actual
 * HTTP/SDK call to Twilio or Meta. Both must funnel through the three choke points.
 */
const SEND_ALLOWED_CALLERS = ['server/outbound.ts', 'server/whatsapp-api.ts', 'server/sms.ts'];

const WRAPPERS: Array<{ name: string; definedIn: string }> = [
    { name: 'sendWhatsAppMessage', definedIn: 'server/meta-whatsapp.ts' },
    { name: 'sendViaMetaCloudApi', definedIn: 'server/meta-whatsapp.ts' },
    { name: 'sendSmsMessage', definedIn: 'server/sms.ts' },
];

function callsWrapper(rel: string, name: string): boolean {
    return new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(code(rel));
}

describe('(c) Twilio/Meta send wrappers are called only from the choke points', () => {
    it.each(WRAPPERS)('$name is defined in $definedIn', ({ name, definedIn }) => {
        const definers = SERVER_FILES.filter((f) => definesExport(f, name));
        expect(definers).toEqual([definedIn]);
    });

    it.each(WRAPPERS)('$name is invoked only from outbound.ts, whatsapp-api.ts, sms.ts (or its own module)', ({ name, definedIn }) => {
        const callers = SERVER_FILES.filter((f) => f !== definedIn && callsWrapper(f, name));
        const outside = callers.filter((f) => !SEND_ALLOWED_CALLERS.includes(f));
        expect(outside).toEqual([]);
    });
});

/** Files that talk to the Twilio Messages API or the Meta Graph /messages endpoint directly. */
function rawTwilioSenders(): string[] {
    return SERVER_FILES.filter((f) => {
        const c = code(f);
        const usesTwilioClient = /\.messages\.create\s*\(/.test(c)
            && importSpecifiers(f).some((s) => s === 'twilio' || /twilio-client$/.test(s));
        const usesTwilioRest = /api\.twilio\.com\/2010-04-01\/Accounts\/[^'"`]*\/Messages\.json/.test(c);
        return usesTwilioClient || usesTwilioRest;
    });
}
function rawMetaSenders(): string[] {
    return SERVER_FILES.filter((f) => {
        const c = code(f);
        return /graph\.facebook\.com/.test(c) && /\/messages`/.test(c);
    });
}

describe.skipIf(!merged)('(c) raw Twilio/Meta message primitives live only in sms.ts and meta-whatsapp.ts [PHASE0_MERGED]', () => {
    // Known open door at branch time: server/conversation-engine.ts calls twilioClient.messages.create
    // (reached from server/email-service.ts via conversationEngine.sendMessage). Expected to close
    // in the exit-guard branch; this test is the check that it did.
    it('Twilio Messages API is used only by sms.ts and meta-whatsapp.ts', () => {
        expect(rawTwilioSenders().sort()).toEqual(['server/meta-whatsapp.ts', 'server/sms.ts']);
    });
    it('Meta Graph /messages is used only by meta-whatsapp.ts', () => {
        expect(rawMetaSenders()).toEqual(['server/meta-whatsapp.ts']);
    });
});

// ---------------------------------------------------------------- (d) worker gate on tick sites

describe.skipIf(!merged)('(d) sweep and cron tick sites are behind the worker gate [PHASE0_MERGED]', () => {
    it('server/agents/comms-sweep.ts imports from ../worker-gate', () => {
        expect(importSpecifiers('server/agents/comms-sweep.ts')).toContain('../worker-gate');
    });
    it('server/cron.ts imports from ./worker-gate', () => {
        expect(importSpecifiers('server/cron.ts')).toContain('./worker-gate');
    });
});

// ---------------------------------------------------------------- (e) approver is an enum, not a regex

describe.skipIf(!merged)('(e) the AUTOMATED_APPROVER regex is gone [PHASE0_MERGED]', () => {
    it('no file under server/ contains AUTOMATED_APPROVER', () => {
        const hits = SERVER_FILES.filter((f) => ident('AUTOMATED_APPROVER').test(code(f)));
        expect(hits).toEqual([]);
    });
});

// ---------------------------------------------------------------- scanner self-checks

describe('scanner', () => {
    it('strips comments but keeps URLs inside strings', () => {
        const src = "const u = 'https://graph.facebook.com/x'; // sendV2Reply\n/* shouldUseV2 */ const y = `${a}/messages`;";
        const out = stripComments(src);
        expect(out).toContain('https://graph.facebook.com/x');
        expect(out).not.toContain('sendV2Reply');
        expect(out).not.toContain('shouldUseV2');
        expect(out).toContain('/messages`');
    });
    it('sees the server tree', () => {
        expect(SERVER_FILES.length).toBeGreaterThan(50);
        expect(SERVER_FILES).toContain('server/message-drafts.ts');
    });
});
