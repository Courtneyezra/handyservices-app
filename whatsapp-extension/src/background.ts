/**
 * Background service worker.
 *
 * Responsibilities:
 *   - Receive captured messages from the content script.
 *   - POST them to the backend (/api/whatsapp/ext-ingest) with bearer auth.
 *   - If the POST fails (offline, 5xx), persist the batch to chrome.storage.local
 *     and retry on an alarm-driven timer.
 *   - Expose a simple popup-facing status (last flush time, queue size).
 */

import type { CapturedMessage, ContentToBackground } from './types';
import { loadConfig } from './config';

const LOG = '[handy-wa-ext:bg]';
const QUEUE_KEY = 'pendingQueue';
const META_KEY = 'syncMeta';
const RETRY_ALARM = 'retryPending';

interface SyncMeta {
    lastFlushAt: string | null;
    lastStatus: 'ok' | 'error' | 'idle';
    lastError: string | null;
}

// --------------------------------------------------------------------
// Persistent queue helpers
// --------------------------------------------------------------------
async function readQueue(): Promise<CapturedMessage[]> {
    const obj = await chrome.storage.local.get(QUEUE_KEY);
    return (obj[QUEUE_KEY] as CapturedMessage[]) || [];
}
async function writeQueue(q: CapturedMessage[]): Promise<void> {
    await chrome.storage.local.set({ [QUEUE_KEY]: q });
}
async function updateMeta(patch: Partial<SyncMeta>): Promise<void> {
    const obj = await chrome.storage.local.get(META_KEY);
    const current = (obj[META_KEY] as SyncMeta) || {
        lastFlushAt: null,
        lastStatus: 'idle',
        lastError: null,
    };
    await chrome.storage.local.set({ [META_KEY]: { ...current, ...patch } });
}

// --------------------------------------------------------------------
// Core: POST a batch to the backend
// --------------------------------------------------------------------
async function postBatch(batch: CapturedMessage[]): Promise<{ ok: boolean; error?: string }> {
    const cfg = await loadConfig();
    if (!cfg.backendUrl || !cfg.ingestToken) {
        return { ok: false, error: 'backend URL or ingest token not configured' };
    }
    const url = `${cfg.backendUrl}/api/whatsapp/ext-ingest`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.ingestToken}`,
            },
            body: JSON.stringify({ messages: batch }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
        return { ok: true };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'network error' };
    }
}

/**
 * Try to send `batch` now. On failure, append to the persistent queue and
 * schedule a retry. On success, also drain whatever was in the queue.
 */
async function sendOrQueue(batch: CapturedMessage[]): Promise<void> {
    if (batch.length === 0) {
        await drainQueue();
        return;
    }
    const result = await postBatch(batch);
    if (result.ok) {
        console.log(LOG, `posted ${batch.length} messages OK`);
        await updateMeta({ lastFlushAt: new Date().toISOString(), lastStatus: 'ok', lastError: null });
        await drainQueue();
    } else {
        console.warn(LOG, `post failed, queueing ${batch.length}: ${result.error}`);
        const queue = await readQueue();
        queue.push(...batch);
        // cap queue to prevent unbounded growth
        if (queue.length > 2000) queue.splice(0, queue.length - 2000);
        await writeQueue(queue);
        await updateMeta({ lastStatus: 'error', lastError: result.error || null });
        await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
    }
}

async function drainQueue(): Promise<void> {
    const queue = await readQueue();
    if (queue.length === 0) return;
    const result = await postBatch(queue);
    if (result.ok) {
        console.log(LOG, `drained queue of ${queue.length}`);
        await writeQueue([]);
        await updateMeta({ lastFlushAt: new Date().toISOString(), lastStatus: 'ok', lastError: null });
    } else {
        console.warn(LOG, `drain failed: ${result.error}`);
        await updateMeta({ lastStatus: 'error', lastError: result.error || null });
        await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
    }
}

// --------------------------------------------------------------------
// Event wiring
// --------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg: ContentToBackground, _sender, sendResponse) => {
    if (msg?.kind === 'capture' && Array.isArray(msg.messages)) {
        sendOrQueue(msg.messages).finally(() => sendResponse({ ok: true }));
        return true; // async response
    }
    if (msg?.kind === 'ping') {
        sendResponse({ ok: true });
        return false;
    }
    return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) {
        drainQueue();
    }
});

// On install / startup, schedule a periodic drain in case we were offline.
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('periodicDrain', { periodInMinutes: 5 });
    console.log(LOG, 'installed');
});
chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('periodicDrain', { periodInMinutes: 5 });
    console.log(LOG, 'startup');
});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'periodicDrain') drainQueue();
});

console.log(LOG, 'service worker loaded');
