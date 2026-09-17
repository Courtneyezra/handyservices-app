/**
 * The admin destinations the sidebar lists, and the sign-out it uses. Shared by SidebarLayout and
 * the Handy Desk's "More" menu (components/layout/AdminNavMenu.tsx), which renders outside the shell.
 * The badge counts come from the caller; the desk's menu shows no badges.
 */
import { LayoutDashboard, PhoneCall, Settings, Bell, Package, Wrench, Mic, DollarSign, Megaphone, LayoutTemplate, Users, Inbox, User, FileText, Calendar, Kanban, GitBranch, Map, Home, BarChart3, ClipboardCheck, ClipboardList, Building2, AlertCircle, GraduationCap, BookOpen, Sparkles, SlidersHorizontal, PoundSterling, Library, Send, HardHat, Bot, Activity, ListTodo, FlaskConical, type LucideIcon } from "lucide-react";
import { NEW_BOARD_PATH, CONTRACTOR_LANE_PATH } from "@/hooks/useOldComms";
import { HANDY_DESK_PATH } from "@/lib/handy-desk-path";

export interface AdminNavItem {
    icon: LucideIcon;
    label: string;
    href: string;
    badge?: string | null;
    alarm?: boolean;
}

export interface AdminNavGroup {
    title: string;
    collapsible?: boolean;
    items: AdminNavItem[];
}

export interface AdminNavState {
    isVA: boolean;
    commsRetired: boolean;
    isLive: boolean;
    followUpCount: number;
    reviewCount: number;
    priceQueueCount: number;
    kbWaiting: number;
    visionFailing: string | null;
}

export function adminNavGroups({ isVA, commsRetired, isLive, followUpCount, reviewCount, priceQueueCount, kbWaiting, visionFailing }: AdminNavState): AdminNavGroup[] {
    if (isVA) return [
        // ─── VA Menu: three primary surfaces, everything else grouped ───
        {
            title: "YOUR TOOLS",
            items: [
                { icon: ListTodo, label: "Desk", href: "/admin/desk", badge: "NEW" },
                commsRetired
                    ? { icon: Kanban, label: "Comms Desk v2", href: NEW_BOARD_PATH, badge: null }
                    : { icon: Inbox, label: "Comms", href: "/admin/comms", badge: null },
                { icon: ClipboardList, label: "Pipeline", href: "/admin/work", badge: null },
            ]
        },
        {
            // Everything the VA had before — nothing deleted, just grouped
            // behind a collapsed disclosure (Comms/Pipeline moved to primary).
            title: "MORE TOOLS",
            collapsible: true,
            items: [
                { icon: LayoutDashboard, label: "Operating System", href: "/admin/os", badge: "NEW" },
                { icon: ClipboardCheck, label: "Tasks", href: "/admin/va-tasks", badge: "NEW" },
                { icon: PhoneCall, label: "Follow-Ups", href: "/admin/follow-ups", badge: followUpCount > 0 ? String(followUpCount) : null },
                { icon: Mic, label: "Live Switchboard", href: "/admin/live-call", badge: isLive ? "LIVE" : null },
                { icon: Send, label: "Visit Link", href: "/admin/generate-contextual-quote?visit=1", badge: "NEW" },
                { icon: Sparkles, label: "New Quote", href: "/admin/generate-contextual-quote" },
                { icon: DollarSign, label: "Quote Generator (Classic)", href: "/admin/generate-quote" },
                { icon: FileText, label: "Recent Quotes", href: "/admin/quotes" },
                { icon: Calendar, label: "Availability", href: "/admin/availability-mobile" },
                { icon: BarChart3, label: "My Stats", href: "/admin/va-stats" },
                { icon: PhoneCall, label: "Calls", href: "/admin/calls" },
            ]
        },
        {
            title: "HELP",
            items: [
                { icon: BookOpen, label: "Resources", href: "/admin/resources" },
                { icon: GraduationCap, label: "Onboarding", href: "/admin/onboarding" },
                { icon: ClipboardCheck, label: "Training", href: "/admin/training-center" },
            ]
        }
    ];
    return [
        {
            title: "DISPATCH CONSOLE",
            items: [
                { icon: ListTodo, label: "Desk", href: "/admin/desk", badge: "NEW" },
                { icon: LayoutDashboard, label: "Operating System", href: "/admin/os", badge: "NEW" },
                { icon: Home, label: "Pipeline Home", href: "/admin/pipeline-home" },
                { icon: PhoneCall, label: "Follow-Ups", href: "/admin/follow-ups", badge: followUpCount > 0 ? String(followUpCount) : null },
                commsRetired
                    ? { icon: HardHat, label: "Contractor threads", href: CONTRACTOR_LANE_PATH, badge: null }
                    : { icon: Inbox, label: "Comms", href: "/admin/comms", badge: "NEW" },
                { icon: PoundSterling, label: "Price queue", href: "/admin/price", badge: priceQueueCount > 0 ? String(priceQueueCount) : null },
                { icon: FlaskConical, label: "Sandbox", href: "/admin/sandbox", badge: "NEW" },
                { icon: Kanban, label: "Comms Desk v2", href: "/admin/comms-v2", badge: "NEW" },
                { icon: Sparkles, label: "Handy Desk", href: HANDY_DESK_PATH, badge: "NEW" },
                { icon: Bot, label: "AI Staff", href: "/admin/staff", badge: visionFailing ?? "NEW", alarm: !!visionFailing },
                { icon: BookOpen, label: "What we tell customers", href: "/admin/knowledge", badge: kbWaiting > 0 ? String(kbWaiting) : "NEW" },
                { icon: Activity, label: "Activity", href: "/admin/activity", badge: "NEW" },
                { icon: LayoutTemplate, label: "Dispatch Board", href: "/admin/dispatch" },
                { icon: Map, label: "Dispatch Console", href: "/admin/dispatch-console" },
                { icon: Calendar, label: "Daily Planner", href: "/admin/daily-planner" },
                { icon: BarChart3, label: "Reports Dashboard", href: "/admin/dashboard" },
                { icon: PhoneCall, label: "Calls", href: "/admin/calls" },
                { icon: Mic, label: "Live Switchboard", href: "/admin/live-call", badge: isLive ? "LIVE" : null },
            ]
        },
        {
            title: "OPERATIONS",
            items: [
                { icon: Building2, label: "Clients", href: "/admin/clients", badge: "NEW" },
                { icon: Map, label: "Lead Tube Map", href: "/admin/tube-map", badge: "NEW" },
                { icon: GitBranch, label: "Pipeline Map", href: "/admin/pipeline" },
                { icon: Kanban, label: "Lead Kanban", href: "/admin/funnel" },
                { icon: ClipboardCheck, label: "Segment Review", href: "/admin/leads/review", badge: reviewCount > 0 ? String(reviewCount) : null },
                { icon: Users, label: "Contractors", href: "/admin/contractors" },
                { icon: Users, label: "Contractor Teams", href: "/admin/contractor-teams", badge: "NEW" },
                { icon: Calendar, label: "Availability Board", href: "/admin/contractor-availability" },
                { icon: Wrench, label: "Handyman Map", href: "/admin/handymen" },
                { icon: LayoutDashboard, label: "Fleet Dashboard", href: "/admin/handyman/dashboard" },
                { icon: User, label: "Leads (Classic)", href: "/admin/leads" },
            ]
        },
        {
            title: "SALES & FINANCE",
            items: [
                { icon: Send, label: "Visit Link", href: "/admin/generate-contextual-quote?visit=1", badge: "NEW" },
                { icon: Sparkles, label: "New Quote", href: "/admin/generate-contextual-quote" },
                { icon: BarChart3, label: "Quote Analytics", href: "/admin/quote-analytics" },
                { icon: LayoutTemplate, label: "Quote Platform", href: "/admin/quote-platform" },
                { icon: DollarSign, label: "Quote Generator (Classic)", href: "/admin/generate-quote" },
                { icon: FileText, label: "Recent Quotes", href: "/admin/quotes" },
                { icon: Wrench, label: "Booking Visits", href: "/admin/visits" },
                { icon: FileText, label: "Invoices", href: "/admin/invoices" },
                { icon: Package, label: "SKU Manager", href: "/admin/skus" },
                { icon: Library, label: "SKU Library", href: "/admin/sku-library" },
                { icon: Sparkles, label: "Extras Library", href: "/admin/extras" },
                { icon: PoundSterling, label: "WTBP Rates", href: "/admin/wtbp-rates" },
                { icon: PoundSterling, label: "Pricing Loop", href: "/admin/pricing-loop" },
                { icon: Wrench, label: "How We Work", href: "/admin/how-we-work" },
            ]
        },
        {
            title: "PROPERTY MGMT",
            items: [
                { icon: AlertCircle, label: "Tenant Issues", href: "/admin/tenant-issues", badge: "NEW" },
                { icon: Building2, label: "Properties", href: "/admin/properties" },
            ]
        },
        {
            title: "SYSTEM",
            items: [
                { icon: Calendar, label: "Availability", href: "/admin/availability" },
                { icon: LayoutTemplate, label: "Marketing", href: "/admin/marketing" },
                { icon: Settings, label: "Settings", href: "/admin/settings" },
                { icon: Bell, label: "Notifications", href: "/admin/notifications" },
                { icon: SlidersHorizontal, label: "Pricing Settings", href: "/admin/pricing-settings" },
                { icon: Megaphone, label: "Quote Offers", href: "/admin/quote-offers" },
                { icon: GraduationCap, label: "Onboarding", href: "/admin/onboarding" },
                { icon: BookOpen, label: "VA Resources", href: "/admin/resources" },
            ]
        }
    ];
}

/** Signs the admin session out and goes to the login page. */
export function logOut(navigate: (to: string) => void) {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    navigate('/admin/login');
}
