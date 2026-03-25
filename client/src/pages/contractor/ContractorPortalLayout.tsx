import { ReactNode } from 'react';
import { useLocation, Link } from 'wouter';
import { Calendar, Briefcase, User } from 'lucide-react';

const tabs = [
  { path: '/contractor/dashboard', label: 'Calendar', icon: Calendar },
  { path: '/contractor/dashboard/jobs', label: 'My Jobs', icon: Briefcase },
  { path: '/contractor/dashboard/settings', label: 'Profile', icon: User },
];

interface ContractorPortalLayoutProps {
  children: ReactNode;
}

export default function ContractorPortalLayout({ children }: ContractorPortalLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Main content with bottom padding for tab bar */}
      <main className="pb-24">
        {children}
      </main>

      {/* Fixed bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 safe-area-pb">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {tabs.map((tab) => {
            const isActive = location === tab.path ||
              (tab.path === '/contractor/dashboard/jobs' && location.startsWith('/contractor/dashboard/jobs'));
            const Icon = tab.icon;

            return (
              <Link key={tab.path} href={tab.path}>
                <button className="flex flex-col items-center gap-1 px-4 py-2 transition-colors">
                  <Icon
                    size={22}
                    className={isActive ? 'text-amber-500' : 'text-slate-500'}
                  />
                  <span className={`text-[10px] font-semibold ${
                    isActive ? 'text-amber-500' : 'text-slate-500'
                  }`}>
                    {tab.label}
                  </span>
                </button>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
