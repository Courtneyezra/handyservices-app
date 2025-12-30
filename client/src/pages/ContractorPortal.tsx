import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
    Calendar,
    Briefcase,
    DollarSign,
    Clock,
    TrendingUp,
    ChevronRight,
    User,
    LogOut,
    Bell,
    CheckCircle2,
    AlertCircle,
    Wrench,
    MapPin
} from 'lucide-react';

interface ContractorUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
}

interface JobStats {
    jobs: {
        pending: number;
        accepted: number;
        inProgress: number;
        completed: number;
        declined: number;
        total: number;
    };
    earnings: {
        totalPounds: string;
        monthPounds: string;
    };
}

interface AvailabilityDay {
    date: string;
    dayOfWeek: number;
    isAvailable: boolean;
    source: 'date' | 'weekly' | 'default';
}

export default function ContractorPortal() {
    const [, setLocation] = useLocation();
    const [user, setUser] = useState<ContractorUser | null>(null);

    // Check auth on mount
    useEffect(() => {
        const token = localStorage.getItem('contractorToken');
        const userStr = localStorage.getItem('contractorUser');

        if (!token || !userStr) {
            setLocation('/contractor/login');
            return;
        }

        try {
            setUser(JSON.parse(userStr));
        } catch {
            setLocation('/contractor/login');
        }
    }, [setLocation]);

    // Fetch job stats
    const { data: stats } = useQuery<JobStats>({
        queryKey: ['contractor-stats'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/jobs/stats/summary', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch stats');
            return res.json();
        },
        enabled: !!user,
    });

    // Fetch upcoming availability
    const { data: availability } = useQuery<{ availability: AvailabilityDay[] }>({
        queryKey: ['contractor-upcoming-availability'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/availability/upcoming', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch availability');
            return res.json();
        },
        enabled: !!user,
    });

    // Fetch pending jobs
    const { data: pendingJobs } = useQuery({
        queryKey: ['contractor-pending-jobs'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/jobs?status=pending', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch jobs');
            return res.json();
        },
        enabled: !!user,
    });

    const handleLogout = () => {
        const token = localStorage.getItem('contractorToken');
        if (token) {
            fetch('/api/contractor/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
        }
        localStorage.removeItem('contractorToken');
        localStorage.removeItem('contractorUser');
        localStorage.removeItem('contractorProfileId');
        setLocation('/contractor/login');
    };

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    if (!user) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Header */}
            <header className="bg-slate-800/50 backdrop-blur-xl border-b border-white/5 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <img src="/logo.png" alt="Logo" className="w-10 h-10 object-contain" />
                            <span className="text-white font-semibold text-lg hidden sm:block">Contractor Portal</span>
                        </div>

                        {/* Nav Items */}
                        <nav className="flex items-center gap-1">
                            <button
                                onClick={() => setLocation('/contractor/jobs')}
                                className="px-4 py-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                            >
                                Jobs
                            </button>
                            <button
                                onClick={() => setLocation('/contractor/calendar')}
                                className="px-4 py-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                            >
                                Calendar
                            </button>
                            <button
                                onClick={() => setLocation('/contractor/profile')}
                                className="px-4 py-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                            >
                                Profile
                            </button>
                        </nav>

                        {/* User Menu */}
                        <div className="flex items-center gap-4">
                            <button className="relative p-2 text-slate-400 hover:text-white transition-colors">
                                <Bell className="w-5 h-5" />
                                {(stats?.jobs.pending || 0) > 0 && (
                                    <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full" />
                                )}
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                            >
                                <LogOut className="w-4 h-4" />
                                <span className="hidden sm:inline">Logout</span>
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Welcome */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-white">
                        Welcome back, {user.firstName}!
                    </h1>
                    <p className="text-slate-400 mt-1">Here's what's happening with your jobs.</p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    {/* Pending Jobs */}
                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                                <AlertCircle className="w-5 h-5 text-amber-400" />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-white">{stats?.jobs.pending || 0}</p>
                        <p className="text-slate-400 text-sm">Pending Jobs</p>
                    </div>

                    {/* Active Jobs */}
                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                                <Briefcase className="w-5 h-5 text-blue-400" />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-white">
                            {(stats?.jobs.accepted || 0) + (stats?.jobs.inProgress || 0)}
                        </p>
                        <p className="text-slate-400 text-sm">Active Jobs</p>
                    </div>

                    {/* Completed */}
                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-white">{stats?.jobs.completed || 0}</p>
                        <p className="text-slate-400 text-sm">Completed</p>
                    </div>

                    {/* Earnings */}
                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-purple-400" />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-white">£{stats?.earnings.monthPounds || '0.00'}</p>
                        <p className="text-slate-400 text-sm">This Month</p>
                    </div>
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                    {/* Upcoming Availability */}
                    <div className="lg:col-span-2 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-amber-400" />
                                Next 14 Days
                            </h2>
                            <button
                                onClick={() => setLocation('/contractor/calendar')}
                                className="text-amber-400 hover:text-amber-300 text-sm flex items-center gap-1"
                            >
                                Manage
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Mini Calendar Grid */}
                        <div className="grid grid-cols-7 gap-2">
                            {availability?.availability.slice(0, 14).map((day, index) => (
                                <div
                                    key={day.date}
                                    className={`aspect-square rounded-xl flex flex-col items-center justify-center text-center p-2 transition-all ${day.isAvailable
                                        ? 'bg-emerald-500/20 border border-emerald-500/30'
                                        : 'bg-white/5 border border-white/10'
                                        }`}
                                >
                                    <span className="text-[10px] text-slate-500 uppercase">
                                        {dayNames[day.dayOfWeek]}
                                    </span>
                                    <span className={`text-lg font-semibold ${day.isAvailable ? 'text-emerald-400' : 'text-slate-500'}`}>
                                        {new Date(day.date).getDate()}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                                <span className="w-3 h-3 rounded bg-emerald-500/30" /> Available
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="w-3 h-3 rounded bg-white/10" /> Unavailable
                            </span>
                        </div>
                    </div>

                    {/* Pending Jobs */}
                    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Clock className="w-5 h-5 text-amber-400" />
                                Pending Jobs
                            </h2>
                            <button
                                onClick={() => setLocation('/contractor/jobs')}
                                className="text-amber-400 hover:text-amber-300 text-sm flex items-center gap-1"
                            >
                                View All
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>

                        {pendingJobs?.jobs?.length > 0 ? (
                            <div className="space-y-3">
                                {pendingJobs.jobs.slice(0, 3).map((job: any) => (
                                    <div
                                        key={job.id}
                                        className="p-4 bg-white/5 rounded-xl border border-white/5 hover:border-amber-500/30 transition-all cursor-pointer"
                                        onClick={() => setLocation(`/contractor/jobs/${job.id}`)}
                                    >
                                        <p className="text-white font-medium truncate">{job.jobDescription || 'New Job'}</p>
                                        <p className="text-slate-400 text-sm truncate">{job.address || job.postcode}</p>
                                        {job.payoutPence && (
                                            <p className="text-emerald-400 text-sm mt-1">£{(job.payoutPence / 100).toFixed(2)}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
                                    <Briefcase className="w-6 h-6 text-slate-500" />
                                </div>
                                <p className="text-slate-400 text-sm">No pending jobs</p>
                                <p className="text-slate-500 text-xs mt-1">New jobs will appear here</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <button
                        onClick={() => setLocation('/contractor/calendar')}
                        className="flex items-center gap-4 p-5 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-amber-500/30 transition-all group"
                    >
                        <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/30 transition-colors">
                            <Calendar className="w-6 h-6 text-amber-400" />
                        </div>
                        <div className="text-left">
                            <p className="text-white font-medium">Availability</p>
                            <p className="text-slate-400 text-sm">Working days</p>
                        </div>
                    </button>

                    <button
                        onClick={() => setLocation('/contractor/service-area')}
                        className="flex items-center gap-4 p-5 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-amber-500/30 transition-all group"
                    >
                        <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center group-hover:bg-red-500/30 transition-colors">
                            <MapPin className="w-6 h-6 text-red-400" />
                        </div>
                        <div className="text-left">
                            <p className="text-white font-medium">Service Area</p>
                            <p className="text-slate-400 text-sm">Coverage zone</p>
                        </div>
                    </button>

                    <button
                        onClick={() => setLocation('/contractor/profile')}
                        className="flex items-center gap-4 p-5 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-amber-500/30 transition-all group"
                    >
                        <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                            <User className="w-6 h-6 text-blue-400" />
                        </div>
                        <div className="text-left">
                            <p className="text-white font-medium">Edit Profile</p>
                            <p className="text-slate-400 text-sm">Your details</p>
                        </div>
                    </button>

                    <button
                        onClick={() => setLocation('/contractor/jobs')}
                        className="flex items-center gap-4 p-5 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-amber-500/30 transition-all group"
                    >
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
                            <TrendingUp className="w-6 h-6 text-emerald-400" />
                        </div>
                        <div className="text-left">
                            <p className="text-white font-medium">Earnings</p>
                            <p className="text-slate-400 text-sm">£{stats?.earnings.totalPounds || '0.00'}</p>
                        </div>
                    </button>
                </div>
            </main>
        </div>
    );
}
