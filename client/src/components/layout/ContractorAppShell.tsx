import { Link, useLocation } from "wouter";
import { LayoutGrid, Calendar, FileText, Briefcase, User } from "lucide-react";

interface ContractorAppShellProps {
    children: React.ReactNode;
    title?: string; // Optional header title if we want to enforce it later
}

export default function ContractorAppShell({ children }: ContractorAppShellProps) {
    const [location] = useLocation();

    // Helper to check active state
    const isActive = (path: string) => location === path || location.startsWith(path + '/');

    return (
        <div className="min-h-screen bg-[#F5F6F8] text-[#323338] font-sans pb-24 relative overflow-hidden">

            {/* Main Content Area */}
            <div className="animate-in fade-in duration-300">
                {children}
            </div>

            {/* Sticky Bottom Navigation */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 py-3 px-6 flex justify-between items-center z-40 pb-safe shadow-[0_-5px_20px_-5px_rgba(0,0,0,0.05)]">
                <Link href="/contractor/dashboard">
                    <button className={`flex flex-col items-center gap-1 transition-colors ${location === '/contractor/dashboard' ? 'text-[#6C6CFF]' : 'text-gray-400 hover:text-gray-600'}`}>
                        <LayoutGrid size={24} className={location === '/contractor/dashboard' ? 'fill-current' : ''} />
                        <span className="text-[10px] font-bold">Home</span>
                    </button>
                </Link>
                <Link href="/contractor/calendar">
                    <button className={`flex flex-col items-center gap-1 transition-colors ${isActive('/contractor/calendar') ? 'text-[#6C6CFF]' : 'text-gray-400 hover:text-gray-600'}`}>
                        <Calendar size={24} className={isActive('/contractor/calendar') ? 'fill-current' : ''} />
                        <span className="text-[10px] font-bold">Schedule</span>
                    </button>
                </Link>
                <Link href="/contractor/dashboard/quotes">
                    <button className={`flex flex-col items-center gap-1 transition-colors ${isActive('/contractor/dashboard/quotes') ? 'text-[#6C6CFF]' : 'text-gray-400 hover:text-gray-600'}`}>
                        <FileText size={24} className={isActive('/contractor/dashboard/quotes') ? 'fill-current' : ''} />
                        <span className="text-[10px] font-bold">Quotes</span>
                    </button>
                </Link>
                <Link href="/contractor/dashboard/jobs">
                    <button className={`flex flex-col items-center gap-1 transition-colors ${isActive('/contractor/dashboard/jobs') ? 'text-[#6C6CFF]' : 'text-gray-400 hover:text-gray-600'}`}>
                        <Briefcase size={24} className={isActive('/contractor/dashboard/jobs') ? 'fill-current' : ''} />
                        <span className="text-[10px] font-bold">Jobs</span>
                    </button>
                </Link>
                <Link href="/contractor/dashboard/settings">
                    <button className={`flex flex-col items-center gap-1 transition-colors ${isActive('/contractor/dashboard/settings') ? 'text-[#6C6CFF]' : 'text-gray-400 hover:text-gray-600'}`}>
                        <User size={24} className={isActive('/contractor/dashboard/settings') ? 'fill-current' : ''} />
                        <span className="text-[10px] font-bold">Profile</span>
                    </button>
                </Link>
            </div>
        </div>
    );
}
