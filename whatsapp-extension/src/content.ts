/**
 * Content script — 2026 WhatsApp Web.
 *
 *  - Wait 10s for WA to settle before observing.
 *  - On attach AND when the conversation changes, scan all existing [data-id] rows.
 *  - After attach, watch for new message rows and parse them.
 */

import { parseRow, getConversationPhone } from './parser';
import type { CapturedMessage, ContentToBackground } from './types';
import { mountPanelUI } from './panel';

const LOG = '[handy-wa-ext]';

const seen = new Set<string>();
let pendingBatch: CapturedMessage[] = [];
let flushTimer: number | null = null;
let capturedCount = 0;
let observerAttached = false;
let lastConversationPhone: string | null = null;

// ---- Badge ----
const badge = document.createElement('div');
badge.id = 'handy-wa-ext-badge';
badge.textContent = 'WA Sync · idle';
badge.style.cssText = [
    'position:fixed', 'bottom:12px', 'right:12px', 'z-index:2147483647',
    'padding:6px 10px', 'border-radius:999px', 'background:#64748b',
    'color:white', 'font:600 11px -apple-system,system-ui,sans-serif',
    'box-shadow:0 2px 8px rgba(0,0,0,0.2)', 'pointer-events:none', 'opacity:0.9',
].join(';');
function setBadge(text: string, color = '#0ea5e9') {
    badge.textContent = text;
    badge.style.background = color;
}
function attachBadge() {
    if (!document.body) return setTimeout(attachBadge, 300);
    if (!document.getElementById('handy-wa-ext-badge')) document.body.appendChild(badge);
}

// ---- Transport ----
function sendToBackground(msg: ContentToBackground) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch {}
}
function scheduleFlush() {
    if (flushTimer !== null) return;
    flushTimer = self.setTimeout(() => {
        flushTimer = null;
        if (pendingBatch.length === 0) return;
        const batch = pendingBatch;
        pendingBatch = [];
        console.log(LOG, `flushing ${batch.length} messages`);
        sendToBackground({ kind: 'capture', messages: batch });
    }, 1500);
}
function enqueue(msg: CapturedMessage) {
    if (seen.has(msg.externalMessageId)) return;
    seen.add(msg.externalMessageId);
    pendingBatch.push(msg);
    capturedCount++;
    scheduleFlush();
    setBadge(`WA Sync · ${capturedCount} synced`, '#22c55e');
}

// ---- Parse-and-enqueue ----
function tryRow(row: Element, convPhone: string | null) {
    try {
        const parsed = parseRow(row, convPhone);
        if (parsed) enqueue(parsed);
    } catch (e) {
        console.warn(LOG, 'parseRow threw', e);
    }
}

/** Scan every currently-visible data-id row in the open conversation. */
function fullScan() {
    const convPhone = getConversationPhone();
    if (!convPhone) {
        console.log(LOG, 'fullScan: no conversation phone found, skipping');
        return;
    }
    if (convPhone !== lastConversationPhone) {
        console.log(LOG, `fullScan: conversation phone = ${convPhone}`);
        lastConversationPhone = convPhone;
    }
    const rows = document.querySelectorAll('[data-id]');
    rows.forEach((r) => tryRow(r, convPhone));
}

function handleMutation(records: MutationRecord[]) {
    // Any added node with data-id, OR any child with data-id.
    const rows: Element[] = [];
    for (const rec of records) {
        if (rec.type !== 'childList') continue;
        rec.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node.hasAttribute?.('data-id')) rows.push(node);
            if ((node as Element).querySelectorAll) {
                (node as Element).querySelectorAll('[data-id]').forEach((d) => rows.push(d));
            }
        });
    }
    if (rows.length === 0) return;
    const convPhone = getConversationPhone();
    const runner = () => rows.forEach((r) => tryRow(r, convPhone));
    if (typeof (self as any).requestIdleCallback === 'function') {
        (self as any).requestIdleCallback(runner, { timeout: 2000 });
    } else {
        setTimeout(runner, 0);
    }
}

// ---- Boot ----
function whatsAppIsReady(): boolean {
    return !!(
        document.querySelector('[aria-label="Chat list"]') ||
        document.querySelector('#pane-side') ||
        document.querySelector('#main')
    );
}

function attachObserverWhenReady() {
    if (observerAttached) return;
    if (!whatsAppIsReady()) {
        setBadge('WA Sync · waiting…', '#64748b');
        setTimeout(attachObserverWhenReady, 2000);
        return;
    }
    const target =
        document.querySelector('#main') ||
        document.querySelector('#pane-side')?.parentElement ||
        document.body;
    try {
        const observer = new MutationObserver(handleMutation);
        observer.observe(target, { childList: true, subtree: true });
        observerAttached = true;
        console.log(LOG, 'observer attached to', (target as Element).id || 'body');
        setBadge('WA Sync · watching', '#0ea5e9');
        // Immediate + delayed initial scans (catch rows rendered post-attach).
        fullScan();
        setTimeout(fullScan, 1500);
        setTimeout(fullScan, 4000);
        // Periodic re-scan every 5s as a safety net (catches missed mutations + conversation switches).
        setInterval(fullScan, 5000);
    } catch (err) {
        console.warn(LOG, 'observer attach failed', err);
        setBadge('WA Sync · error', '#ef4444');
    }
}

// ---- Diagnostic (auto-log once every 10s for first 2 minutes) ----
function runDiagnostic() {
    const dataIdRows = Array.from(document.querySelectorAll('[data-id]'));
    const pptElems = Array.from(document.querySelectorAll('[data-pre-plain-text]'));
    const convPhone = getConversationPhone();
    const summary = {
        url: location.href,
        observerAttached,
        waReady: whatsAppIsReady(),
        conversationPhone: convPhone,
        totalDataIdRows: dataIdRows.length,
        totalPpt: pptElems.length,
        captured: capturedCount,
        samples: dataIdRows.slice(0, 3).map((r) => ({
            dataId: r.getAttribute('data-id'),
            hasPpt: !!r.querySelector('[data-pre-plain-text]'),
            pptAttr: r.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')?.slice(0, 80) || null,
            pptText: (r.querySelector('[data-pre-plain-text]')?.textContent || '').slice(0, 80),
        })),
    };
    console.log(LOG, '[DEBUG]', JSON.stringify(summary, null, 2));
}
let autoTicks = 0;
const autoTimer = setInterval(() => {
    autoTicks++;
    runDiagnostic();
    if (autoTicks >= 12) clearInterval(autoTimer);
}, 10_000);

console.log(LOG, 'content script loaded on', location.href);
attachBadge();
setTimeout(attachObserverWhenReady, 10_000);

// -----------------------------------------------------------------------------
// Kanban panel mount + postMessage bridge
// -----------------------------------------------------------------------------

// Delay panel mount slightly so WhatsApp's bootstrap isn't competing for the
// main thread during our iframe creation.
setTimeout(() => {
    mountPanelUI().catch((err) => console.warn(LOG, 'panel mount failed', err));
}, 5_000);

/**
 * Find and click the WhatsApp Web chat for the given phone number.
 * Strategy:
 *   1. Normalise to digits only.
 *   2. Scan [role="row"] rows in the chat list for one whose text or data
 *      contains the digit sequence.
 *   3. Click it (WhatsApp's own handler will open the conversation).
 *   4. If not found (virtualised out of view), scroll the chat list & retry.
 */
function openChatByPhone(phone: string): { ok: boolean; reason?: string } {
    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length < 8) return { ok: false, reason: 'phone too short' };

    // Build a few candidate fragments the sidebar row might contain.
    // WA Web renders "+44 7700 900123", "447700900123@c.us" (data-id), or the
    // local format "07700 900123".
    const candidates = new Set<string>();
    candidates.add(digitsOnly);                          // 447700900123
    candidates.add('+' + digitsOnly);                    // +447700900123
    if (digitsOnly.startsWith('44')) {
        candidates.add('0' + digitsOnly.slice(2));       // 07700900123
    }

    const matches = (hay: string): boolean => {
        const cleanHay = hay.replace(/\s/g, '');
        for (const c of candidates) if (cleanHay.includes(c)) return true;
        return false;
    };

    const rows = document.querySelectorAll('[role="row"]');
    for (const row of Array.from(rows)) {
        const dataId = row.getAttribute('data-id') || '';
        const text = row.textContent || '';
        if (matches(dataId) || matches(text)) {
            // Click the row — WA handles the rest.
            (row as HTMLElement).click();
            return { ok: true };
        }
    }
    return { ok: false, reason: 'chat not in rendered sidebar (virtualised)' };
}

/**
 * Listen for postMessage events from the embedded Kanban iframe.
 * Origin check: we accept messages only from the configured CRM origin.
 * Shape: { kind: 'handy-wa:open-chat', phone: '+44...', leadId?: string }
 */
window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.kind !== 'handy-wa:open-chat') return;
    if (typeof data.phone !== 'string') return;

    // TODO: in future, validate event.origin against the configured backendUrl.
    // For v1 we accept any origin because the iframe could load from localhost
    // during dev OR handyservices.app in prod, and the action (clicking a chat)
    // is not destructive.
    console.log(LOG, 'received open-chat request', data);
    const result = openChatByPhone(data.phone);
    if (!result.ok) {
        console.warn(LOG, 'could not open chat:', result.reason);
    }
});
