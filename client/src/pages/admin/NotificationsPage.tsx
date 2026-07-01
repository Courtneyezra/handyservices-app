import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Loader2, Save, Plus, Trash2, Send, Bell, Phone, FileText,
    CheckCircle2, AlertTriangle, Smartphone, Moon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
    DEFAULT_PUSHOVER_CONFIG, PUSHOVER_SOUNDS, PUSHOVER_PRIORITY_OPTIONS, PUSHOVER_EVENT_DEFS,
    type PushoverConfig, type PushoverEventKey, type PushoverPriority, type PushoverRecipient,
} from "@shared/pushover-settings";

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem("adminToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface PushoverResponse {
    config: PushoverConfig;
    tokenConfigured: boolean;
}
interface WebPushStatus {
    configured: boolean;
    subscriptionCount: number;
}

const GROUP_ORDER = ["Inbound", "Money", "Dispatch"] as const;

export default function NotificationsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [form, setForm] = useState<PushoverConfig>(DEFAULT_PUSHOVER_CONFIG);
    const [tokenConfigured, setTokenConfigured] = useState(false);
    const [initialized, setInitialized] = useState(false);

    const { data, isLoading } = useQuery<PushoverResponse>({
        queryKey: ["pushoverConfig"],
        queryFn: async () => {
            const res = await fetch("/api/settings/pushover", { headers: getAuthHeaders() });
            if (!res.ok) throw new Error("Failed to fetch notification settings");
            return res.json();
        },
    });

    const { data: webPush } = useQuery<WebPushStatus>({
        queryKey: ["webPushStatus"],
        queryFn: async () => {
            const res = await fetch("/api/push/status", { headers: getAuthHeaders() });
            if (!res.ok) throw new Error("Failed to fetch web push status");
            return res.json();
        },
    });

    useEffect(() => {
        if (data && !initialized) {
            setForm(data.config);
            setTokenConfigured(data.tokenConfigured);
            setInitialized(true);
        }
    }, [data, initialized]);

    const saveMutation = useMutation({
        mutationFn: async (cfg: PushoverConfig) => {
            const res = await fetch("/api/settings/pushover", {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify(cfg),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Save failed" }));
                throw new Error(err.details?.join(", ") || err.error || "Failed to save");
            }
            return res.json();
        },
        onSuccess: (d) => {
            queryClient.invalidateQueries({ queryKey: ["pushoverConfig"] });
            toast({ title: "Saved", description: "Notification settings updated." });
            if (d.config) setForm(d.config);
        },
        onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    });

    async function sendTest(event: PushoverEventKey, userKey?: string) {
        try {
            const res = await fetch("/api/settings/pushover/test", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify({ event, userKey }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || "Test failed");
            toast({ title: "Test sent", description: `Delivered to ${j.sent} device(s). Check the phone.` });
        } catch (e: any) {
            toast({ title: "Test failed", description: e.message, variant: "destructive" });
        }
    }

    async function testBrowserPush() {
        try {
            const res = await fetch("/api/push/test", { method: "POST", headers: getAuthHeaders() });
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Failed"); }
            toast({ title: "Browser test sent", description: "Sent to all subscribed browsers." });
        } catch (e: any) {
            toast({ title: "Failed", description: e.message, variant: "destructive" });
        }
    }

    async function enableThisBrowser() {
        try {
            if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser doesn't support push.");
            const permission = await Notification.requestPermission();
            if (permission !== "granted") throw new Error("Permission denied.");
            const reg = await navigator.serviceWorker.ready;
            const keyRes = await fetch("/api/push/vapid-public-key");
            const { publicKey } = await keyRes.json();
            if (!publicKey) throw new Error("No VAPID key configured on the server.");
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                const padding = "=".repeat((4 - publicKey.length % 4) % 4);
                const b64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
                const raw = window.atob(b64);
                const appKey = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
            }
            await fetch("/api/push/subscribe", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()),
            });
            queryClient.invalidateQueries({ queryKey: ["webPushStatus"] });
            toast({ title: "Enabled", description: "Browser notifications enabled on this device." });
        } catch (e: any) {
            toast({ title: "Couldn't enable", description: e.message, variant: "destructive" });
        }
    }

    // ---- form helpers ----
    function update<K extends keyof PushoverConfig>(key: K, value: PushoverConfig[K]) {
        setForm((p) => ({ ...p, [key]: value }));
    }
    function updateEvent(evt: PushoverEventKey, patch: Partial<PushoverConfig["events"][PushoverEventKey]>) {
        setForm((p) => ({ ...p, events: { ...p.events, [evt]: { ...p.events[evt], ...patch } } }));
    }
    function updateQuiet(patch: Partial<PushoverConfig["quietHours"]>) {
        setForm((p) => ({ ...p, quietHours: { ...p.quietHours, ...patch } }));
    }
    function updateRecipient(id: string, patch: Partial<PushoverRecipient>) {
        setForm((p) => ({ ...p, recipients: p.recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    }
    function addRecipient() {
        setForm((p) => ({
            ...p,
            recipients: [...p.recipients, {
                id: crypto.randomUUID(), name: "", userKey: "", enabled: true, events: {},
            }],
        }));
    }
    function removeRecipient(id: string) {
        setForm((p) => ({ ...p, recipients: p.recipients.filter((r) => r.id !== id) }));
    }

    if (isLoading) {
        return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
    }

    const ready = tokenConfigured && form.recipients.some((r) => r.enabled);

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-24">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="h-6 w-6" /> Notifications</h1>
                    <p className="text-muted-foreground text-sm">Control who gets phone alerts for calls and leads, and how loud they are.</p>
                </div>
                <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save changes
                </Button>
            </div>

            {/* Status banner */}
            <Card className={ready ? "border-green-500/40" : "border-amber-500/50"}>
                <CardContent className="flex items-center gap-3 py-4">
                    {ready
                        ? <><CheckCircle2 className="h-5 w-5 text-green-600" /><span className="text-sm">Pushover connected — <strong>{form.recipients.filter((r) => r.enabled).length}</strong> active recipient(s).</span></>
                        : <><AlertTriangle className="h-5 w-5 text-amber-600" /><span className="text-sm">{!tokenConfigured ? "No app token set on the server (PUSHOVER_APP_TOKEN). Alerts are disabled until it's added in Railway." : "No enabled recipients yet — add one below."}</span></>}
                </CardContent>
            </Card>

            {/* Master switch */}
            <Card>
                <CardContent className="flex items-center justify-between py-4">
                    <div>
                        <Label className="text-base">Phone alerts enabled</Label>
                        <p className="text-sm text-muted-foreground">Master switch for all Pushover alerts.</p>
                    </div>
                    <Switch checked={form.enabled} onCheckedChange={(v) => update("enabled", v)} />
                </CardContent>
            </Card>

            {/* Recipients */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Recipients</CardTitle>
                    <CardDescription>Each person needs the Pushover app + their user key (shown on their Pushover welcome screen). Add anyone here — no redeploy needed.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {form.recipients.length === 0 && <p className="text-sm text-muted-foreground">No recipients yet.</p>}
                    {form.recipients.map((r) => (
                        <div key={r.id} className="rounded-lg border p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <Switch checked={r.enabled} onCheckedChange={(v) => updateRecipient(r.id, { enabled: v })} />
                                <Input className="flex-1" placeholder="Name (e.g. Ben)" value={r.name} onChange={(e) => updateRecipient(r.id, { name: e.target.value })} />
                                <Button variant="ghost" size="icon" onClick={() => removeRecipient(r.id)} title="Remove"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                            <Input placeholder="Pushover user key (or delivery group key)" value={r.userKey} onChange={(e) => updateRecipient(r.id, { userKey: e.target.value.trim() })} />
                            <div>
                                <div className="text-xs text-muted-foreground mb-2">Receives:</div>
                                <div className="flex flex-wrap gap-2">
                                    {PUSHOVER_EVENT_DEFS.map((def) => {
                                        const on = r.events[def.key] !== false;
                                        return (
                                            <button
                                                key={def.key}
                                                type="button"
                                                onClick={() => updateRecipient(r.id, { events: { ...r.events, [def.key]: !on } })}
                                                className={`text-xs rounded-full px-3 py-1 border transition-colors ${on ? "bg-primary/10 border-primary/40 text-foreground" : "bg-transparent border-border text-muted-foreground"}`}
                                            >
                                                {def.short}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <Button variant="outline" size="sm" disabled={!r.userKey} onClick={() => sendTest("call", r.userKey)}><Send className="h-3 w-3 mr-1" /> Send test</Button>
                            </div>
                        </div>
                    ))}
                    <Button variant="outline" onClick={addRecipient}><Plus className="h-4 w-4 mr-2" /> Add recipient</Button>
                </CardContent>
            </Card>

            {/* Per-event settings */}
            <Card>
                <CardHeader>
                    <CardTitle>Alert types</CardTitle>
                    <CardDescription>Turn each event on/off and set how insistent it is.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {GROUP_ORDER.map((group) => (
                        <div key={group} className="space-y-4">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">{group}</div>
                            {PUSHOVER_EVENT_DEFS.filter((d) => d.group === group).map((def) => {
                                const ev = form.events[def.key] ?? { enabled: true, priority: def.defaultPriority, sound: def.defaultSound };
                                return (
                                    <div key={def.key} className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-base">{def.label}</Label>
                                            <Switch checked={ev.enabled} onCheckedChange={(v) => updateEvent(def.key, { enabled: v })} />
                                        </div>
                                        {ev.enabled && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-2">
                                                <div>
                                                    <Label className="text-xs text-muted-foreground">Priority</Label>
                                                    <Select value={String(ev.priority)} onValueChange={(v) => updateEvent(def.key, { priority: Number(v) as PushoverPriority })}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {PUSHOVER_PRIORITY_OPTIONS.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <Label className="text-xs text-muted-foreground">Sound</Label>
                                                    <Select value={ev.sound} onValueChange={(v) => updateEvent(def.key, { sound: v })}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {PUSHOVER_SOUNDS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {group !== GROUP_ORDER[GROUP_ORDER.length - 1] && <Separator />}
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Link behaviour */}
            <Card>
                <CardHeader>
                    <CardTitle>Tap-to-contact link</CardTitle>
                    <CardDescription>What happens when you tap the phone number on an alert.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <Label className="text-xs text-muted-foreground">Link opens</Label>
                        <Select value={form.linkType} onValueChange={(v) => update("linkType", v as PushoverConfig["linkType"])}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="whatsapp">WhatsApp chat (message or call)</SelectItem>
                                <SelectItem value="tel">Phone dialer (tel:)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-xs text-muted-foreground">Default country code (for local 0… numbers)</Label>
                        <Input value={form.defaultCountryCode} onChange={(e) => update("defaultCountryCode", e.target.value.replace(/\D/g, ""))} placeholder="44" />
                    </div>
                </CardContent>
            </Card>

            {/* Quiet hours */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Moon className="h-5 w-5" /> Quiet hours</CardTitle>
                    <CardDescription>Mute or soften alerts overnight.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <Label>Enable quiet hours</Label>
                        <Switch checked={form.quietHours.enabled} onCheckedChange={(v) => updateQuiet({ enabled: v })} />
                    </div>
                    {form.quietHours.enabled && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                                <Label className="text-xs text-muted-foreground">From</Label>
                                <Input type="time" value={form.quietHours.start} onChange={(e) => updateQuiet({ start: e.target.value })} />
                            </div>
                            <div>
                                <Label className="text-xs text-muted-foreground">To</Label>
                                <Input type="time" value={form.quietHours.end} onChange={(e) => updateQuiet({ end: e.target.value })} />
                            </div>
                            <div>
                                <Label className="text-xs text-muted-foreground">Timezone</Label>
                                <Input value={form.quietHours.timezone} onChange={(e) => updateQuiet({ timezone: e.target.value })} placeholder="Europe/London" />
                            </div>
                            <div>
                                <Label className="text-xs text-muted-foreground">During quiet hours</Label>
                                <Select value={form.quietHours.mode} onValueChange={(v) => updateQuiet({ mode: v as PushoverConfig["quietHours"]["mode"] })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="downgrade">Soften (no repeat)</SelectItem>
                                        <SelectItem value="mute">Mute completely</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Browser push */}
            <Card>
                <CardHeader>
                    <CardTitle>Browser notifications</CardTitle>
                    <CardDescription>Desktop/laptop alerts for the admin dashboard (separate from phone alerts).</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3">
                    <Badge variant={webPush?.configured ? "default" : "secondary"}>
                        {webPush?.configured ? "Configured" : "Not configured"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{webPush?.subscriptionCount ?? 0} subscribed browser(s)</span>
                    <div className="ml-auto flex gap-2">
                        <Button variant="outline" size="sm" onClick={enableThisBrowser}>Enable on this device</Button>
                        <Button variant="outline" size="sm" onClick={testBrowserPush}><Send className="h-3 w-3 mr-1" /> Test</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
