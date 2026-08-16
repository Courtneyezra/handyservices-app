/**
 * /admin/whatsapp-onboard — launches Meta Embedded Signup in coexistence mode.
 *
 * Brings a number that already runs the WhatsApp Business app onto the Cloud API without taking it
 * off the handset. The key is extras.featureType = "whatsapp_business_app_onboarding"; the older
 * value "coexistence" is no longer accepted by Meta.
 *
 * The browser only ever receives a short-lived, single-use CODE. It is exchanged for a business
 * token server-side, because that exchange needs the app secret which must never reach the client.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Smartphone, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

declare global {
    interface Window { FB?: any; fbAsyncInit?: () => void; }
}

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface OnboardConfig {
    appId: string; configId: string; hasSecret: boolean;
    ready: boolean; missing: string[];
}

/** Asset ids Meta posts back via window.postMessage during the flow. */
interface SignupSession { waba_id?: string; phone_number_id?: string; current_step?: string; }

export default function WhatsAppOnboardPage() {
    const [sdkReady, setSdkReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const sessionRef = useRef<SignupSession>({});

    const say = (m: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${m}`]);

    const { data: config, isLoading } = useQuery<OnboardConfig>({
        queryKey: ['wa-onboard-config'],
        queryFn: async () => {
            const r = await fetch('/api/whatsapp/onboard/config', { headers: getAuthHeaders() });
            if (!r.ok) throw new Error('Failed to load onboarding config');
            return r.json();
        },
    });

    const { data: status, refetch: refetchStatus } = useQuery({
        queryKey: ['wa-onboard-status'],
        queryFn: async () => {
            const r = await fetch('/api/whatsapp/onboard/status', { headers: getAuthHeaders() });
            return r.ok ? r.json() : { onboarded: false };
        },
    });

    // Meta posts asset ids here as the user moves through the flow. They arrive BEFORE the login
    // callback fires, so they must be captured separately and held until the code shows up.
    useEffect(() => {
        function onMessage(event: MessageEvent) {
            if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
                if (data.event === 'FINISH' || data.data) {
                    sessionRef.current = { ...sessionRef.current, ...(data.data || {}) };
                    say(`signup event: ${data.event || 'data'} — waba=${sessionRef.current.waba_id ?? '?'} phone=${sessionRef.current.phone_number_id ?? '?'}`);
                }
                if (data.event === 'CANCEL') say(`cancelled at step: ${data.data?.current_step ?? 'unknown'}`);
                if (data.event === 'ERROR') say(`error: ${data.data?.error_message ?? 'unknown'}`);
            } catch { /* not our message */ }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    // Load the Facebook JS SDK once we know the app id.
    useEffect(() => {
        if (!config?.appId || window.FB) { if (window.FB) setSdkReady(true); return; }
        window.fbAsyncInit = () => {
            window.FB.init({ appId: config.appId, cookie: true, xfbml: false, version: 'v21.0' });
            setSdkReady(true);
            say('Facebook SDK ready');
        };
        const s = document.createElement('script');
        s.src = 'https://connect.facebook.net/en_US/sdk.js';
        s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
        document.body.appendChild(s);
    }, [config?.appId]);

    function launch() {
        if (!window.FB || !config) return;
        setBusy(true); setError(null); setResult(null); setLog([]);
        sessionRef.current = {};
        say('launching Embedded Signup (coexistence)…');

        window.FB.login(
            async (response: any) => {
                const code = response?.authResponse?.code;
                if (!code) {
                    setBusy(false);
                    setError('No code returned — the flow was closed or cancelled before finishing.');
                    return;
                }
                say('code received, exchanging server-side…');
                try {
                    const r = await fetch('/api/whatsapp/onboard/exchange', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                        body: JSON.stringify({
                            code,
                            wabaId: sessionRef.current.waba_id,
                            phoneNumberId: sessionRef.current.phone_number_id,
                        }),
                    });
                    const body = await r.json();
                    if (!r.ok) throw new Error(body.error || `Exchange failed (${r.status})`);
                    setResult(body);
                    say('onboarded ✓');
                    refetchStatus();
                } catch (e: any) {
                    setError(e?.message || 'Exchange failed');
                    say(`failed: ${e?.message}`);
                } finally {
                    setBusy(false);
                }
            },
            {
                config_id: config.configId,
                response_type: 'code',
                override_default_response_type: true,
                extras: {
                    setup: {},
                    // "coexistence" is no longer accepted — this is the current value.
                    featureType: 'whatsapp_business_app_onboarding',
                    sessionInfoVersion: 3,
                },
            }
        );
    }

    const blocked = useMemo(() => !config?.ready, [config]);

    if (isLoading) {
        return <div className="flex h-64 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>;
    }

    return (
        <div className="max-w-3xl p-6">
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
                <Smartphone className="h-6 w-6" /> WhatsApp Coexistence
            </h1>
            <p className="mt-1 text-sm text-slate-500">
                Bring a number that already runs the WhatsApp Business app onto the API — without taking
                it off the phone. Messages stay in sync both ways.
            </p>

            {status?.onboarded && (
                <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center gap-2 font-semibold text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" /> Already onboarded
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-900">
                        <dt className="opacity-70">Number</dt><dd>{status.live?.display_phone_number ?? status.stored?.displayPhoneNumber ?? '—'}</dd>
                        <dt className="opacity-70">Status</dt><dd>{status.live?.status ?? '—'}</dd>
                        <dt className="opacity-70">Quality</dt><dd>{status.live?.quality_rating ?? '—'}</dd>
                        <dt className="opacity-70">Phone number id</dt><dd className="font-mono">{status.stored?.phoneNumberId}</dd>
                    </dl>
                </div>
            )}

            {blocked && (
                <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> Server not configured</div>
                    <p className="mt-1">Set these on the server before launching:</p>
                    <ul className="mt-1 list-inside list-disc font-mono text-xs">
                        {config?.missing.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                </div>
            )}

            <div className="mt-6 rounded-lg border border-slate-200 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">What happens on the handset</h2>
                <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-600">
                    <li>A Meta window opens — sign in with the account that owns the business portfolio.</li>
                    <li>Choose <strong>connect an existing WhatsApp Business app number</strong> and enter it.</li>
                    <li>On the phone, tap <strong>Connect to the Business Platform</strong>.</li>
                    <li>Choose whether to <strong>share existing chat history</strong> — this is one-time and irreversible.</li>
                    <li>Paste the verification code shown on the phone.</li>
                </ol>
                <p className="mt-3 text-xs text-slate-500">
                    Afterwards the number works in both places at once, capped at 20 messages/second.
                </p>
            </div>

            <button
                onClick={launch}
                disabled={!sdkReady || busy || blocked}
                className={cn(
                    'mt-6 inline-flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-white transition-colors',
                    !sdkReady || busy || blocked ? 'cursor-not-allowed bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'
                )}
            >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {busy ? 'Onboarding…' : 'Launch Embedded Signup'}
            </button>
            {!sdkReady && !blocked && <p className="mt-2 text-xs text-slate-400">Loading Facebook SDK…</p>}

            {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> {error}</div>
                </div>
            )}

            {result && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                    <div className="font-semibold text-emerald-800">Onboarded {result.displayPhoneNumber ?? ''}</div>
                    <ul className="mt-1 text-xs text-emerald-900">
                        <li>registered: {String(result.registered)}</li>
                        <li>webhooks subscribed: {String(result.webhooksSubscribed)}</li>
                    </ul>
                </div>
            )}

            {log.length > 0 && (
                <pre className="mt-4 max-h-56 overflow-y-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-200">
                    {log.join('\n')}
                </pre>
            )}
        </div>
    );
}
