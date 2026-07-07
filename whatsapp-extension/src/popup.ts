import { loadConfig, saveConfig } from './config';

const urlInput = document.getElementById('backendUrl') as HTMLInputElement;
const tokenInput = document.getElementById('ingestToken') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const flushBtn = document.getElementById('forceFlush') as HTMLButtonElement;
const statusBox = document.getElementById('status') as HTMLDivElement;

function setStatus(kind: 'ok' | 'err' | 'idle', html: string) {
    statusBox.className = `status ${kind}`;
    statusBox.innerHTML = html;
}

async function refresh() {
    const cfg = await loadConfig();
    urlInput.value = cfg.backendUrl;
    tokenInput.value = cfg.ingestToken;

    const meta = (await chrome.storage.local.get('syncMeta')).syncMeta || {
        lastFlushAt: null,
        lastStatus: 'idle',
        lastError: null,
    };
    const queue = (await chrome.storage.local.get('pendingQueue')).pendingQueue || [];

    const last = meta.lastFlushAt ? new Date(meta.lastFlushAt).toLocaleTimeString() : 'never';
    const queueLine = `<div class="row"><span class="muted">Queued:</span><span>${queue.length}</span></div>`;
    const lastLine = `<div class="row"><span class="muted">Last sync:</span><span>${last}</span></div>`;
    if (meta.lastStatus === 'ok') {
        setStatus('ok', `Connected ✓<br>${lastLine}${queueLine}`);
    } else if (meta.lastStatus === 'error') {
        setStatus(
            'err',
            `Error: ${meta.lastError || 'unknown'}<br>${lastLine}${queueLine}`,
        );
    } else {
        setStatus('idle', `Idle — waiting for first message.<br>${queueLine}`);
    }
}

async function testConnection(): Promise<{ ok: boolean; error?: string }> {
    const cfg = await loadConfig();
    if (!cfg.backendUrl || !cfg.ingestToken) {
        return { ok: false, error: 'URL or token missing' };
    }
    try {
        const res = await fetch(`${cfg.backendUrl}/api/whatsapp/ext-ping`, {
            headers: { Authorization: `Bearer ${cfg.ingestToken}` },
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'network error' };
    }
}

saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    await saveConfig({
        backendUrl: urlInput.value.trim(),
        ingestToken: tokenInput.value.trim(),
    });
    setStatus('idle', 'Testing connection…');
    const result = await testConnection();
    if (result.ok) {
        setStatus('ok', 'Connected ✓ — ready to sync. Open <b>web.whatsapp.com</b>.');
    } else {
        setStatus('err', `Failed: ${result.error}`);
    }
    saveBtn.disabled = false;
    refresh();
});

flushBtn.addEventListener('click', async () => {
    flushBtn.disabled = true;
    // Nudge background to drain by sending a benign message
    await chrome.runtime.sendMessage({ kind: 'ping' }).catch(() => {});
    // Trigger an alarm-equivalent by writing and clearing the queue key (service workers wake on storage changes too)
    await chrome.alarms.create('periodicDrain', { when: Date.now() + 100 });
    setTimeout(() => {
        refresh();
        flushBtn.disabled = false;
    }, 1200);
});

refresh();
