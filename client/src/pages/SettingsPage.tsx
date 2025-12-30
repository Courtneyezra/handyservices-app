import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Settings, Phone, Volume2, MessageSquare, CheckCircle, XCircle, Loader2, AlertCircle, PhoneForwarded } from 'lucide-react';

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
    'twilio.fallback_message': "Hi! We missed your call to {business_name}. How can we help? Reply here or we'll call you back shortly.",
    'twilio.reassurance_enabled': true,
    'twilio.reassurance_interval': 15,
    'twilio.reassurance_message': 'Thanks for waiting, just connecting you now.',
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
    const [localSettings, setLocalSettings] = useState<TwilioSettings>(defaultSettings);
    const [forwardStatus, setForwardStatus] = useState<ForwardStatus>({ status: 'unconfigured', message: 'Enter a forward number', isValid: false });
    const [isDirty, setIsDirty] = useState(false);

    // Fetch settings
    const { data: settingsData, isLoading } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const res = await fetch('/api/settings');
            if (!res.ok) throw new Error('Failed to fetch settings');
            return res.json();
        },
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
        }
    }, [settingsData]);

    const updateSetting = <K extends keyof TwilioSettings>(key: K, value: TwilioSettings[K]) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
        setIsDirty(true);
    };

    const handleSave = () => {
        saveMutation.mutate(localSettings);
    };

    const getStatusIcon = () => {
        switch (forwardStatus.status) {
            case 'valid':
                return <CheckCircle className="w-5 h-5 text-green-500" />;
            case 'invalid':
                return <XCircle className="w-5 h-5 text-red-500" />;
            case 'checking':
                return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
            case 'unconfigured':
                return <AlertCircle className="w-5 h-5 text-gray-400" />;
            default:
                return <AlertCircle className="w-5 h-5 text-yellow-500" />;
        }
    };

    const getStatusColor = () => {
        switch (forwardStatus.status) {
            case 'valid':
                return 'border-green-500 bg-green-50 dark:bg-green-950';
            case 'invalid':
                return 'border-red-500 bg-red-50 dark:bg-red-950';
            case 'checking':
                return 'border-blue-500 bg-blue-50 dark:bg-blue-950';
            default:
                return 'border-gray-300';
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Settings className="w-8 h-8 text-blue-600" />
                    <div>
                        <h1 className="text-2xl font-bold">Call Routing Settings</h1>
                        <p className="text-gray-500">Configure how incoming calls are handled</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                        {seedMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Seed Defaults
                    </Button>
                    <Button onClick={handleSave} disabled={!isDirty || saveMutation.isPending}>
                        {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Save Changes
                    </Button>
                </div>
            </div>

            {/* Call Forwarding Section */}
            <Card className="border-2">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <PhoneForwarded className="w-5 h-5 text-blue-600" />
                        Call Forwarding
                    </CardTitle>
                    <CardDescription>Route calls to your VA or team member</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border">
                        <div>
                            <Label className="text-base font-medium">Enable Call Forwarding</Label>
                            <p className="text-sm text-gray-500">When enabled, calls will be forwarded to the number below</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`text-sm font-medium ${localSettings['twilio.forward_enabled'] ? 'text-green-600' : 'text-gray-400'}`}>
                                {localSettings['twilio.forward_enabled'] ? 'ON' : 'OFF'}
                            </span>
                            <Switch
                                checked={localSettings['twilio.forward_enabled']}
                                onCheckedChange={(val) => updateSetting('twilio.forward_enabled', val)}
                                className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-gray-300"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="forward-number">Forward Number (E.164 format)</Label>
                        <div className="flex gap-2">
                            <div className={`flex-1 relative flex items-center rounded-md border-2 ${getStatusColor()}`}>
                                <Phone className="w-4 h-4 ml-3 text-gray-400" />
                                <Input
                                    id="forward-number"
                                    placeholder="+447700900000"
                                    value={localSettings['twilio.forward_number']}
                                    onChange={(e) => updateSetting('twilio.forward_number', e.target.value)}
                                    className="border-0 focus-visible:ring-0"
                                />
                                <div className="pr-3">
                                    {getStatusIcon()}
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
                        <Label>Ring Timeout: {localSettings['twilio.max_wait_seconds']} seconds</Label>
                        <input
                            type="range"
                            min={10}
                            max={60}
                            step={5}
                            value={localSettings['twilio.max_wait_seconds']}
                            onChange={(e) => updateSetting('twilio.max_wait_seconds', parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                        />
                        <p className="text-sm text-gray-500">How long to ring the forward number before triggering fallback</p>
                    </div>
                </CardContent>
            </Card>

            {/* Caller Experience Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Volume2 className="w-5 h-5 text-green-600" />
                        Caller Experience
                    </CardTitle>
                    <CardDescription>Customize what callers hear</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="business-name">Business Name</Label>
                            <Input
                                id="business-name"
                                value={localSettings['twilio.business_name']}
                                onChange={(e) => updateSetting('twilio.business_name', e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="voice">Voice</Label>
                            <Select
                                value={localSettings['twilio.voice']}
                                onValueChange={(val) => updateSetting('twilio.voice', val)}
                            >
                                <SelectTrigger id="voice">
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
                        <Label htmlFor="welcome-message">Welcome Message</Label>
                        <Textarea
                            id="welcome-message"
                            value={localSettings['twilio.welcome_message']}
                            onChange={(e) => updateSetting('twilio.welcome_message', e.target.value)}
                            placeholder="Use {business_name} to insert the business name"
                            rows={2}
                        />
                        <p className="text-sm text-gray-500">Use {'{business_name}'} as a placeholder</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="hold-music">Hold Music URL</Label>
                        <Input
                            id="hold-music"
                            value={localSettings['twilio.hold_music_url']}
                            onChange={(e) => updateSetting('twilio.hold_music_url', e.target.value)}
                            placeholder="/assets/hold-music.mp3"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Fallback Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-purple-600" />
                        No-Answer Fallback
                    </CardTitle>
                    <CardDescription>What happens when no one answers</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Fallback Action</Label>
                        <Select
                            value={localSettings['twilio.fallback_action']}
                            onValueChange={(val) => updateSetting('twilio.fallback_action', val)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="whatsapp">Send WhatsApp Message</SelectItem>
                                <SelectItem value="voicemail">Take Voicemail</SelectItem>
                                <SelectItem value="none">Hang Up (No Fallback)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {localSettings['twilio.fallback_action'] === 'whatsapp' && (
                        <div className="space-y-2">
                            <Label htmlFor="fallback-message">WhatsApp Fallback Message</Label>
                            <Textarea
                                id="fallback-message"
                                value={localSettings['twilio.fallback_message']}
                                onChange={(e) => updateSetting('twilio.fallback_message', e.target.value)}
                                rows={3}
                            />
                            <p className="text-sm text-gray-500">Use {'{business_name}'} as a placeholder</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Status Indicator */}
            <Card className="bg-gray-50 dark:bg-gray-900">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${localSettings['twilio.forward_enabled'] && forwardStatus.status === 'valid' ? 'bg-green-500' : 'bg-gray-400'}`} />
                            <span className="text-sm font-medium">
                                {localSettings['twilio.forward_enabled'] && forwardStatus.status === 'valid'
                                    ? `Forwarding calls to ${forwardStatus.nationalFormat || localSettings['twilio.forward_number']}`
                                    : localSettings['twilio.forward_enabled']
                                        ? 'Forwarding enabled but number needs verification'
                                        : 'Call forwarding disabled (AI transcription mode)'}
                            </span>
                        </div>
                        {isDirty && (
                            <span className="text-sm text-orange-600 font-medium">Unsaved changes</span>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
