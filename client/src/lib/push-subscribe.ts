/**
 * Web Push subscription helpers (WP3).
 *
 * Shared by the admin Notifications page and the contractor Profile tab.
 * All /api/push/subscribe and /api/push/test calls require Bearer auth
 * (adminToken for admin/VA, contractorToken for contractors) so the server
 * can stamp userId/role onto the subscription row.
 */

/** True when the browser supports service workers + Push + Notifications. */
export function pushSupported(): boolean {
    return (
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
    );
}

function authHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Convert a base64url-encoded VAPID public key into the Uint8Array the Push API wants. */
function urlBase64ToUint8Array(publicKey: string): Uint8Array {
    const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
    const b64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(b64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function postSubscription(sub: PushSubscription, token: string | null): Promise<Response> {
    return fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify(sub.toJSON()),
    });
}

/**
 * Full enable flow: permission → SW ready → fetch VAPID key → subscribe →
 * register the subscription with the server.
 * Throws descriptive Errors on any failure so callers can toast.
 */
export async function enablePush(token: string | null): Promise<void> {
    if (!pushSupported()) throw new Error("This browser doesn't support push.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Permission denied.");
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch("/api/push/vapid-public-key");
    const { publicKey } = await keyRes.json().catch(() => ({ publicKey: null }));
    if (!publicKey) throw new Error("No VAPID key configured on the server.");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
    }
    const res = await postSubscription(sub, token);
    if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Server rejected the subscription.");
    }
}

/**
 * If permission is already granted and a subscription exists, re-POST it with
 * Bearer auth so the server can stamp userId/role onto legacy rows.
 * Never throws; silently no-ops when unsupported, no token, or no subscription.
 */
export async function resyncPush(token: string | null): Promise<void> {
    try {
        if (!pushSupported() || !token) return;
        if (Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        await postSubscription(sub, token);
    } catch {
        // Best-effort background heal — ignore all errors.
    }
}

/** Ask the server to send a test push to this user's subscriptions. Throws on non-OK. */
export async function sendTestPush(token: string | null): Promise<void> {
    const res = await fetch("/api/push/test", {
        method: "POST",
        headers: authHeaders(token),
    });
    if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed");
    }
}
