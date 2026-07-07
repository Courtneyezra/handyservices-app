/**
 * Floating iframe panel that embeds handyservices.app/admin/pipeline?embed=1
 * on top of web.whatsapp.com.
 *
 * Single responsibility: manage the DOM for the panel + toggle button.
 * Persists open/closed state and width in chrome.storage.local.
 *
 * Talks to the content script via its exported API (showPanel/hidePanel/etc);
 * postMessage handling from the iframe itself lives in content.ts because
 * it needs to poke WhatsApp's DOM to switch chats.
 */

// NOTE: We deliberately do NOT `import { loadConfig } from './config'` here.
// Chrome content scripts are classic scripts (not ES modules), so Rollup must
// not split shared code into a separate chunk. Keeping this tiny helper inline
// ensures panel.ts -> content.ts has no shared-chunk dependency.
async function loadConfig(): Promise<{ backendUrl: string; ingestToken: string }> {
    const stored = await chrome.storage.local.get(['backendUrl', 'ingestToken']);
    return {
        backendUrl: (stored.backendUrl as string) || 'https://handyservices.app',
        ingestToken: (stored.ingestToken as string) || '',
    };
}

const PANEL_ID = 'handy-wa-ext-panel';
const TOGGLE_ID = 'handy-wa-ext-toggle';
const STORAGE_KEY = 'panelState'; // { open: boolean, width: number }

interface PanelState {
    open: boolean;
    width: number;
}

const DEFAULT_STATE: PanelState = { open: false, width: 440 };
const MIN_WIDTH = 320;
const MAX_WIDTH = 900;

async function readState(): Promise<PanelState> {
    const obj = await chrome.storage.local.get(STORAGE_KEY);
    return { ...DEFAULT_STATE, ...((obj[STORAGE_KEY] as PanelState) || {}) };
}
async function writeState(patch: Partial<PanelState>) {
    const current = await readState();
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...current, ...patch } });
}

let panelEl: HTMLDivElement | null = null;
let iframeEl: HTMLIFrameElement | null = null;
let currentWidth = DEFAULT_STATE.width;

function buildPanel(state: PanelState, crmUrl: string): HTMLDivElement {
    currentWidth = state.width;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
        'position:fixed', 'top:0', 'right:0',
        `width:${state.width}px`, 'height:100vh',
        'z-index:2147483646',
        'box-shadow:-4px 0 16px rgba(0,0,0,0.18)',
        'background:#0f172a',
        'display:flex', 'flex-direction:column',
        `transform:translateX(${state.open ? '0' : '100%'})`,
        'transition:transform .25s ease',
        'font-family:-apple-system,system-ui,sans-serif',
    ].join(';');

    // Header (drag handle + collapse)
    const header = document.createElement('div');
    header.style.cssText = [
        'flex:0 0 auto', 'height:36px',
        'display:flex', 'align-items:center', 'justify-content:space-between',
        'padding:0 12px', 'background:#1e293b', 'color:#e2e8f0',
        'font:600 12px -apple-system,system-ui,sans-serif',
        'border-bottom:1px solid #334155',
    ].join(';');
    header.innerHTML = `
        <span style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:999px;background:#22c55e;display:inline-block"></span>
            Handy · Pipeline
        </span>
        <span style="display:flex;align-items:center;gap:4px">
            <button id="handy-wa-ext-newtab" title="Open Kanban in new tab (works when iframe is blocked)"
                style="all:unset;cursor:pointer;color:#94a3b8;font-size:12px;padding:4px 8px">↗</button>
            <button id="handy-wa-ext-close"
                style="all:unset;cursor:pointer;color:#94a3b8;font-size:18px;padding:4px 8px">×</button>
        </span>
    `;
    panel.appendChild(header);

    // Iframe container — holds the iframe AND an overlay we show if the
    // iframe stays blank (usually means user isn't logged in on CRM origin).
    const iframeWrap = document.createElement('div');
    iframeWrap.style.cssText = 'position:relative;flex:1 1 auto;width:100%;background:white';
    panel.appendChild(iframeWrap);

    const iframe = document.createElement('iframe');
    const embedUrl = `${crmUrl.replace(/\/$/, '')}/admin/pipeline?embed=1`;
    iframe.src = embedUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:white';
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframeWrap.appendChild(iframe);
    iframeEl = iframe;

    // Helpful overlay that pops up if the iframe appears blank after 3 seconds.
    // Can't read cross-frame contents directly, but we can detect "blank" by
    // timing and offer a clear action to the user.
    const overlay = document.createElement('div');
    overlay.id = 'handy-wa-ext-panel-overlay';
    // Show by default — the Kanban's handshake postMessage will hide it.
    overlay.style.cssText = [
        'position:absolute', 'inset:0', 'display:block',
        'background:#0f172a', 'color:#e2e8f0',
        'padding:24px', 'font:13px/1.5 -apple-system,system-ui,sans-serif',
        'overflow:auto',
    ].join(';');
    const isDevHttp = embedUrl.startsWith('http://');
    overlay.innerHTML = `
        <div style="max-width:340px">
            <div style="font-size:14px;font-weight:700;margin-bottom:12px;color:#38bdf8">Pipeline panel</div>
            ${isDevHttp ? `
                <div style="margin-bottom:10px;padding:10px;background:#334155;border-radius:6px;font-size:12px;color:#cbd5e1">
                    <b style="color:#fbbf24">Dev mode:</b> Chrome blocks iframing <code style="color:#e2e8f0">http://localhost</code> from an HTTPS page.
                    In production (with HTTPS) this panel will work natively.
                </div>
                <div style="margin-bottom:14px">For now, use one of these:</div>
                <button id="handy-wa-ext-open-newtab" style="all:unset;cursor:pointer;background:#0ea5e9;color:white;padding:10px 16px;border-radius:6px;font-weight:600;font-size:12px;display:block;margin-bottom:8px">📋 Open Kanban in new tab</button>
                <button id="handy-wa-ext-retry" style="all:unset;cursor:pointer;background:#334155;color:#e2e8f0;padding:8px 14px;border-radius:6px;font-weight:600;font-size:12px">Retry iframe</button>
            ` : `
                <div style="margin-bottom:10px">If you see nothing, you're probably not signed in to the CRM here.</div>
                <ol style="padding-left:18px;margin:8px 0 16px 0">
                    <li style="margin-bottom:6px">Open <a href="${embedUrl.replace('?embed=1', '').replace('/admin/pipeline', '/admin/login')}" target="_blank" style="color:#38bdf8">the CRM login page</a>.</li>
                    <li style="margin-bottom:6px">Sign in as admin.</li>
                    <li>Click <b>Retry</b>.</li>
                </ol>
                <button id="handy-wa-ext-retry" style="all:unset;cursor:pointer;background:#0ea5e9;color:white;padding:8px 14px;border-radius:6px;font-weight:600;font-size:12px">Retry</button>
            `}
            <div style="margin-top:14px;font-size:11px;color:#64748b">
                URL: <code style="color:#94a3b8">${embedUrl}</code>
            </div>
        </div>
    `;
    iframeWrap.appendChild(overlay);

    // The overlay starts visible (set in cssText above). It gets hidden when
    // the embedded Kanban sends its 'handy-wa:hello' handshake (wired below).
    // This means: if the iframe is blank / not signed in / blocked, the user
    // sees clear instructions instead of a mysterious blank panel.

    // The content script sets __handyWaIframeHeardFrom = true when the iframe
    // posts any message. We wire that here (idempotent).
    if (!(window as any).__handyWaOverlayHandlerWired) {
        (window as any).__handyWaOverlayHandlerWired = true;
        window.addEventListener('message', (e) => {
            const d = e.data;
            if (d && typeof d === 'object' && typeof d.kind === 'string' && d.kind.startsWith('handy-wa:')) {
                (window as any).__handyWaIframeHeardFrom = true;
                const o = document.getElementById('handy-wa-ext-panel-overlay');
                if (o) o.style.display = 'none';
            }
        });
    }

    // Resize handle on left edge
    const resizer = document.createElement('div');
    resizer.style.cssText = [
        'position:absolute', 'top:0', 'left:-3px', 'width:6px', 'height:100%',
        'cursor:ew-resize', 'z-index:1',
    ].join(';');
    panel.appendChild(resizer);
    wireResizer(resizer, panel);

    return panel;
}

function wireResizer(handle: HTMLElement, panel: HTMLElement) {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        const delta = startX - e.clientX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        panel.style.width = `${next}px`;
        currentWidth = next;
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        // Persist on drop
        writeState({ width: currentWidth });
    };
    handle.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startWidth = panel.getBoundingClientRect().width;
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    });
}

function buildToggle(initiallyOpen: boolean): HTMLDivElement {
    const btn = document.createElement('div');
    btn.id = TOGGLE_ID;
    btn.textContent = initiallyOpen ? '✕ Pipeline' : '📋 Pipeline';
    btn.title = 'Toggle Handy Services pipeline';
    btn.style.cssText = [
        'position:fixed', 'bottom:52px', 'right:12px',
        'z-index:2147483647', 'padding:8px 14px',
        'border-radius:999px', 'background:#0ea5e9', 'color:white',
        'font:600 12px -apple-system,system-ui,sans-serif',
        'box-shadow:0 2px 8px rgba(0,0,0,0.2)', 'cursor:pointer',
        'user-select:none', 'opacity:0.95',
    ].join(';');
    btn.addEventListener('click', togglePanel);
    return btn;
}

export async function mountPanelUI() {
    if (!document.body) {
        setTimeout(mountPanelUI, 400);
        return;
    }
    if (document.getElementById(PANEL_ID)) return; // already mounted

    const state = await readState();
    const cfg = await loadConfig();
    const crmUrl = cfg.backendUrl || 'https://handyservices.app';

    panelEl = buildPanel(state, crmUrl);
    document.body.appendChild(panelEl);

    const toggle = buildToggle(state.open);
    document.body.appendChild(toggle);

    // Close button on panel header
    const closeBtn = document.getElementById('handy-wa-ext-close');
    closeBtn?.addEventListener('click', hidePanel);

    // "Open in new tab" button — critical escape hatch for dev (mixed content
    // blocks http://localhost iframes inside https://web.whatsapp.com).
    const newTabBtn = document.getElementById('handy-wa-ext-newtab');
    newTabBtn?.addEventListener('click', () => {
        const url = `${crmUrl.replace(/\/$/, '')}/admin/pipeline`;
        window.open(url, '_blank', 'noopener');
    });

    // Retry button — reload iframe but DON'T hide overlay (handshake will do that)
    const retryBtn = document.getElementById('handy-wa-ext-retry');
    retryBtn?.addEventListener('click', () => {
        const iframe = iframeEl;
        if (iframe) {
            const src = iframe.src;
            (window as any).__handyWaIframeHeardFrom = false;
            iframe.src = 'about:blank';
            setTimeout(() => { iframe.src = src; }, 50);
        }
    });

    // "Open Kanban in new tab" button in overlay (dev-mode only)
    const openNewTabInOverlay = document.getElementById('handy-wa-ext-open-newtab');
    openNewTabInOverlay?.addEventListener('click', () => {
        const url = `${crmUrl.replace(/\/$/, '')}/admin/pipeline`;
        window.open(url, '_blank', 'noopener');
    });
}

export async function showPanel() {
    if (!panelEl) return;
    panelEl.style.transform = 'translateX(0)';
    const toggle = document.getElementById(TOGGLE_ID);
    if (toggle) toggle.textContent = '✕ Pipeline';
    await writeState({ open: true });
}

export async function hidePanel() {
    if (!panelEl) return;
    panelEl.style.transform = 'translateX(100%)';
    const toggle = document.getElementById(TOGGLE_ID);
    if (toggle) toggle.textContent = '📋 Pipeline';
    await writeState({ open: false });
}

export async function togglePanel() {
    const state = await readState();
    if (state.open) await hidePanel();
    else await showPanel();
}

export function getIframe(): HTMLIFrameElement | null {
    return iframeEl;
}
