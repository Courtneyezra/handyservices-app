import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Globe, Server, Database, Phone, Check, Copy } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

// Define types based on the backend response
type Diagnostics = {
    timestamp: string;
    env: {
        deepgram_key_set: boolean;
        openai_key_set: boolean;
        twilio_account_sid_set: boolean;
        twilio_auth_token_set: boolean;
        node_env: string;
    };
    infrastructure: {
        database: boolean;
        host: string;
        protocol: string;
        server_uptime: number;
        active_tunnel?: string | null;
    };
    voice_server: {
        active_calls: number;
    };
};

export function ConnectionStatus() {
    const { data, isLoading, error, refetch } = useQuery<Diagnostics>({
        queryKey: ['diagnostics'],
        queryFn: async () => {
            const res = await fetch('/api/diagnostics');
            if (!res.ok) throw new Error('Failed to fetch diagnostics');
            return res.json();
        },
        refetchInterval: 5000 // Poll every 5s
    });

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast({ title: "Copied!", description: "URL copied to clipboard" });
    };

    const [isFixing, setIsFixing] = React.useState(false);

    const handleAutoFix = async () => {
        setIsFixing(true);
        try {
            const res = await fetch('/api/dev/fix-connection', { method: 'POST' });
            const json = await res.json();
            if (json.success) {
                toast({ title: "Connection Fixed!", description: `Updated webhook to ${json.url}` });
                // Force a reload to pick up the new host header if possible, or just refetch
                setTimeout(() => window.location.reload(), 1500);
            } else {
                toast({ variant: "destructive", title: "Fix Failed", description: json.error });
            }
        } catch (e) {
            toast({ variant: "destructive", title: "Error", description: "Failed to communicate with dev server." });
        } finally {
            setIsFixing(false);
        }
    };

    if (isLoading) return <Button variant="ghost" size="sm" className="w-[140px]"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking...</Button>;

    if (error) {
        return (
            <Button variant="destructive" size="sm" onClick={() => refetch()} className="w-[140px]">
                <XCircle className="mr-2 h-4 w-4" /> Error
            </Button>
        );
    }

    // Calculate Overall Status
    const isLocalhost = data?.infrastructure.host?.includes('localhost') || data?.infrastructure.host?.includes('127.0.0.1');
    const isHttp = data?.infrastructure.protocol === 'http';
    const missingKeys = !data?.env.deepgram_key_set || !data?.env.openai_key_set || !data?.env.twilio_account_sid_set;
    const dbDown = !data?.infrastructure.database;

    const hasCriticalIssues = missingKeys || dbDown;
    // Only warn if localhost has NO tunnel, or if public HTTP (insecure)
    const hasWarnings = (isLocalhost && !data?.infrastructure.active_tunnel) || (isHttp && !isLocalhost);

    let statusColor = "bg-green-500";
    let statusText = "System Healthy";
    if (hasCriticalIssues) {
        statusColor = "bg-red-500";
        statusText = "Critical Issues";
    } else if (hasWarnings) {
        statusColor = "bg-yellow-500";
        statusText = "Warnings";
    }

    const fullUrl = `${data?.infrastructure.protocol}://${data?.infrastructure.host}`;

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 border-dashed">
                    <div className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
                    {statusText}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] bg-background">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        System Diagnostics
                        {hasCriticalIssues && <span className="text-sm font-normal text-red-500">(Action Required)</span>}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    {/* Public Access Warning - ONLY show if localhost AND no tunnel detected */}
                    {(isLocalhost ? !data?.infrastructure.active_tunnel : isHttp) && (
                        <Alert variant={isLocalhost ? "destructive" : "default"} className={isLocalhost ? "" : "border-yellow-500 text-yellow-500"}>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>{isLocalhost ? "Public Access Error" : "Secure Connection Warning"}</AlertTitle>
                            <AlertDescription className="mt-2">
                                {isLocalhost ? (
                                    <span>
                                        Twilio <strong>cannot</strong> connect to <code>{data?.infrastructure.host}</code>.
                                        You are likely not receiving any voice calls. Use ngrok to expose your local server.
                                        <div className="mt-3">
                                            <Button
                                                size="sm"
                                                variant="default"
                                                className="bg-red-600 hover:bg-red-700 text-white border-0 shadow-sm"
                                                onClick={handleAutoFix}
                                                disabled={isFixing}
                                            >
                                                {isFixing ? (
                                                    <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Fixing Tunnel...</>
                                                ) : (
                                                    "Auto-fix Connection"
                                                )}
                                            </Button>
                                        </div>
                                    </span>
                                ) : (
                                    <span>
                                        You are using HTTP instead of HTTPS. Some browser features (mic) might checks.
                                    </span>
                                )}
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Infrastructure */}
                    <div className="grid grid-cols-2 gap-4">
                        <StatusItem
                            icon={Globe}
                            label="Host URL"
                            value={data?.infrastructure.host}
                            status={isLocalhost ? 'error' : 'success'}
                            action={<Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(fullUrl)}><Copy className="h-3 w-3" /></Button>}
                        />
                        <StatusItem
                            icon={Server}
                            label="Protocol"
                            value={data?.infrastructure.protocol?.toUpperCase()}
                            status={isHttp ? 'warning' : 'success'}
                        />
                        <StatusItem
                            icon={Database}
                            label="Database"
                            value={data?.infrastructure.database ? 'Connected' : 'Disconnected'}
                            status={data?.infrastructure.database ? 'success' : 'error'}
                        />
                        <StatusItem
                            icon={Phone}
                            label="Active Voice Calls"
                            value={(data?.voice_server?.active_calls || 0).toString()}
                            status={(data?.voice_server?.active_calls || 0) > 0 ? 'success' : 'neutral'}
                        />
                    </div>

                    {/* Service Keys */}
                    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                            API Configuration
                            {missingKeys && <span className="text-red-500 text-xs font-normal">- Missing Keys</span>}
                        </h4>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-8">
                            <CheckItem label="Twilio Account SID" checked={data?.env.twilio_account_sid_set} />
                            <CheckItem label="Twilio Auth Token" checked={data?.env.twilio_auth_token_set} />
                            <CheckItem label="Deepgram API Key" checked={data?.env.deepgram_key_set} />
                            <CheckItem label="OpenAI API Key" checked={data?.env.openai_key_set} />
                        </div>
                    </div>

                    <div className="text-[10px] text-muted-foreground pt-4 border-t flex justify-between">
                        <span>Env: {data?.env.node_env}</span>
                        <span>Uptime: {Math.floor(data?.infrastructure.server_uptime || 0)}s</span>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function StatusItem({ icon: Icon, label, value, status, action }: any) {
    const colors = {
        success: "text-green-500",
        warning: "text-yellow-500",
        error: "text-red-500",
        neutral: "text-muted-foreground"
    };
    return (
        <div className="flex items-center space-x-3 p-3 border rounded-lg bg-card border-border">
            <div className={`p-2 rounded-full bg-muted`}>
                <Icon className={`h-4 w-4 ${colors[status as keyof typeof colors]}`} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <div className="flex items-center gap-1">
                    <p className="text-sm font-semibold truncate" title={value}>{value}</p>
                    {action}
                </div>
            </div>
        </div>
    );
}

function CheckItem({ label, checked }: { label: string, checked: boolean | undefined }) {
    return (
        <div className="flex items-center justify-between text-sm">
            <span className={checked ? "text-foreground" : "text-destructive font-medium"}>{label}</span>
            {checked ?
                <div className="flex items-center text-green-500 text-xs font-medium gap-1"><Check className="h-3 w-3" /> Set</div> :
                <div className="flex items-center text-red-500 text-xs font-medium gap-1"><XCircle className="h-3 w-3" /> Missing</div>
            }
        </div>
    );
}
