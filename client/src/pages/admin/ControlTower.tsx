// client/src/pages/admin/ControlTower.tsx
//
// Module 08 — Control Tower (manual mode, Phase 3).
// Top-level page with the demand-health header card and four tabs:
//   1. Inbound       — booked-but-not-routed queue
//   2. Day-Pack      — manual day-pack assembler
//   3. Builder Week  — calendar grid of Builder commits
//   4. Exceptions    — alerts feed
//
// Tab is encoded in the URL path: /admin/control-tower/:tab? — bookmarkable.
// Gated by FF_CONTROL_TOWER (App.tsx route + server endpoints).
//
// Refs:
// - docs/architecture/modules/08-control-tower.md
// - docs/architecture/feature-flags.md (FF_CONTROL_TOWER)

import { useEffect } from 'react';
import { useLocation, useRoute } from 'wouter';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import DemandHealthCard from '@/components/admin/DemandHealthCard';
import InboundQueue from './control-tower/InboundQueue';
import DayPackAssembler from './control-tower/DayPackAssembler';
import BuilderWeekView from './control-tower/BuilderWeekView';
import ExceptionsQueue from './control-tower/ExceptionsQueue';

const TABS = [
    { id: 'inbound', label: 'Inbound' },
    { id: 'day-pack', label: 'Day-Pack' },
    { id: 'builder-week', label: 'Builder Week' },
    { id: 'exceptions', label: 'Exceptions' },
] as const;

type TabId = typeof TABS[number]['id'];

const DEFAULT_TAB: TabId = 'inbound';

function isValidTab(value: string | undefined): value is TabId {
    return TABS.some((t) => t.id === value);
}

export default function ControlTower() {
    const [, params] = useRoute('/admin/control-tower/:tab?');
    const [, setLocation] = useLocation();
    const tabParam = params?.tab;
    const activeTab: TabId = isValidTab(tabParam) ? tabParam : DEFAULT_TAB;

    // Normalise URL: bare /admin/control-tower → /admin/control-tower/inbound
    useEffect(() => {
        if (!tabParam) {
            setLocation('/admin/control-tower/inbound', { replace: true });
        } else if (!isValidTab(tabParam)) {
            setLocation('/admin/control-tower/inbound', { replace: true });
        }
    }, [tabParam, setLocation]);

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
                <header className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                        Control Tower
                    </h1>
                    <p className="text-sm text-slate-600">
                        Dispatcher console — inbound queue, day-pack assembly, Builder week, exceptions.
                    </p>
                </header>

                <DemandHealthCard />

                <Tabs
                    value={activeTab}
                    onValueChange={(v) => setLocation(`/admin/control-tower/${v}`)}
                    className="w-full"
                >
                    <TabsList className="bg-white border border-slate-200 h-auto p-1">
                        {TABS.map((t) => (
                            <TabsTrigger
                                key={t.id}
                                value={t.id}
                                className="data-[state=active]:bg-slate-900 data-[state=active]:text-white px-4 py-2"
                                data-testid={`tab-${t.id}`}
                            >
                                {t.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <TabsContent value="inbound" className="mt-4">
                        <InboundQueue />
                    </TabsContent>
                    <TabsContent value="day-pack" className="mt-4">
                        <DayPackAssembler />
                    </TabsContent>
                    <TabsContent value="builder-week" className="mt-4">
                        <BuilderWeekView />
                    </TabsContent>
                    <TabsContent value="exceptions" className="mt-4">
                        <ExceptionsQueue />
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
