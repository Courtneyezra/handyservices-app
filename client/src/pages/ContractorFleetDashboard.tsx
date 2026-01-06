import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    LayoutGrid,
    List as ListIcon,
    Map as MapIcon,
    Search,
    Filter,
    MoreHorizontal,
    Phone,
    Mail,
    MapPin,
    Wrench,
    ShieldCheck,
    AlertCircle,
    Users,
    Activity,
    Clock,
    CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import HandymanMap from "./HandymanMap";

// Reuse types from HandymanMap/Schema
interface Handyman {
    id: string;
    bio: string;
    address: string;
    city: string;
    postcode: string;
    latitude: string;
    longitude: string;
    radiusMiles: number;
    user: {
        firstName: string;
        lastName: string;
        email: string;
        phone?: string;
    };
    skills: {
        id: string;
        service: {
            id: string;
            name: string;
            category: string;
        };
    }[];
    availability?: any[]; // Simplified for list view
}

export default function ContractorFleetDashboard() {
    const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'onboarding' | 'offline'>('all');

    const { data: handymen = [], isLoading } = useQuery<Handyman[]>({
        queryKey: ["/api/handymen"],
    });

    // Computed Metrics
    const metrics = useMemo(() => {
        const total = handymen.length;
        const active = handymen.filter(h => h.skills.length > 0).length; // Rough proxy for "active"
        const onboarding = total - active;
        const coverageIssues = 0; // Placeholder until we have coverage logic

        return { total, active, onboarding, coverageIssues };
    }, [handymen]);

    // Filtered Data
    const filteredHandymen = useMemo(() => {
        return handymen.filter(h => {
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch =
                `${h.user.firstName} ${h.user.lastName}`.toLowerCase().includes(searchLower) ||
                h.city?.toLowerCase().includes(searchLower) ||
                h.skills.some(s => s.service.name.toLowerCase().includes(searchLower));

            const isActive = h.skills.length > 0;
            const matchesStatus =
                statusFilter === 'all' ? true :
                    statusFilter === 'active' ? isActive :
                        statusFilter === 'onboarding' ? !isActive : true;

            return matchesSearch && matchesStatus;
        });
    }, [handymen, searchQuery, statusFilter]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[500px]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-400">Loading fleet data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 bg-slate-950 min-h-screen text-slate-100">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Fleet Command</h1>
                    <p className="text-slate-400">Manage your contractor workforce and coverage.</p>
                </div>
                <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode('list')}
                        className={cn(viewMode === 'list' ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-white")}
                    >
                        <ListIcon className="w-4 h-4 mr-2" /> List View
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode('map')}
                        className={cn(viewMode === 'map' ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-white")}
                    >
                        <MapIcon className="w-4 h-4 mr-2" /> Map View
                    </Button>
                </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    title="Total Contractors"
                    value={metrics.total}
                    icon={Users}
                    trend="+12% this month"
                    color="text-blue-400"
                    bg="bg-blue-500/10"
                />
                <MetricCard
                    title="Active Today"
                    value={metrics.active}
                    icon={Activity}
                    trend="56 currently available"
                    color="text-emerald-400"
                    bg="bg-emerald-500/10"
                />
                <MetricCard
                    title="Pending Approval"
                    value={metrics.onboarding}
                    icon={Clock}
                    trend="Requires review"
                    color="text-amber-400"
                    bg="bg-amber-500/10"
                />
                <MetricCard
                    title="Coverage Alerts"
                    value={metrics.coverageIssues}
                    icon={AlertCircle}
                    trend="Critical gaps detected"
                    color="text-red-400"
                    bg="bg-red-500/10"
                />
            </div>

            {/* Content Area */}
            {viewMode === 'map' ? (
                <div className="h-[600px] rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
                    <HandymanMap />
                </div>
            ) : (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
                    {/* Toolbar */}
                    <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row gap-4 justify-between items-center">
                        <div className="relative w-full sm:w-96">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="Search by name, city, or trade..."
                                className="pl-10 bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-500 focus-visible:ring-blue-500/50"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
                            <FilterButton label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
                            <FilterButton label="Active" active={statusFilter === 'active'} onClick={() => setStatusFilter('active')} />
                            <FilterButton label="Onboarding" active={statusFilter === 'onboarding'} onClick={() => setStatusFilter('onboarding')} />
                        </div>
                    </div>

                    {/* Table */}
                    <Table>
                        <TableHeader className="bg-slate-900">
                            <TableRow className="border-slate-800 hover:bg-slate-800/50">
                                <TableHead className="text-slate-400">Contractor</TableHead>
                                <TableHead className="text-slate-400">Primary Trade</TableHead>
                                <TableHead className="text-slate-400">Location</TableHead>
                                <TableHead className="text-slate-400">Status</TableHead>
                                <TableHead className="text-slate-400">Radius</TableHead>
                                <TableHead className="text-right text-slate-400">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredHandymen.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                                        No contractors found matching your filters.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredHandymen.map((handyman) => (
                                    <TableRow key={handyman.id} className="border-slate-800 hover:bg-slate-800/50">
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold border border-slate-700">
                                                    {handyman.user.firstName[0]}{handyman.user.lastName[0]}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-slate-200">{handyman.user.firstName} {handyman.user.lastName}</div>
                                                    <div className="text-xs text-slate-500">{handyman.user.email}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {handyman.skills.slice(0, 2).map(skill => (
                                                    <Badge key={skill.id} variant="secondary" className="bg-slate-800 text-slate-300 hover:bg-slate-700 border-none">
                                                        {skill.service.name}
                                                    </Badge>
                                                ))}
                                                {handyman.skills.length === 0 && (
                                                    <span className="text-xs text-slate-500 italic">No skills listed</span>
                                                )}
                                                {handyman.skills.length > 2 && (
                                                    <Badge variant="secondary" className="bg-slate-800 text-slate-400 border-none">+{handyman.skills.length - 2}</Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2 text-slate-300">
                                                <MapPin className="w-4 h-4 text-slate-500" />
                                                {handyman.city || "Unknown"}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {handyman.skills.length > 0 ? (
                                                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Active
                                                </Badge>
                                            ) : (
                                                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
                                                    <Clock className="w-3 h-3 mr-1" /> Onboarding
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-slate-400 text-sm">{handyman.radiusMiles} miles</span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View Profile">
                                                    <Wrench className="w-4 h-4 text-slate-400" />
                                                </Button>
                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Locate">
                                                    <MapIcon className="w-4 h-4 text-slate-400" />
                                                </Button>
                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Call">
                                                    <Phone className="w-4 h-4 text-slate-400" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

// Sub-components
function MetricCard({ title, value, icon: Icon, trend, color, bg }: any) {
    return (
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 shadow-sm relative overflow-hidden group">
            <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity`}>
                <Icon className={`w-24 h-24 ${color}`} />
            </div>
            <div className="relative z-10">
                <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 rounded-lg ${bg}`}>
                        <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <span className="text-sm font-medium text-slate-400">{title}</span>
                </div>
                <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-white">{value}</span>
                </div>
                <p className={`text-xs mt-2 ${color} font-medium`}>{trend}</p>
            </div>
        </div>
    );
}

function FilterButton({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                active
                    ? "bg-slate-800 text-white shadow-sm ring-1 ring-slate-700"
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            )}
        >
            {label}
        </button>
    );
}
