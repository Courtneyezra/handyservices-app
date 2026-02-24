import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Settings, Phone, Volume2, MessageSquare, CheckCircle, XCircle, Loader2, AlertCircle, PhoneForwarded, Clock, Timer, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DaySelector } from '@/components/ui/day-selector';
import { LiveSchedulePreview } from '@/components/ui/live-schedule-preview';

interface TwilioSettings {
    'twilio.business_name': string;
    'twilio.welcome_message': string;
    'twilio.voice': string;
    'twilio.hold_music_url': string;
    'twilio.max_wait_seconds': number;
    'twilio.forward_number': string;
    'twilio.forward_enabled': boolean;
    'twilio.fallback_action': string;
    'twilio.fallback_message': string;
    'twilio.reassurance_enabled': boolean;
    'twilio.reassurance_interval': number;
    'twilio.reassurance_message': string;
    'twilio.agent_notify_sms': string;
    'twilio.agent_missed_sms': string;
    'twilio.whisper_enabled': boolean;
    'twilio.welcome_audio_url': string;
    'twilio.fallback_agent_url': string;
    'twilio.eleven_labs_agent_id': string;
    'twilio.eleven_labs_busy_agent_id': string;
    'twilio.eleven_labs_api_key': string;
    // Agent Modes
    'twilio.agent_mode': string;
    'twilio.agent_context_default': string;
    'twilio.agent_context_out_of_hours': string;
    'twilio.agent_context_missed': string;
    'twilio.business_hours_start': string;
    'twilio.business_hours_end': string;
    'twilio.business_days': string;
}

const defaultSettings: TwilioSettings = {
    'twilio.business_name': 'Handy Services',
    'twilio.welcome_message': 'Hello, thank you for calling {business_name}. One of our team will be with you shortly.',
    'twilio.voice': 'Polly.Amy-Neural',
    'twilio.hold_music_url': '/assets/hold-music.mp3',
    'twilio.max_wait_seconds': 30,
    'twilio.forward_number': '',
    'twilio.forward_enabled': false,
    'twilio.fallback_action': 'whatsapp',
    'twilio.fallback_message': "Sorry we missed your call. We will call you back shortly. In the meantime, you can reach us on WhatsApp here: https://wa.me/447508744402",
    'twilio.reassurance_enabled': true,
    'twilio.reassurance_interval': 15,
    'twilio.reassurance_message': 'Thanks for waiting, just connecting you now.',
    'twilio.agent_notify_sms': '📞 Incoming call from {lead_number} to {twilio_uk_number}',
    'twilio.agent_missed_sms': "❌ Missed call from {lead_number}. Lead was sent an auto-SMS.",
    'twilio.whisper_enabled': false,
    'twilio.welcome_audio_url': '/assets/handyservices-welcome.mp3',
    'twilio.fallback_agent_url': '',
    'twilio.eleven_labs_agent_id': '',
    'twilio.eleven_labs_busy_agent_id': '',
    'twilio.eleven_labs_api_key': '',
    // Agent Modes
    'twilio.agent_mode': 'auto',
    'twilio.agent_context_default': 'A team member will be with you shortly. I can help answer questions about our services while you wait.',
    'twilio.agent_context_out_of_hours': 'We are currently closed. Our hours are 8am-6pm Monday to Friday. Please leave a message and we will call you back first thing.',
    'twilio.agent_context_missed': "Sorry for the wait! Our team couldn't get to the phone. I'm here to help though - what can I do for you?",
    'twilio.business_hours_start': '08:00',
    'twilio.business_hours_end': '18:00',
    'twilio.business_days': '1,2,3,4,5',
};

interface ForwardStatus {
    status: 'valid' | 'invalid' | 'unknown' | 'unconfigured' | 'checking';
    message: string;
    isValid: boolean;
    countryCode?: string;
    nationalFormat?: string;
}

export default function SettingsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [, setLocation] = useLocation();

    // Tab persistence via URL query params
    const getInitialTab = () => {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        return tab && ['routing', 'experience', 'fallback', 'timing'].includes(tab) ? tab : 'routing';
    };
    const [activeTab, setActiveTab] = useState(getInitialTab);

    const handleTabChange = useCallback((value: string) => {
        setActiveTab(value);
        const url = new URL(window.location.href);
        url.searchParams.set('tab', value);
        window.history.replaceState({}, '', url.toString());
    }, []);

    const [localSettings, setLocalSettings] = useState<TwilioSettings>(defaultSettings);
    const [forwardStatus, setForwardStatus] = useState<ForwardStatus>({ status: 'unconfigured', message: 'Enter a forward number', isValid: false });
    const [agentStatus, setAgentStatus] = useState<ForwardStatus>({ status: 'unconfigured', message: 'Enter an agent ID', isValid: false });
    const [busyAgentStatus, setBusyAgentStatus] = useState<ForwardStatus>({ status: 'unconfigured', message: 'Enter an agent ID', isValid: false });
    const [apiKeyStatus, setApiKeyStatus] = useState<ForwardStatus>({ status: 'unconfigured', message: 'Enter an API key', isValid: false });
    const [isDirty, setIsDirty] = useState(false);


    // Fetch settings
    const { data: settingsData, isLoading } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const res = await fetch('/api/settings');
            if (!res.ok) throw new Error('Failed to fetch settings');
            return res.json();
        },
        staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
        refetchOnWindowFocus: false, // Don't refetch when returning to the tab
    });

    // Save settings mutation
    const saveMutation = useMutation({
        mutationFn: async (settings: Partial<TwilioSettings>) => {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings }),
            });
            if (!res.ok) throw new Error('Failed to save settings');
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Settings saved', description: 'Your call routing settings have been updated.' });
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            setIsDirty(false);
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to save settings', variant: 'destructive' });
        },
    });

    // Seed defaults mutation
    const seedMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/settings/seed', { method: 'POST' });
            if (!res.ok) throw new Error('Failed to seed settings');
            return res.json();
        },
        onSuccess: (data) => {
            toast({ title: 'Defaults seeded', description: `Initialized ${data.seeded.length} settings` });
            queryClient.invalidateQueries({ queryKey: ['settings'] });
        },
    });

    // Fetch Twilio Balance
    const { data: balanceData } = useQuery({
        queryKey: ['twilio-balance'],
        queryFn: async () => {
            const res = await fetch('/api/settings/balance');
            if (!res.ok) return null;
            return res.json();
        },
        refetchInterval: 30000, // Refresh every 30s
    });

    // ============================================
    // CALL TIMING SETTINGS
    // ============================================
    interface CallTimingSettings {
        skuDebounceMs: number;
        tier2LlmDebounceMs: number;
        metadataChunkInterval: number;
        metadataCharThreshold: number;
    }

    interface CallTimingDefaults {
        skuDebounceMs: number;
        tier2LlmDebounceMs: number;
        metadataChunkInterval: number;
        metadataCharThreshold: number;
    }

    interface CallTimingDescriptions {
        skuDebounceMs: string;
        tier2LlmDebounceMs: string;
        metadataChunkInterval: string;
        metadataCharThreshold: string;
    }

    const [timingSettings, setTimingSettings] = useState<CallTimingSettings>({
        skuDebounceMs: 300,
        tier2LlmDebounceMs: 500,
        metadataChunkInterval: 5,
        metadataCharThreshold: 150,
    });
    const [timingDefaults, setTimingDefaults] = useState<CallTimingDefaults | null>(null);
    const [timingDescriptions, setTimingDescriptions] = useState<CallTimingDescriptions | null>(null);
    const [isTimingDirty, setIsTimingDirty] = useState(false);

    // Fetch call timing settings
    const { data: timingData, isLoading: isTimingLoading } = useQuery({
        queryKey: ['call-timing-settings'],
        queryFn: async () => {
            const res = await fetch('/api/settings/call-timing');
            if (!res.ok) throw new Error('Failed to fetch call timing settings');
            return res.json();
        },
        staleTime: 60 * 1000, // 1 minute
    });

    // Load timing settings into local state
    useEffect(() => {
        if (timingData) {
            setTimingSettings(timingData.settings);
            setTimingDefaults(timingData.defaults);
            setTimingDescriptions(timingData.descriptions);
        }
    }, [timingData]);

    // Save call timing settings mutation
    const saveTimingMutation = useMutation({
        mutationFn: async (settings: Partial<CallTimingSettings>) => {
            const res = await fetch('/api/settings/call-timing', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            if (!res.ok) throw new Error('Failed to save call timing settings');
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Timing settings saved', description: 'Call timing constants have been updated.' });
            queryClient.invalidateQueries({ queryKey: ['call-timing-settings'] });
            setIsTimingDirty(false);
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to save timing settings', variant: 'destructive' });
        },
    });

    const updateTimingSetting = <K extends keyof CallTimingSettings>(key: K, value: CallTimingSettings[K]) => {
        setTimingSettings(prev => ({ ...prev, [key]: value }));
        setIsTimingDirty(true);
    };

    const handleSaveTiming = () => {
        saveTimingMutation.mutate(timingSettings);
    };

    const handleResetTiming = () => {
        if (timingDefaults) {
            setTimingSettings(timingDefaults);
            setIsTimingDirty(true);
        }
    };

    // Check forward number status
    const checkForwardStatus = async (phoneNumber: string) => {
        if (!phoneNumber) {
            setForwardStatus({ status: 'unconfigured', message: 'Enter a forward number', isValid: false });
            return;
        }

        setForwardStatus({ status: 'checking', message: 'Validating...', isValid: false });

        try {
            const res = await fetch('/api/settings/check-forward-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber }),
            });
            const data = await res.json();
            setForwardStatus(data);
        } catch {
            setForwardStatus({ status: 'unknown', message: 'Could not verify number', isValid: false });
        }
    };

    // Load settings into local state
    useEffect(() => {
        if (settingsData?.settings) {
            setLocalSettings({
                ...defaultSettings,
                ...settingsData.settings,
            });
            // Check forward number on load
            const forwardNum = settingsData.settings['twilio.forward_number'];
            if (forwardNum) {
                checkForwardStatus(forwardNum);
            }
            // Check agent ID on load - pass API key directly to avoid race condition
            const agentId = settingsData.settings['twilio.eleven_labs_agent_id'];
            const apiKey = settingsData.settings['twilio.eleven_labs_api_key'];
            if (apiKey) {
                checkApiKeyStatus(apiKey);
            }
            if (agentId && apiKey) {
                // Verify agent with the API key from settings data
                checkAgentStatusWithKey(agentId, apiKey);
            }
            // Check busy agent ID on load
            const busyAgentId = settingsData.settings['twilio.eleven_labs_busy_agent_id'];
            if (busyAgentId && apiKey) {
                checkBusyAgentStatusWithKey(busyAgentId, apiKey);
            }
        }
    }, [settingsData]);

    const updateSetting = <K extends keyof TwilioSettings>(key: K, value: TwilioSettings[K]) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
        setIsDirty(true);
    };

    const handleSave = () => {
        saveMutation.mutate(localSettings);
    };

    const getStatusIcon = (status: ForwardStatus['status']) => {
        switch (status) {
            case 'valid':
                return <CheckCircle className="w-5 h-5 text-green-600" />;
            case 'invalid':
                return <XCircle className="w-5 h-5 text-red-600" />;
            case 'checking':
                return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
            case 'unconfigured':
                return <AlertCircle className="w-5 h-5 text-muted-foreground" />;
            default:
                return <AlertCircle className="w-5 h-5 text-amber-500" />;
        }
    };

    const getStatusColor = (status: ForwardStatus['status']) => {
        switch (status) {
            case 'valid':
                return 'border-green-500/50 bg-green-500/10';
            case 'invalid':
                return 'border-red-500/50 bg-red-500/10';
            case 'checking':
                return 'border-primary/50 bg-primary/10';
            default:
                return 'border-input bg-muted/50';
        }
    };

    const checkAgentStatus = async (agentId: string) => {
        if (!agentId) {
            setAgentStatus({ status: 'unconfigured', message: 'Enter an agent ID', isValid: false });
            return;
        }
        const apiKey = localSettings['twilio.eleven_labs_api_key'];
        checkAgentStatusWithKey(agentId, apiKey);
    };

    // Separate function that accepts API key directly (for use on initial load)
    const checkAgentStatusWithKey = async (agentId: string, apiKey: string) => {
        if (!agentId) {
            setAgentStatus({ status: 'unconfigured', message: 'Enter an agent ID', isValid: false });
            return;
        }

        setAgentStatus(prev => ({ ...prev, status: 'checking', message: 'Verifying...' }));
        try {
            const res = await fetch('/api/settings/check-agent-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, apiKey }),
            });
            const data = await res.json();
            setAgentStatus(data);

            // AUTO-ASSIGN: If verified successfully, automatically switch fallback behavior
            if (data.status === 'valid' && data.isValid) {
                updateSetting('twilio.fallback_action', 'eleven-labs');
                console.log(`[Settings] Auto-assigned Eleven Labs as fallback based on verified Agent ID: ${agentId}`);
            }
        } catch (error) {
            setAgentStatus({ status: 'unknown', message: 'Failed to verify agent', isValid: false });
        }
    };

    const checkBusyAgentStatus = async (agentId: string) => {
        if (!agentId) {
            setBusyAgentStatus({ status: 'unconfigured', message: 'Enter an agent ID', isValid: false });
            return;
        }
        const apiKey = localSettings['twilio.eleven_labs_api_key'];
        checkBusyAgentStatusWithKey(agentId, apiKey);
    };

    const checkBusyAgentStatusWithKey = async (agentId: string, apiKey: string) => {
        if (!agentId) {
            setBusyAgentStatus({ status: 'unconfigured', message: 'Enter an agent ID', isValid: false });
            return;
        }

        setBusyAgentStatus(prev => ({ ...prev, status: 'checking', message: 'Verifying...' }));
        try {
            const res = await fetch('/api/settings/check-agent-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, apiKey }),
            });
            const data = await res.json();
            setBusyAgentStatus(data);
        } catch (error) {
            setBusyAgentStatus({ status: 'unknown', message: 'Failed to verify agent', isValid: false });
        }
    };

    const checkApiKeyStatus = async (apiKey: string) => {
        if (!apiKey) {
            setApiKeyStatus({ status: 'unconfigured', message: 'Enter an API key', isValid: false });
            return;
        }
        setApiKeyStatus(prev => ({ ...prev, status: 'checking', message: 'Verifying...' }));
        try {
            const res = await fetch('/api/settings/check-api-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey }),
            });
            const data = await res.json();
            setApiKeyStatus(data);
        } catch (error) {
            setApiKeyStatus({ status: 'unknown', message: 'Failed to verify key', isValid: false });
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6 pb-24 bg-background min-h-screen">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Settings className="w-8 h-8 text-primary" />
                    <div>
                        <h1 className="text-xl lg:text-2xl font-bold text-secondary">Settings</h1>
                        <p className="text-xs lg:text-sm text-muted-foreground">Manage your call system configuration</p>
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 items-center">
                    {balanceData?.balance && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 text-green-600 rounded-md border border-green-500/20 mr-2">
                            <span className="text-xs font-medium">Twilio Credit:</span>
                            <span className="font-bold text-sm">{typeof balanceData.balance === 'number' ? Number(balanceData.balance).toFixed(2) : balanceData.balance} {balanceData.currency}</span>
                        </div>
                    )}
                    <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} size="sm">
                        {seedMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Seed Defaults
                    </Button>
                    <Button onClick={handleSave} disabled={!isDirty || saveMutation.isPending} size="sm">
                        {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : 'Save Changes'}
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="grid w-full grid-cols-4 mb-8 bg-muted border border-border">
                    <TabsTrigger value="routing">Call Routing</TabsTrigger>
                    <TabsTrigger value="experience">Experience</TabsTrigger>
                    <TabsTrigger value="fallback">Fallback</TabsTrigger>
                    <TabsTrigger value="timing">Call Timing</TabsTrigger>
                </TabsList>

                {/* Call Routing Tab */}
                <TabsContent value="routing" className="space-y-6 pt-2">
                    <Card className="jobber-card shadow-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <PhoneForwarded className="w-5 h-5 text-blue-600" />
                                Call Forwarding
                            </CardTitle>
                            <CardDescription>Route calls to your VA or team member</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border">
                                <div>
                                    <Label className="text-base font-medium text-foreground">Enable Call Forwarding</Label>
                                    <p className="text-sm text-muted-foreground">When enabled, calls will be forwarded to the number below</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-sm font-medium ${localSettings['twilio.forward_enabled'] ? 'text-primary' : 'text-muted-foreground'}`}>
                                        {localSettings['twilio.forward_enabled'] ? 'ON' : 'OFF'}
                                    </span>
                                    <Switch
                                        checked={localSettings['twilio.forward_enabled']}
                                        onCheckedChange={(val) => updateSetting('twilio.forward_enabled', val)}
                                        className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="forward-number" className="text-foreground">Forward Number (E.164 format)</Label>
                                <div className="flex gap-2">
                                    <div className={`flex-1 relative flex items-center rounded-md border-2 border-input bg-background ${getStatusColor(forwardStatus.status)}`}>
                                        <Phone className="w-4 h-4 ml-3 text-muted-foreground" />
                                        <Input
                                            id="forward-number"
                                            placeholder="+447700900000"
                                            value={localSettings['twilio.forward_number']}
                                            onChange={(e) => updateSetting('twilio.forward_number', e.target.value)}
                                            className="bg-transparent border-0 focus-visible:ring-0 text-foreground placeholder:text-muted-foreground"
                                        />
                                        <div className="pr-3">
                                            {getStatusIcon(forwardStatus.status)}
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        onClick={() => checkForwardStatus(localSettings['twilio.forward_number'])}
                                    >
                                        Verify
                                    </Button>
                                </div>
                                <p className={`text-sm ${forwardStatus.status === 'valid' ? 'text-green-600' : forwardStatus.status === 'invalid' ? 'text-red-600' : 'text-gray-500'}`}>
                                    {forwardStatus.message}
                                    {forwardStatus.nationalFormat && ` • ${forwardStatus.nationalFormat}`}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-foreground">Ring Timeout: {localSettings['twilio.max_wait_seconds']} seconds</Label>
                                <input
                                    type="range"
                                    min={10}
                                    max={60}
                                    step={5}
                                    value={localSettings['twilio.max_wait_seconds']}
                                    onChange={(e) => updateSetting('twilio.max_wait_seconds', parseInt(e.target.value))}
                                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                                />
                                <p className="text-sm text-muted-foreground">How long to ring the forward number before triggering fallback</p>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border">
                                <div>
                                    <Label className="text-base font-medium text-foreground">Whisper Lead Number</Label>
                                    <p className="text-sm text-muted-foreground">Play the lead's number to you before connecting</p>
                                </div>
                                <Switch
                                    checked={localSettings['twilio.whisper_enabled']}
                                    onCheckedChange={(val) => updateSetting('twilio.whisper_enabled', val)}
                                />
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Experience Tab */}
                <TabsContent value="experience" className="space-y-6 pt-2">
                    <Card className="jobber-card shadow-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Volume2 className="w-5 h-5 text-green-600" />
                                Caller Experience
                            </CardTitle>
                            <CardDescription>Customize what callers hear</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="business-name" className="text-foreground">Business Name</Label>
                                    <Input
                                        id="business-name"
                                        value={localSettings['twilio.business_name']}
                                        onChange={(e) => updateSetting('twilio.business_name', e.target.value)}
                                        className="bg-background border-input text-foreground"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="voice" className="text-foreground">Voice</Label>
                                    <Select
                                        value={localSettings['twilio.voice']}
                                        onValueChange={(val) => updateSetting('twilio.voice', val)}
                                    >
                                        <SelectTrigger id="voice" className="bg-background border-input text-foreground">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Polly.Amy-Neural">Amy (UK Female)</SelectItem>
                                            <SelectItem value="Polly.Brian-Neural">Brian (UK Male)</SelectItem>
                                            <SelectItem value="Polly.Emma-Neural">Emma (UK Female)</SelectItem>
                                            <SelectItem value="Polly.Arthur-Neural">Arthur (UK Male)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="welcome-message" className="text-foreground">Welcome Message</Label>
                                <Textarea
                                    id="welcome-message"
                                    value={localSettings['twilio.welcome_message']}
                                    onChange={(e) => updateSetting('twilio.welcome_message', e.target.value)}
                                    placeholder="Use {business_name} to insert the business name"
                                    rows={3}
                                    className="bg-background border-input text-foreground"
                                />
                                <p className="text-sm text-muted-foreground">Use {'{business_name}'} as a placeholder</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="welcome-audio" className="text-foreground">Welcome Audio</Label>
                                <div className="flex items-center gap-3">
                                    <Input
                                        id="welcome-audio"
                                        value={localSettings['twilio.welcome_audio_url']}
                                        onChange={(e) => updateSetting('twilio.welcome_audio_url', e.target.value)}
                                        placeholder="/assets/welcome-audio.mp3"
                                        className="flex-1 bg-background border-input text-foreground"
                                    />
                                    <label className="cursor-pointer">
                                        <input
                                            type="file"
                                            accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg"
                                            className="hidden"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;

                                                const formData = new FormData();
                                                formData.append('audio', file);

                                                try {
                                                    const response = await fetch('/api/settings/upload-audio', {
                                                        method: 'POST',
                                                        body: formData,
                                                    });
                                                    const data = await response.json();
                                                    if (data.success) {
                                                        updateSetting('twilio.welcome_audio_url', data.audioUrl);
                                                        alert('Audio uploaded successfully!');
                                                    } else {
                                                        alert(data.error || 'Upload failed');
                                                    }
                                                } catch (error) {
                                                    alert('Failed to upload audio');
                                                }
                                            }}
                                        />
                                        <span className="inline-flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                            </svg>
                                            Upload
                                        </span>
                                    </label>
                                </div>
                                <p className="text-sm text-muted-foreground">Upload an MP3/WAV file or enter a URL. Plays to callers before connecting.</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="hold-music" className="text-foreground">Hold Music URL</Label>
                                <Input
                                    id="hold-music"
                                    value={localSettings['twilio.hold_music_url']}
                                    onChange={(e) => updateSetting('twilio.hold_music_url', e.target.value)}
                                    placeholder="/assets/hold-music.mp3"
                                    className="bg-background border-input text-foreground"
                                />
                                <p className="text-sm text-muted-foreground">Audio played while lead is waiting to be connected</p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Fallback Tab */}
                <TabsContent value="fallback" className="space-y-6 pt-2">
                    <Card className="jobber-card shadow-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <MessageSquare className="w-5 h-5 text-purple-600" />
                                No-Answer Fallback
                            </CardTitle>
                            <CardDescription>What happens when no one answers</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label className="text-foreground">Fallback Action</Label>
                                <Select
                                    value={localSettings['twilio.fallback_action']}
                                    onValueChange={(val) => updateSetting('twilio.fallback_action', val)}
                                >
                                    <SelectTrigger className="bg-background border-input text-foreground">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="whatsapp">Send WhatsApp Message</SelectItem>
                                        <SelectItem value="voicemail">Take Voicemail</SelectItem>
                                        <SelectItem value="eleven-labs">Eleven Labs Voice Agent</SelectItem>
                                        <SelectItem value="none">Hang Up (No Fallback)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {localSettings['twilio.fallback_action'] === 'eleven-labs' && (
                                <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
                                    <div className="space-y-2">
                                        <Label htmlFor="eleven-labs-api-key" className="text-foreground">Eleven Labs API Key (Required)</Label>
                                        <div className="flex gap-2">
                                            <div className={`flex-1 relative flex items-center rounded-md border text-foreground bg-background border-input ${getStatusColor(apiKeyStatus.status)}`}>
                                                <AlertCircle className="w-4 h-4 ml-3 text-muted-foreground" />
                                                <Input
                                                    id="eleven-labs-api-key"
                                                    type="password"
                                                    placeholder="Enter your Eleven Labs API Key"
                                                    value={localSettings['twilio.eleven_labs_api_key']}
                                                    onChange={(e) => updateSetting('twilio.eleven_labs_api_key', e.target.value)}
                                                    className="bg-transparent border-0 focus-visible:ring-0 text-foreground placeholder:text-muted-foreground"
                                                />
                                                <div className="pr-3">
                                                    {getStatusIcon(apiKeyStatus.status)}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                onClick={() => checkApiKeyStatus(localSettings['twilio.eleven_labs_api_key'])}
                                                className="border-input hover:bg-muted"
                                            >
                                                Verify Key
                                            </Button>
                                        </div>
                                        <p className={`text-sm ${apiKeyStatus.status === 'valid' ? 'text-green-600' : apiKeyStatus.status === 'invalid' ? 'text-red-500' : 'text-muted-foreground'}`}>
                                            {apiKeyStatus.message}
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="eleven-labs-id" className="text-foreground">Eleven Labs Agent ID</Label>
                                        <div className="flex gap-2">
                                            <div className={`flex-1 relative flex items-center rounded-md border text-foreground bg-background border-input ${getStatusColor(agentStatus.status)}`}>
                                                <MessageSquare className="w-4 h-4 ml-3 text-muted-foreground" />
                                                <Input
                                                    id="eleven-labs-id"
                                                    placeholder="e.g. agent_abc123 or 27f64409-..."
                                                    value={localSettings['twilio.eleven_labs_agent_id']}
                                                    onChange={(e) => updateSetting('twilio.eleven_labs_agent_id', e.target.value)}
                                                    className="bg-transparent border-0 focus-visible:ring-0 text-foreground placeholder:text-muted-foreground"
                                                    disabled={apiKeyStatus.status !== 'valid'}
                                                />
                                                <div className="pr-3">
                                                    {getStatusIcon(agentStatus.status)}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                onClick={() => checkAgentStatus(localSettings['twilio.eleven_labs_agent_id'])}
                                                className="border-input hover:bg-muted"
                                                disabled={apiKeyStatus.status !== 'valid'}
                                            >
                                                Verify
                                            </Button>
                                        </div>
                                        <p className={`text-sm ${agentStatus.status === 'valid' ? 'text-green-600' : agentStatus.status === 'invalid' ? 'text-red-500' : 'text-muted-foreground'}`}>
                                            {apiKeyStatus.status !== 'valid'
                                                ? 'Verify your API key first to enable Agent ID verification'
                                                : agentStatus.message}
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="eleven-labs-busy-id" className="text-foreground">Busy Agent ID (Optional)</Label>
                                        <div className="flex gap-2">
                                            <div className={`flex-1 relative flex items-center rounded-md border text-foreground bg-background border-input ${getStatusColor(busyAgentStatus.status)}`}>
                                                <MessageSquare className="w-4 h-4 ml-3 text-muted-foreground" />
                                                <Input
                                                    id="eleven-labs-busy-id"
                                                    placeholder="e.g. agent_xyz789"
                                                    value={localSettings['twilio.eleven_labs_busy_agent_id']}
                                                    onChange={(e) => updateSetting('twilio.eleven_labs_busy_agent_id', e.target.value)}
                                                    className="bg-transparent border-0 focus-visible:ring-0 text-foreground placeholder:text-muted-foreground"
                                                    disabled={apiKeyStatus.status !== 'valid'}
                                                />
                                                <div className="pr-3">
                                                    {getStatusIcon(busyAgentStatus.status)}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                onClick={() => checkBusyAgentStatus(localSettings['twilio.eleven_labs_busy_agent_id'])}
                                                className="border-input hover:bg-muted"
                                                disabled={apiKeyStatus.status !== 'valid'}
                                            >
                                                Verify
                                            </Button>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <p className={`text-sm ${busyAgentStatus.status === 'valid' ? 'text-green-600' : busyAgentStatus.status === 'invalid' ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                {apiKeyStatus.status !== 'valid'
                                                    ? 'Verify your API key first to enable Agent ID verification'
                                                    : busyAgentStatus.message}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                Agent to handle calls when the main line is busy. Leave empty to use default.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="fallback-agent" className="text-foreground">Custom Agent URL (Optional Override)</Label>
                                        <Input
                                            id="fallback-agent"
                                            value={localSettings['twilio.fallback_agent_url']}
                                            onChange={(e) => updateSetting('twilio.fallback_agent_url', e.target.value)}
                                            placeholder="https://agent.elevenlabs.io/..."
                                            className="bg-background border-input text-foreground"
                                        />
                                        <p className="text-sm text-muted-foreground">
                                            Only use this if you need to override the standard redirection.
                                        </p>
                                    </div>

                                    {/* Agent Modes - Only visible when both API key and Agent ID are verified */}
                                    {(apiKeyStatus.status === 'valid' && agentStatus.status === 'valid') && (
                                        <div className="space-y-6 pt-6 border-t border-border mt-6">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-base font-semibold text-foreground">Agent Availability & Routing</h4>
                                                    <span className="text-xs bg-green-500/10 text-green-600 px-2 py-0.5 rounded border border-green-500/20">Active</span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                {/* Left Column: Mode Selection & Schedule */}
                                                <div className="md:col-span-2 space-y-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-base text-foreground">Operating Mode</Label>
                                                        <Select
                                                            value={localSettings['twilio.agent_mode'] || 'auto'}
                                                            onValueChange={(value) => updateSetting('twilio.agent_mode', value)}
                                                        >
                                                            <SelectTrigger className="h-12 text-base bg-background border-input text-foreground">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="auto">
                                                                    <div className="flex flex-col text-left">
                                                                        <span className="font-medium">Auto Schedule</span>
                                                                        <span className="text-xs text-muted-foreground">Follows business hours (UK Time)</span>
                                                                    </div>
                                                                </SelectItem>
                                                                <SelectItem value="force-in-hours">
                                                                    <div className="flex flex-col text-left">
                                                                        <span className="font-medium">Always Open</span>
                                                                        <span className="text-xs text-muted-foreground">Always route to VA/Agent (Override Schedule)</span>
                                                                    </div>
                                                                </SelectItem>
                                                                <SelectItem value="force-out-of-hours">
                                                                    <div className="flex flex-col text-left">
                                                                        <span className="font-medium">Always Closed</span>
                                                                        <span className="text-xs text-muted-foreground">Always route to Eleven Labs OOH / Voicemail</span>
                                                                    </div>
                                                                </SelectItem>
                                                                <SelectItem value="voicemail-only">
                                                                    <div className="flex flex-col text-left">
                                                                        <span className="font-medium">Voicemail Only</span>
                                                                        <span className="text-xs text-muted-foreground">Disable all AI agents</span>
                                                                    </div>
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    {/* Business Hours Configuration */}
                                                    <div className={cn(
                                                        "space-y-6 p-5 rounded-lg border transition-all duration-200",
                                                        localSettings['twilio.agent_mode'] === 'auto'
                                                            ? "bg-muted/30 border-border"
                                                            : "bg-muted/50 border-transparent opacity-60 pointer-events-none grayscale"
                                                    )}>
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Business Schedule (UK Time)</Label>
                                                            {localSettings['twilio.agent_mode'] !== 'auto' && (
                                                                <span className="text-xs font-medium text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">
                                                                    Ignored in current mode
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Presets */}
                                                        <div className="flex flex-wrap gap-2">
                                                            <Button
                                                                variant="outline" size="sm" className="h-7 text-xs border-dashed text-foreground hover:bg-muted"
                                                                onClick={() => {
                                                                    updateSetting('twilio.business_hours_start', '09:00');
                                                                    updateSetting('twilio.business_hours_end', '17:00');
                                                                    updateSetting('twilio.business_days', '1,2,3,4,5');
                                                                }}
                                                            >
                                                                Mon-Fri 9-5
                                                            </Button>
                                                            <Button
                                                                variant="outline" size="sm" className="h-7 text-xs border-dashed text-foreground hover:bg-muted"
                                                                onClick={() => {
                                                                    updateSetting('twilio.business_hours_start', '08:00');
                                                                    updateSetting('twilio.business_hours_end', '18:00');
                                                                    updateSetting('twilio.business_days', '1,2,3,4,5');
                                                                }}
                                                            >
                                                                Mon-Fri 8-6
                                                            </Button>
                                                            <Button
                                                                variant="outline" size="sm" className="h-7 text-xs border-dashed text-foreground hover:bg-muted"
                                                                onClick={() => {
                                                                    updateSetting('twilio.business_hours_start', '09:00');
                                                                    updateSetting('twilio.business_hours_end', '17:00');
                                                                    updateSetting('twilio.business_days', '1,2,3,4,5,6');
                                                                }}
                                                            >
                                                                Mon-Sat 9-5
                                                            </Button>
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="space-y-2">
                                                                <Label className="text-foreground">Opening Time</Label>
                                                                <div className="relative">
                                                                    <Input
                                                                        type="time"
                                                                        className="pl-8 bg-background border-input text-foreground"
                                                                        value={localSettings['twilio.business_hours_start'] || '08:00'}
                                                                        onChange={(e) => updateSetting('twilio.business_hours_start', e.target.value)}
                                                                    />
                                                                    <div className="absolute left-2.5 top-2.5 text-muted-foreground">
                                                                        <Clock className="w-4 h-4" />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className="text-foreground">Closing Time</Label>
                                                                <div className="relative">
                                                                    <Input
                                                                        type="time"
                                                                        className="pl-8 bg-background border-input text-foreground"
                                                                        value={localSettings['twilio.business_hours_end'] || '18:00'}
                                                                        onChange={(e) => updateSetting('twilio.business_hours_end', e.target.value)}
                                                                    />
                                                                    <div className="absolute left-2.5 top-2.5 text-muted-foreground">
                                                                        <Clock className="w-4 h-4" />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="space-y-3">
                                                            <Label className="text-foreground">Operational Days</Label>
                                                            <DaySelector
                                                                value={localSettings['twilio.business_days'] || '1,2,3,4,5'}
                                                                onChange={(value) => updateSetting('twilio.business_days', value)}
                                                                disabled={localSettings['twilio.agent_mode'] !== 'auto'}
                                                                className="bg-background border-input"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Right Column: Context/Prompt Settings */}
                                                <div className="space-y-6">
                                                    <LiveSchedulePreview
                                                        mode={localSettings['twilio.agent_mode']}
                                                        start={localSettings['twilio.business_hours_start']}
                                                        end={localSettings['twilio.business_hours_end']}
                                                        days={localSettings['twilio.business_days']}
                                                        className="bg-background border-input text-foreground"
                                                    />

                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">In-Hours Instructions</Label>
                                                        <Textarea
                                                            value={localSettings['twilio.agent_context_default'] || ''}
                                                            onChange={(e) => updateSetting('twilio.agent_context_default', e.target.value)}
                                                            rows={3}
                                                            placeholder="Instructions for the agent when answering during business hours..."
                                                            className="resize-none bg-background border-input text-foreground"
                                                        />
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Out-of-Hours Instructions</Label>
                                                        <Textarea
                                                            value={localSettings['twilio.agent_context_out_of_hours'] || ''}
                                                            onChange={(e) => updateSetting('twilio.agent_context_out_of_hours', e.target.value)}
                                                            rows={3}
                                                            placeholder="Instructions for AFTER hours (e.g., take a message)..."
                                                            className="resize-none bg-background border-input text-foreground"
                                                        />
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Missed Call Instructions</Label>
                                                        <Textarea
                                                            value={localSettings['twilio.agent_context_missed'] || ''}
                                                            onChange={(e) => updateSetting('twilio.agent_context_missed', e.target.value)}
                                                            rows={3}
                                                            placeholder="What to say if the human team missed the call..."
                                                            className="resize-none bg-background border-input text-foreground"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="fallback-message" className="text-foreground">Auto-SMS to Lead (Missed Call)</Label>
                                <Textarea
                                    id="fallback-message"
                                    value={localSettings['twilio.fallback_message']}
                                    onChange={(e) => updateSetting('twilio.fallback_message', e.target.value)}
                                    rows={4}
                                    className="bg-background border-input text-foreground"
                                />
                                <p className="text-sm text-muted-foreground">Sent to the customer if you miss the call (supports WhatsApp links)</p>
                            </div>

                            <div className="pt-6 border-t border-border space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="agent-notify-sms" className="text-foreground">Agent Notification SMS</Label>
                                    <Textarea
                                        id="agent-notify-sms"
                                        value={localSettings['twilio.agent_notify_sms']}
                                        onChange={(e) => updateSetting('twilio.agent_notify_sms', e.target.value)}
                                        rows={2}
                                        className="bg-background border-input text-foreground"
                                    />
                                    <p className="text-sm text-muted-foreground">Sent for every incoming call. Use {'{lead_number}'} and {'{twilio_uk_number}'}</p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="agent-missed-sms" className="text-foreground">Agent Missed Call SMS</Label>
                                    <Textarea
                                        id="agent-missed-sms"
                                        value={localSettings['twilio.agent_missed_sms']}
                                        onChange={(e) => updateSetting('twilio.agent_missed_sms', e.target.value)}
                                        rows={2}
                                        className="bg-background border-input text-foreground"
                                    />
                                    <p className="text-sm text-muted-foreground">Sent if you miss the call</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Call Timing Tab */}
                <TabsContent value="timing" className="space-y-6 pt-2">
                    <Card className="jobber-card shadow-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Timer className="w-5 h-5 text-orange-600" />
                                Live Call Timing Constants
                            </CardTitle>
                            <CardDescription>
                                Fine-tune the timing for live call analysis. These settings affect how quickly the system responds during calls.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {isTimingLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <>
                                    {/* SKU Debounce */}
                                    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-base font-medium text-foreground">SKU Analysis Delay</Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {timingDescriptions?.skuDebounceMs || 'How long to wait after the last transcript segment before running SKU detection'}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-2xl font-bold text-foreground">{timingSettings.skuDebounceMs}</span>
                                                <span className="text-sm text-muted-foreground ml-1">ms</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min={50}
                                            max={1000}
                                            step={50}
                                            value={timingSettings.skuDebounceMs}
                                            onChange={(e) => updateTimingSetting('skuDebounceMs', parseInt(e.target.value))}
                                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>50ms (faster)</span>
                                            <span className="text-orange-500">Default: {timingDefaults?.skuDebounceMs || 300}ms</span>
                                            <span>1000ms (slower)</span>
                                        </div>
                                    </div>

                                    {/* Tier 2 LLM Debounce */}
                                    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-base font-medium text-foreground">Segment Classification Delay</Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {timingDescriptions?.tier2LlmDebounceMs || 'Debounce time before calling the LLM for customer segment classification'}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-2xl font-bold text-foreground">{timingSettings.tier2LlmDebounceMs}</span>
                                                <span className="text-sm text-muted-foreground ml-1">ms</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min={100}
                                            max={2000}
                                            step={100}
                                            value={timingSettings.tier2LlmDebounceMs}
                                            onChange={(e) => updateTimingSetting('tier2LlmDebounceMs', parseInt(e.target.value))}
                                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>100ms (faster)</span>
                                            <span className="text-orange-500">Default: {timingDefaults?.tier2LlmDebounceMs || 500}ms</span>
                                            <span>2000ms (slower)</span>
                                        </div>
                                    </div>

                                    {/* Metadata Chunk Interval */}
                                    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-base font-medium text-foreground">Metadata Extraction Interval</Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {timingDescriptions?.metadataChunkInterval || 'Extract name/address every N transcript chunks'}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-2xl font-bold text-foreground">{timingSettings.metadataChunkInterval}</span>
                                                <span className="text-sm text-muted-foreground ml-1">chunks</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min={1}
                                            max={15}
                                            step={1}
                                            value={timingSettings.metadataChunkInterval}
                                            onChange={(e) => updateTimingSetting('metadataChunkInterval', parseInt(e.target.value))}
                                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>1 (every chunk)</span>
                                            <span className="text-orange-500">Default: {timingDefaults?.metadataChunkInterval || 5} chunks</span>
                                            <span>15 (less frequent)</span>
                                        </div>
                                    </div>

                                    {/* Metadata Character Threshold */}
                                    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <Label className="text-base font-medium text-foreground">Metadata Character Threshold</Label>
                                                <p className="text-sm text-muted-foreground">
                                                    {timingDescriptions?.metadataCharThreshold || 'Also extract metadata when transcript exceeds this many characters'}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-2xl font-bold text-foreground">{timingSettings.metadataCharThreshold}</span>
                                                <span className="text-sm text-muted-foreground ml-1">chars</span>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min={50}
                                            max={400}
                                            step={25}
                                            value={timingSettings.metadataCharThreshold}
                                            onChange={(e) => updateTimingSetting('metadataCharThreshold', parseInt(e.target.value))}
                                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>50 (more frequent)</span>
                                            <span className="text-orange-500">Default: {timingDefaults?.metadataCharThreshold || 150} chars</span>
                                            <span>400 (less frequent)</span>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center justify-between pt-4 border-t border-border">
                                        <Button
                                            variant="outline"
                                            onClick={handleResetTiming}
                                            disabled={!timingDefaults}
                                            className="gap-2"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                            Reset to Defaults
                                        </Button>
                                        <Button
                                            onClick={handleSaveTiming}
                                            disabled={!isTimingDirty || saveTimingMutation.isPending}
                                            className="gap-2"
                                        >
                                            {saveTimingMutation.isPending ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <CheckCircle className="w-4 h-4" />
                                            )}
                                            Save Timing Settings
                                        </Button>
                                    </div>

                                    {isTimingDirty && (
                                        <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-500/10 px-3 py-2 rounded-md border border-orange-500/20">
                                            <AlertCircle className="w-4 h-4" />
                                            You have unsaved timing changes
                                        </div>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* Help Section */}
                    <Card className="jobber-card shadow-sm border-blue-500/20 bg-blue-500/5">
                        <CardContent className="pt-6">
                            <div className="flex gap-3">
                                <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                                <div className="space-y-2 text-sm">
                                    <p className="font-medium text-foreground">How these settings affect live calls:</p>
                                    <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                                        <li><strong>Lower values</strong> = faster response, but more API calls (higher cost)</li>
                                        <li><strong>Higher values</strong> = fewer API calls (lower cost), but slower updates</li>
                                        <li>Changes take effect for new calls immediately (no restart needed)</li>
                                        <li>Cached for 1 minute to reduce database load</li>
                                    </ul>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Status Indicator Bar */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-md border-t border-border z-50">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${localSettings['twilio.forward_enabled'] && forwardStatus.status === 'valid' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
                        <span className="text-xs sm:text-sm font-medium text-foreground">
                            {localSettings['twilio.forward_enabled'] && forwardStatus.status === 'valid'
                                ? `Active: Forwarding to ${forwardStatus.nationalFormat || localSettings['twilio.forward_number']}`
                                : localSettings['twilio.forward_enabled']
                                    ? 'Forwarding enabled but number needs verification'
                                    : 'Forwarding disabled (AI transcription mode)'}
                        </span>
                    </div>
                    {isDirty && (
                        <div className="flex items-center gap-4">
                            <span className="hidden sm:inline text-sm text-orange-600 font-medium">Unsaved changes</span>
                            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : 'Save Changes'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
}
