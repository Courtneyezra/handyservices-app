import type { CapturedMessage } from './types';

/**
 * 2026 WhatsApp Web parser.
 *
 * Key realities we adapted to:
 *   - data-id on message rows is now an opaque hash (e.g. "2A2EFC76EC..."), not phone-prefixed.
 *   - data-pre-plain-text still exists and gives us timestamp + *author display name*,
 *     but that name may be a saved contact name ("Handy Services"), not always a phone.
 *   - Therefore we pull the CONVERSATION phone from the active chat's header/sidebar,
 *     and use it for all messages in the thread.
 *   - Direction comes from bubble geometry (right-aligned = outbound).
 *   - Text comes from the [data-pre-plain-text] element's textContent.
 */

/** Strip whitespace from a phone string and normalise leading +. */
function canonPhone(raw: string): string {
    const trimmed = raw.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (!trimmed) return '';
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

/**
 * Find the phone number of the CURRENTLY OPEN conversation.
 *
 * Strategy (in priority order):
 *   1. Header text — if the contact isn't saved, WA shows "+44 7523 232780" here.
 *   2. The currently selected/active chat list item — usually contains a phone as text.
 *   3. Any prominent "contact-info" fly-out (fallback).
 *
 * Returns normalised E.164 like "+447523232780", or null if none found.
 */
export function getConversationPhone(): string | null {
    // Helper: find the first +dd... style phone in an element's text.
    const extractPhone = (el: Element | null | undefined): string | null => {
        if (!el) return null;
        const text = (el.textContent || '').replace(/\u00a0/g, ' ');
        const m = text.match(/\+\s*\d[\d\s().-]{8,18}/);
        if (!m) return null;
        const p = canonPhone(m[0]);
        if (!/^\+\d{10,15}$/.test(p)) return null;
        return p;
    };

    // 1) Chat header
    const header = document.querySelector('#main header');
    const fromHeader = extractPhone(header);
    if (fromHeader) return fromHeader;

    // 2) Selected/active chat list row
    const activeRow =
        document.querySelector('[role="row"][aria-selected="true"]') ||
        document.querySelector('[role="grid"] [aria-current="true"]') ||
        document.querySelector('[role="row"] [aria-selected="true"]');
    const fromActive = extractPhone(activeRow);
    if (fromActive) return fromActive;

    // 3) As a last resort, scan all visible role=row items for one whose parent
    //    looks "active" based on computed styles — too flaky, skip.

    return null;
}

/** Contact display name from the chat header. */
export function contactNameFromHeader(): string | null {
    const header = document.querySelector('#main header');
    if (!header) return null;
    // Take the most prominent span in the header
    const titleEl =
        header.querySelector('span[title]') ||
        header.querySelector('[dir="auto"]') ||
        header.querySelector('span');
    if (!titleEl) return null;
    const t = titleEl.getAttribute('title') || titleEl.textContent;
    return t ? t.trim() : null;
}

/** Parse the [timestamp] portion of data-pre-plain-text into ISO string. */
function isoFromPpt(attr: string): string | null {
    const m = attr.match(/\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/);
    if (!m) return null;
    const [, hh, mm, dd, MM, yyyy] = m;
    const year = yyyy.length === 2 ? 2000 + parseInt(yyyy, 10) : parseInt(yyyy, 10);
    const d = new Date(year, parseInt(MM, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mm, 10));
    return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Get clean message text from the [data-pre-plain-text] wrapper. */
function textFromPpt(ppt: Element): string {
    // The ppt element's textContent is just the message body (no "tail-out", no icons).
    return (ppt.textContent || '').trim();
}

/** Right-aligned row = outbound; left-aligned = inbound. */
export function directionFromGeometry(row: Element): 'inbound' | 'outbound' | null {
    try {
        const r = (row as HTMLElement).getBoundingClientRect();
        const parent = row.parentElement;
        if (!parent) return null;
        const pr = parent.getBoundingClientRect();
        if (!r.width || !pr.width) return null;
        const leftGap = r.left - pr.left;
        const rightGap = pr.right - r.right;
        if (rightGap < leftGap - 20) return 'outbound';
        if (leftGap < rightGap - 20) return 'inbound';
    } catch {}
    return null;
}

/** Best-effort type detection (text by default). */
export function typeFromNode(row: Element): CapturedMessage['type'] {
    if (row.querySelector('img[src^="blob:"]')) return 'image';
    if (row.querySelector('audio')) return 'audio';
    if (row.querySelector('video')) return 'video';
    return 'text';
}

/**
 * Parse one [data-id] row into a CapturedMessage, or null if unparseable.
 *
 * Requires the conversation phone to be passed in (looked up once per scan
 * by the caller — avoids re-reading the DOM on every row).
 */
export function parseRow(row: Element, conversationPhone: string | null): CapturedMessage | null {
    if (!conversationPhone) return null; // no phone for this thread → we can't attribute anything
    const dataId = row.getAttribute('data-id');
    if (!dataId) return null;

    const ppt =
        row.querySelector('[data-pre-plain-text]') ||
        (row.hasAttribute('data-pre-plain-text') ? row : null);
    if (!ppt) return null; // not a content message (probably a system row / date divider)

    const attrStr = (ppt as Element).getAttribute('data-pre-plain-text') || '';
    const iso = isoFromPpt(attrStr);
    const content = textFromPpt(ppt as Element);
    const type = typeFromNode(row);
    if (!content && type === 'text') return null;

    const direction = directionFromGeometry(row) || 'inbound';

    return {
        externalMessageId: dataId,
        rawPhone: conversationPhone,
        contactName: contactNameFromHeader(),
        direction,
        content: content || `[${type}]`,
        type,
        timestamp: iso || new Date().toISOString(),
    };
}
