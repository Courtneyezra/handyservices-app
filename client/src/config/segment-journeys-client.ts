/**
 * Segment Journey Client Configuration
 *
 * Frontend-friendly journey configurations for the VA call script tube map.
 * Each segment has a unique "line" with stations representing the call flow.
 */

import type { CallScriptSegment, CallScriptDestination } from '@shared/schema';
import {
  Home,
  Clock,
  Building2,
  User,
  Briefcase,
  Zap,
  Wallet,
  Phone,
  FileText,
  Video,
  MapPin,
  XCircle,
  MessageSquare,
  CheckCircle,
  HelpCircle,
  Calendar,
  AlertTriangle,
  Shield,
  DollarSign,
  UserCheck,
  Key,
  Camera,
  type LucideIcon
} from 'lucide-react';

// Tube line colors - authentic London Underground palette
export const SEGMENT_LINE_COLORS: Record<CallScriptSegment, string> = {
  EMERGENCY: '#E32017',   // Central Line (Red)
  LANDLORD: '#FF6600',    // Overground (Orange)
  BUSY_PRO: '#FFD300',    // Circle Line (Yellow)
  PROP_MGR: '#00843D',    // District Line (Green)
  OAP: '#0019A8',         // Piccadilly Line (Blue)
  SMALL_BIZ: '#9B0058',   // Metropolitan Line (Purple)
  BUDGET: '#A0A5A9',      // Grey
};

// Segment display names
export const SEGMENT_NAMES: Record<CallScriptSegment, string> = {
  EMERGENCY: 'Emergency',
  LANDLORD: 'Landlord',
  BUSY_PRO: 'Busy Pro',
  PROP_MGR: 'Property Mgr',
  OAP: 'Senior',
  SMALL_BIZ: 'Small Biz',
  BUDGET: 'Budget',
};

// Segment icons (for station roundels)
export const SEGMENT_ICONS: Record<CallScriptSegment, LucideIcon> = {
  EMERGENCY: Zap,
  LANDLORD: Home,
  BUSY_PRO: Clock,
  PROP_MGR: Building2,
  OAP: User,
  SMALL_BIZ: Briefcase,
  BUDGET: Wallet,
};

// Destination icons
export const DESTINATION_ICONS: Record<CallScriptDestination, LucideIcon> = {
  INSTANT_QUOTE: FileText,
  VIDEO_REQUEST: Video,
  SITE_VISIT: MapPin,
  EMERGENCY_DISPATCH: Zap,
  EXIT: XCircle,
};

// Station option interface
export interface StationOption {
  id: string;
  label: string;
  icon: LucideIcon;
  nextStation?: string;
  isDefault?: boolean;
  color?: string;
}

// Station interface
export interface JourneyStation {
  id: string;
  label: string;
  vaPrompt: string;
  options?: StationOption[];
  icon: LucideIcon;
  isTerminal?: boolean;
}

// Journey configuration interface
export interface SegmentJourney {
  segment: CallScriptSegment;
  lineName: string;
  color: string;
  icon: LucideIcon;
  stations: JourneyStation[];
  defaultDestination: CallScriptDestination;
}

// Common opening station (all segments start here)
const OPENING_STATION: JourneyStation = {
  id: 'opening',
  label: 'Opening',
  vaPrompt: "Hi, how can I help you today?",
  icon: Phone,
  options: [
    { id: 'listen', label: 'Listen', icon: MessageSquare, nextStation: 'identify', isDefault: true },
  ],
};

// Common identify station
const IDENTIFY_STATION: JourneyStation = {
  id: 'identify',
  label: 'Identify',
  vaPrompt: "Can I get your name and the best number to reach you?",
  icon: UserCheck,
  options: [
    { id: 'captured', label: 'Info Captured', icon: CheckCircle, nextStation: 'segment' },
    { id: 'refused', label: 'Refused', icon: XCircle, nextStation: 'segment' },
  ],
};

// Segment journeys configuration
export const SEGMENT_JOURNEYS: Record<CallScriptSegment, SegmentJourney> = {
  EMERGENCY: {
    segment: 'EMERGENCY',
    lineName: 'Central',
    color: SEGMENT_LINE_COLORS.EMERGENCY,
    icon: Zap,
    defaultDestination: 'EMERGENCY_DISPATCH',
    stations: [
      OPENING_STATION,
      IDENTIFY_STATION,
      {
        id: 'segment',
        label: 'Emergency',
        vaPrompt: "Is this an emergency? Water/gas leak, power out, security issue?",
        icon: AlertTriangle,
        options: [
          { id: 'yes_emergency', label: 'Yes - Emergency', icon: Zap, nextStation: 'safety', color: '#E32017' },
          { id: 'no_urgent', label: 'No - But Urgent', icon: Clock, nextStation: 'job' },
        ],
      },
      {
        id: 'safety',
        label: 'Safety',
        vaPrompt: "Are you safe? Have you isolated the water/gas/power?",
        icon: Shield,
        options: [
          { id: 'safe', label: 'Safe', icon: CheckCircle, nextStation: 'dispatch' },
          { id: 'need_help', label: 'Need Guidance', icon: HelpCircle, nextStation: 'dispatch' },
        ],
      },
      {
        id: 'job',
        label: 'Job Details',
        vaPrompt: "What needs fixing?",
        icon: FileText,
        options: [
          { id: 'captured', label: 'Got Details', icon: CheckCircle, nextStation: 'dispatch' },
        ],
      },
      {
        id: 'dispatch',
        label: 'Dispatch',
        vaPrompt: "I'm checking who's available to come out now.",
        icon: Zap,
        isTerminal: true,
      },
    ],
  },

  LANDLORD: {
    segment: 'LANDLORD',
    lineName: 'Overground',
    color: SEGMENT_LINE_COLORS.LANDLORD,
    icon: Home,
    defaultDestination: 'VIDEO_REQUEST',
    stations: [
      OPENING_STATION,
      IDENTIFY_STATION,
      {
        id: 'segment',
        label: 'Property',
        vaPrompt: "Is this a rental property you own?",
        icon: Home,
        options: [
          { id: 'yes_landlord', label: 'Yes - Landlord', icon: Home, nextStation: 'tenant', color: '#FF6600' },
          { id: 'no_homeowner', label: 'No - Homeowner', icon: User, nextStation: 'job' },
        ],
      },
      {
        id: 'tenant',
        label: 'Tenant',
        vaPrompt: "Is there a tenant? Will they give us access?",
        icon: Key,
        options: [
          { id: 'tenant_access', label: 'Tenant Access', icon: Key, nextStation: 'job' },
          { id: 'vacant', label: 'Vacant/Empty', icon: Building2, nextStation: 'job' },
          { id: 'need_coordinate', label: 'Need to Coordinate', icon: Phone, nextStation: 'job' },
        ],
      },
      {
        id: 'job',
        label: 'Job Details',
        vaPrompt: "What needs doing? Don't worry about being there - we'll send photos.",
        icon: Camera,
        options: [
          { id: 'simple', label: 'Simple Job', icon: CheckCircle, nextStation: 'quote' },
          { id: 'complex', label: 'Need to See It', icon: Video, nextStation: 'video' },
        ],
      },
      {
        id: 'video',
        label: 'Video Request',
        vaPrompt: "Can you or your tenant send a quick video? We'll price it within the hour.",
        icon: Video,
        isTerminal: true,
      },
      {
        id: 'quote',
        label: 'Quote',
        vaPrompt: "I can give you a price now. Photo report included.",
        icon: FileText,
        isTerminal: true,
      },
    ],
  },

  BUSY_PRO: {
    segment: 'BUSY_PRO',
    lineName: 'Circle',
    color: SEGMENT_LINE_COLORS.BUSY_PRO,
    icon: Clock,
    defaultDestination: 'INSTANT_QUOTE',
    stations: [
      OPENING_STATION,
      IDENTIFY_STATION,
      {
        id: 'segment',
        label: 'Schedule',
        vaPrompt: "When works best for you? We can do exact time slots.",
        icon: Calendar,
        options: [
          { id: 'this_week', label: 'This Week', icon: Calendar, nextStation: 'job', color: '#FFD300' },
          { id: 'specific_time', label: 'Specific Time', icon: Clock, nextStation: 'job' },
          { id: 'asap', label: 'ASAP', icon: Zap, nextStation: 'job' },
        ],
      },
      {
        id: 'job',
        label: 'Job Details',
        vaPrompt: "What needs fixing? Keep it brief - I know you're busy.",
        icon: FileText,
        options: [
          { id: 'simple', label: 'Simple', icon: CheckCircle, nextStation: 'quote' },
          { id: 'send_video', label: 'Send Video', icon: Video, nextStation: 'video' },
        ],
      },
      {
        id: 'video',
        label: 'Video',
        vaPrompt: "Quick video when you get a chance. We'll text you a price.",
        icon: Video,
        isTerminal: true,
      },
      {
        id: 'quote',
        label: 'Book Now',
        vaPrompt: "I can book you in right now. SMS updates only - no calls unless urgent.",
        icon: FileText,
        isTerminal: true,
      },
    ],
  },

  PROP_MGR: {
    segment: 'PROP_MGR',
    lineName: 'District',
    color: SEGMENT_LINE_COLORS.PROP_MGR,
    icon: Building2,
    defaultDestination: 'INSTANT_QUOTE',
    stations: [
      OPENING_STATION,
      IDENTIFY_STATION,
      {
        id: 'segment',
        label: 'Portfolio',
        vaPrompt: "How many properties are you managing? We do bulk rates.",
        icon: Building2,
        options: [
          { id: 'multiple', label: 'Multiple', icon: Building2, nextStation: 'job', color: '#00843D' },
          { id: 'single', label: 'Just One', icon: Home, nextStation: 'job' },
        ],
      },
      {
        id: 'job',
        label: 'Job Details',
        vaPrompt: "What's the issue? Which property?",
        icon: FileText,
        options: [
          { id: 'standard', label: 'Standard Work', icon: CheckCircle, nextStation: 'quote' },
          { id: 'assessment', label: 'Need Assessment', icon: MapPin, nextStation: 'visit' },
        ],
      },
      {
        id: 'visit',
        label: 'Site Visit',
        vaPrompt: "We'll pop round for a free assessment. When's good for access?",
        icon: MapPin,
        isTerminal: true,
      },
      {
        id: 'quote',
        label: 'Quote',
        vaPrompt: "I can price this now. Want to hear about our Partner Program for agencies?",
        icon: FileText,
        isTerminal: true,
      },
    ],
  },

  OAP: {
    segment: 'OAP',
    lineName: 'Piccadilly',
    color: SEGMENT_LINE_COLORS.OAP,
    icon: User,
    defaultDestination: 'SITE_VISIT',
    stations: [
      OPENING_STATION,
      IDENTIFY_STATION,
      {
        id: 'segment',
        label: 'Comfort',
        vaPrompt: "Take your time. Tell me what's troubling you.",
        icon: User,
        options: [
          { id: 'continue', label: 'Continue', icon: CheckCircle, nextStation: 'trust', color: '#0019A8' },
        ],
      },
      {
        id: 'trust',
        label: 'Trust',
        vaPrompt: "We're fully insured and DBS checked. Would you like our details?",
        icon: Shield,
        options: [
          { id: 'reassured', label: 'Reassured', icon: CheckCircle, nextStation: 'job' },
          { id: 'wants_details', label: 'Send Details', icon: FileText, nextStation: 'job' },
        ],
      },
      {
        id: 'job',
        label: 'Job Details',
        vaPrompt: "Now, what needs fixing? No job too small.",
        icon: FileText,
        options: [
          { id: 'clear', label: 'Clear Job', icon: CheckCircle, nextStation: 'booking' },
          { id: 'need_look', label: 'Need to Look', icon: MapPin, nextStation: 'visit' },
        ],
      },
      {
        id: 'visit',
        label: 'Visit',
        vaPrompt: "We'll come have a look - no obligation. When suits you?",
        icon: MapPin,
        isTerminal: true,
      },
      {
        id: 'booking',
        label: 'Booking',
        vaPrompt: "Shall I book that in for you? We'll call before we arrive.",
        icon: Calendar,
        isTerminal: true,
      },
    ],
  },

  SMALL_BIZ: {
    segment: 'SMALL_BIZ',
    lineName: 'Metropolitan',
    color: SEGMENT_LINE_COLORS.SMALL_BIZ,
    icon: Briefcase,
    defaultDestination: 'SITE_VISIT',
    stations: [
      OPENING_STATION,
      IDENTIFY_STATION,
      {
        id: 'segment',
        label: 'Business',
        vaPrompt: "What type of business? We work around your opening hours.",
        icon: Briefcase,
        options: [
          { id: 'retail', label: 'Retail/Shop', icon: Briefcase, nextStation: 'disruption', color: '#9B0058' },
          { id: 'office', label: 'Office', icon: Building2, nextStation: 'disruption' },
          { id: 'hospitality', label: 'Hospitality', icon: User, nextStation: 'disruption' },
        ],
      },
      {
        id: 'disruption',
        label: 'Timing',
        vaPrompt: "When's your quiet time? We can work evenings/weekends.",
        icon: Clock,
        options: [
          { id: 'anytime', label: 'Anytime', icon: CheckCircle, nextStation: 'job' },
          { id: 'out_of_hours', label: 'Out of Hours', icon: Clock, nextStation: 'job' },
        ],
      },
      {
        id: 'job',
        label: 'Job Details',
        vaPrompt: "What needs doing?",
        icon: FileText,
        options: [
          { id: 'simple', label: 'Simple Fix', icon: CheckCircle, nextStation: 'quote' },
          { id: 'survey', label: 'Need Survey', icon: MapPin, nextStation: 'visit' },
        ],
      },
      {
        id: 'visit',
        label: 'Survey',
        vaPrompt: "We'll survey at a time that doesn't disrupt your business.",
        icon: MapPin,
        isTerminal: true,
      },
      {
        id: 'quote',
        label: 'Quote',
        vaPrompt: "I can give you a commercial quote now. Invoice for your records.",
        icon: FileText,
        isTerminal: true,
      },
    ],
  },

  BUDGET: {
    segment: 'BUDGET',
    lineName: 'DLR',
    color: SEGMENT_LINE_COLORS.BUDGET,
    icon: Wallet,
    defaultDestination: 'INSTANT_QUOTE',
    stations: [
      OPENING_STATION,
      IDENTIFY_STATION,
      {
        id: 'segment',
        label: 'Budget',
        vaPrompt: "We're transparent on pricing. No hidden fees.",
        icon: DollarSign,
        options: [
          { id: 'continue', label: 'Continue', icon: CheckCircle, nextStation: 'job', color: '#A0A5A9' },
        ],
      },
      {
        id: 'job',
        label: 'Job Details',
        vaPrompt: "What needs doing? I'll give you the honest price.",
        icon: FileText,
        options: [
          { id: 'simple', label: 'Standard Job', icon: CheckCircle, nextStation: 'price' },
          { id: 'complex', label: 'Need to See', icon: MapPin, nextStation: 'visit' },
        ],
      },
      {
        id: 'visit',
        label: 'Free Quote',
        vaPrompt: "We'll come look for free. No obligation, written quote.",
        icon: MapPin,
        isTerminal: true,
      },
      {
        id: 'price',
        label: 'Price',
        vaPrompt: "Here's the price, all-in. No surprises on the day.",
        icon: DollarSign,
        isTerminal: true,
      },
    ],
  },
};

// Get journey for a segment
export function getSegmentJourney(segment: CallScriptSegment): SegmentJourney {
  return SEGMENT_JOURNEYS[segment];
}

// Get station by ID from a journey
export function getStationById(journey: SegmentJourney, stationId: string): JourneyStation | undefined {
  return journey.stations.find(s => s.id === stationId);
}

// Get next station after selecting an option
export function getNextStation(journey: SegmentJourney, currentStationId: string, optionId: string): JourneyStation | undefined {
  const currentStation = getStationById(journey, currentStationId);
  if (!currentStation?.options) return undefined;

  const option = currentStation.options.find(o => o.id === optionId);
  if (!option?.nextStation) return undefined;

  return getStationById(journey, option.nextStation);
}

// Get station index in journey
export function getStationIndex(journey: SegmentJourney, stationId: string): number {
  return journey.stations.findIndex(s => s.id === stationId);
}

// Check if station is reachable from current position
export function isStationReachable(journey: SegmentJourney, fromStationId: string, toStationId: string): boolean {
  const visited = new Set<string>();
  const queue = [fromStationId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (currentId === toStationId) return true;
    if (visited.has(currentId)) continue;

    visited.add(currentId);
    const station = getStationById(journey, currentId);
    if (station?.options) {
      station.options.forEach(opt => {
        if (opt.nextStation) queue.push(opt.nextStation);
      });
    }
  }

  return false;
}
