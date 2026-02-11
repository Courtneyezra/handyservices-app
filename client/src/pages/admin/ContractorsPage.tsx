import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Users,
    Search,
    MapPin,
    Briefcase,
    Calendar,
    Clock,
    CheckCircle,
    XCircle,
    ChevronDown,
    ChevronUp,
    Wrench,
    Phone,
    Mail,
} from 'lucide-react';

interface Contractor {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    postcode: string;
    city: string;
    radiusMiles: number;
    bio: string;
    availabilityStatus: string;
    publicProfileEnabled: boolean;
    slug: string;
    createdAt: string;
    skills: Array<{
        serviceId: string;
        serviceName: string;
        hourlyRate: number;
    }>;
    totalJobs: number;
    weeklyPatterns: Array<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        isActive: boolean;
    }>;
    upcomingOverrides: Array<{
        date: string;
        isAvailable: boolean;
        startTime: string;
        endTime: string;
    }>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ContractorsPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedContractor, setSelectedContractor] = useState<Contractor | null>(null);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    const { data: contractors, isLoading } = useQuery<Contractor[]>({
        queryKey: ['admin-contractors'],
        queryFn: async () => {
            const token = localStorage.getItem('adminToken');
            const res = await fetch('/api/admin/contractors', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch contractors');
            return res.json();
        }
    });

    const filteredContractors = contractors?.filter(c => {
        const search = searchTerm.toLowerCase();
        return (
            c.firstName?.toLowerCase().includes(search) ||
            c.lastName?.toLowerCase().includes(search) ||
            c.email?.toLowerCase().includes(search) ||
            c.postcode?.toLowerCase().includes(search) ||
            c.city?.toLowerCase().includes(search)
        );
    });

    const toggleRow = (id: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedRows(newExpanded);
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'available':
                return <Badge className="bg-green-500">Available</Badge>;
            case 'busy':
                return <Badge className="bg-yellow-500">Busy</Badge>;
            case 'offline':
                return <Badge className="bg-gray-500">Offline</Badge>;
            default:
                return <Badge className="bg-blue-500">{status || 'Active'}</Badge>;
        }
    };

    if (isLoading) {
        return (
            <div className="p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-gray-200 rounded w-1/4"></div>
                    <div className="h-64 bg-gray-200 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="h-6 w-6" />
                        Contractors
                    </h1>
                    <p className="text-muted-foreground">
                        {contractors?.length || 0} contractors onboarded
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, email, postcode..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-blue-500" />
                            <div>
                                <p className="text-2xl font-bold">{contractors?.length || 0}</p>
                                <p className="text-sm text-muted-foreground">Total Contractors</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <CheckCircle className="h-5 w-5 text-green-500" />
                            <div>
                                <p className="text-2xl font-bold">
                                    {contractors?.filter(c => c.availabilityStatus === 'available' || !c.availabilityStatus).length || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">Available Now</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <Wrench className="h-5 w-5 text-purple-500" />
                            <div>
                                <p className="text-2xl font-bold">
                                    {contractors?.filter(c => c.skills?.length > 0).length || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">With Skills Set</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-2">
                            <Briefcase className="h-5 w-5 text-orange-500" />
                            <div>
                                <p className="text-2xl font-bold">
                                    {contractors?.reduce((sum, c) => sum + (c.totalJobs || 0), 0) || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">Total Jobs</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Contractors Table */}
            <Card>
                <CardHeader>
                    <CardTitle>All Contractors</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-8"></TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Contact</TableHead>
                                <TableHead>Location</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Skills</TableHead>
                                <TableHead>Jobs</TableHead>
                                <TableHead>Availability</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredContractors?.map((contractor) => (
                                <>
                                    <TableRow
                                        key={contractor.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => toggleRow(contractor.id)}
                                    >
                                        <TableCell>
                                            {expandedRows.has(contractor.id) ? (
                                                <ChevronUp className="h-4 w-4" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4" />
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {contractor.firstName} {contractor.lastName}
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                <div className="flex items-center gap-1">
                                                    <Mail className="h-3 w-3" />
                                                    {contractor.email}
                                                </div>
                                                {contractor.phone && (
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                        <Phone className="h-3 w-3" />
                                                        {contractor.phone}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                                {contractor.postcode || contractor.city || 'N/A'}
                                            </div>
                                            {contractor.radiusMiles && (
                                                <span className="text-xs text-muted-foreground">
                                                    {contractor.radiusMiles} mile radius
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {getStatusBadge(contractor.availabilityStatus)}
                                        </TableCell>
                                        <TableCell>
                                            {contractor.skills?.length || 0} skills
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{contractor.totalJobs} jobs</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-0.5">
                                                {DAY_NAMES.map((day, i) => {
                                                    const pattern = contractor.weeklyPatterns?.find(p => p.dayOfWeek === i);
                                                    const isActive = pattern?.isActive;
                                                    return (
                                                        <span
                                                            key={i}
                                                            className={`w-6 h-6 text-xs flex items-center justify-center rounded ${
                                                                isActive
                                                                    ? 'bg-green-100 text-green-700'
                                                                    : 'bg-gray-100 text-gray-400'
                                                            }`}
                                                            title={`${day}: ${isActive ? 'Available' : 'Unavailable'}`}
                                                        >
                                                            {day.charAt(0)}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    {expandedRows.has(contractor.id) && (
                                        <TableRow>
                                            <TableCell colSpan={8} className="bg-muted/30">
                                                <div className="p-4 space-y-4">
                                                    {/* Skills & Rates */}
                                                    <div>
                                                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                            <Wrench className="h-4 w-4" />
                                                            Skills & Rates
                                                        </h4>
                                                        {contractor.skills?.length > 0 ? (
                                                            <div className="flex flex-wrap gap-2">
                                                                {contractor.skills.map((skill, i) => (
                                                                    <Badge key={i} variant="secondary">
                                                                        {skill.serviceName}
                                                                        {skill.hourlyRate && (
                                                                            <span className="ml-1 text-green-600">
                                                                                £{skill.hourlyRate}/hr
                                                                            </span>
                                                                        )}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-sm text-muted-foreground">No skills set</p>
                                                        )}
                                                    </div>

                                                    {/* Weekly Pattern */}
                                                    <div>
                                                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                            <Calendar className="h-4 w-4" />
                                                            Weekly Pattern
                                                        </h4>
                                                        <div className="grid grid-cols-7 gap-2">
                                                            {DAY_NAMES.map((day, i) => {
                                                                const pattern = contractor.weeklyPatterns?.find(p => p.dayOfWeek === i);
                                                                return (
                                                                    <div
                                                                        key={i}
                                                                        className={`p-2 rounded text-center text-sm ${
                                                                            pattern?.isActive
                                                                                ? 'bg-green-100 border border-green-300'
                                                                                : 'bg-gray-100 border border-gray-200'
                                                                        }`}
                                                                    >
                                                                        <div className="font-medium">{day}</div>
                                                                        {pattern?.isActive ? (
                                                                            <div className="text-xs text-green-700">
                                                                                {pattern.startTime}-{pattern.endTime}
                                                                            </div>
                                                                        ) : (
                                                                            <div className="text-xs text-gray-400">Off</div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Upcoming Overrides */}
                                                    {contractor.upcomingOverrides?.length > 0 && (
                                                        <div>
                                                            <h4 className="font-semibold mb-2 flex items-center gap-2">
                                                                <Clock className="h-4 w-4" />
                                                                Upcoming Date Overrides
                                                            </h4>
                                                            <div className="flex flex-wrap gap-2">
                                                                {contractor.upcomingOverrides.slice(0, 10).map((override, i) => (
                                                                    <Badge
                                                                        key={i}
                                                                        variant={override.isAvailable ? 'default' : 'destructive'}
                                                                    >
                                                                        {new Date(override.date).toLocaleDateString('en-GB', {
                                                                            weekday: 'short',
                                                                            month: 'short',
                                                                            day: 'numeric'
                                                                        })}
                                                                        {override.isAvailable ? ' ✓' : ' ✕'}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Bio */}
                                                    {contractor.bio && (
                                                        <div>
                                                            <h4 className="font-semibold mb-1">Bio</h4>
                                                            <p className="text-sm text-muted-foreground">{contractor.bio}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </>
                            ))}
                        </TableBody>
                    </Table>

                    {filteredContractors?.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                            No contractors found
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
