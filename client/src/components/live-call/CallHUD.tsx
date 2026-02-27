/**
 * CallHUD - "The Glance"
 *
 * Live call heads-up display for VAs.
 * Left: Segment, jobs, actions
 * Right: Customer info capture (name, WhatsApp, address)
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Home,
  Building2,
  Briefcase,
  Store,
  Shield,
  Wallet,
  FileText,
  Video,
  MapPin,
  Mic,
  Check,
  HelpCircle,
  User,
  Phone,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { AvailabilityPanel } from './AvailabilityPanel';
import type { CallScriptSegment } from '@shared/schema';
import { AddressInput, AddressDetails } from './AddressInput';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DetectedJobHUD {
  id: string;
  description: string;
  matched: boolean;
  pricePence?: number;
  trafficLight?: 'green' | 'amber' | 'red'; // Complexity scoring: green=SKU match, amber=unmatched, red=complex/specialist
}

export interface CustomerInfo {
  name: string;
  whatsappSameAsCalling: boolean | null; // null = not asked yet
  whatsappNumber: string; // only if different
  address: string;
  addressDetails?: AddressDetails; // Google Places validated address details
  addressValidated?: boolean; // Whether address was validated via Google Places
}

type HUDSegment = Exclude<CallScriptSegment, 'EMERGENCY'>;

// Action button states for visual feedback
export type ActionState = 'idle' | 'pending' | 'success' | 'error';

// Route recommendation from backend (Tier 2 classification)
export interface RouteRecommendation {
  route: 'instant' | 'video' | 'visit' | 'refer';
  color: string;
  reason: string;
  confidence: number;
}

interface CallHUDProps {
  // Segment
  selectedSegment: HUDSegment | null;
  aiRecommendedSegment: HUDSegment | null;
  onSegmentSelect: (segment: HUDSegment) => void;

  // Jobs
  jobs: DetectedJobHUD[];

  // Backend route recommendation (Tier 2 - overrides local calculation when available)
  routeRecommendation?: RouteRecommendation | null;

  // Customer info
  customerInfo: CustomerInfo;
  onCustomerInfoChange: (info: CustomerInfo) => void;
  callingNumber?: string; // The number they're calling from

  // Actions
  onQuote: () => void;
  onVideo: () => void;
  onVisit: () => void;

  // Action states for button feedback
  quoteState?: ActionState;
  videoState?: ActionState;
  visitState?: ActionState;

  // Call info
  callDuration?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEGMENT CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const SEGMENTS: {
  id: HUDSegment;
  label: string;
  color: string;
  icon: React.ElementType;
  hook: string;
}[] = [
  { id: 'LANDLORD', label: 'LANDLORD', color: '#EA580C', icon: Home, hook: "You don't need to be there" },
  { id: 'PROP_MGR', label: 'PROP MGR', color: '#16A34A', icon: Building2, hook: 'We handle the portfolio' },
  { id: 'BUSY_PRO', label: 'BUSY', color: '#CA8A04', icon: Briefcase, hook: 'Quote in 60 seconds' },
  { id: 'SMALL_BIZ', label: 'BIZ', color: '#9333EA', icon: Store, hook: 'Zero disruption' },
  { id: 'OAP', label: 'TRUST', color: '#2563EB', icon: Shield, hook: 'Fully insured, DBS checked' },
  { id: 'BUDGET', label: 'BUDGET', color: '#525252', icon: Wallet, hook: 'No hidden fees' },
];

const ACTION_CONFIG = {
  quote: { label: 'SEND QUOTE', icon: FileText, color: '#22C55E' },
  video: { label: 'GET VIDEO', icon: Video, color: '#F59E0B' },
  visit: { label: 'BOOK VISIT', icon: MapPin, color: '#3B82F6' },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatPrice(pence: number): string {
  return `£${Math.round(pence / 100)}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function CallHUD({
  selectedSegment,
  aiRecommendedSegment,
  onSegmentSelect,
  jobs,
  routeRecommendation,
  customerInfo,
  onCustomerInfoChange,
  callingNumber,
  onQuote,
  onVideo,
  onVisit,
  quoteState = 'idle',
  videoState = 'idle',
  visitState = 'idle',
  callDuration = 0,
}: CallHUDProps) {
  const segment = SEGMENTS.find(s => s.id === selectedSegment);
  const isListening = !selectedSegment;

  // Calculate totals and traffic light status
  const matchedJobs = jobs.filter(j => j.matched);
  const unmatchedJobs = jobs.filter(j => !j.matched);
  const totalPence = matchedJobs.reduce((sum, j) => sum + (j.pricePence || 0), 0);

  // Traffic light categorization (with backward compatibility for jobs without explicit trafficLight)
  // Green: Explicitly green OR matched jobs without explicit traffic light
  // Amber: Explicitly amber OR unmatched jobs without explicit traffic light (not red)
  // Red: Only explicitly marked red (specialist/complex work)
  const greenJobs = jobs.filter(j => j.trafficLight === 'green' || (j.matched && !j.trafficLight));
  const amberJobs = jobs.filter(j => j.trafficLight === 'amber' || (!j.matched && !j.trafficLight));
  const redJobs = jobs.filter(j => j.trafficLight === 'red');

  // Determine button states based on traffic lights
  const allGreen = jobs.length > 0 && greenJobs.length === jobs.length;
  const hasAmber = amberJobs.length > 0;
  const hasRed = redJobs.length > 0;

  // Legacy flags (kept for backward compatibility)
  const hasUnmatched = unmatchedJobs.length > 0;
  const allMatched = jobs.length > 0 && !hasUnmatched;

  // Check if info is complete
  const hasName = customerInfo.name.trim().length > 0;
  const hasWhatsApp = customerInfo.whatsappSameAsCalling === true ||
    (customerInfo.whatsappSameAsCalling === false && customerInfo.whatsappNumber.trim().length > 0);
  const hasAddress = customerInfo.address.trim().length > 0;
  const infoComplete = hasName && hasWhatsApp && hasAddress;

  const handleAction = (action: string) => {
    const actions: Record<string, () => void> = { quote: onQuote, video: onVideo, visit: onVisit };
    actions[action]?.();
  };

  const updateInfo = (updates: Partial<CustomerInfo>) => {
    onCustomerInfoChange({ ...customerInfo, ...updates });
  };

  return (
    <div className="h-full min-h-screen bg-black flex flex-col lg:flex-row">
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* LEFT SIDE - Segments, Jobs, Actions */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* HEADER */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <div className="absolute inset-0 rounded-full bg-red-500 animate-ping" />
            </div>
            <span className="text-white/50 text-xs font-medium">LIVE</span>
          </div>
          <div className="text-white font-mono text-xl font-light">
            {formatDuration(callDuration)}
          </div>
        </div>

        {/* SEGMENT TABS */}
        <div className="px-2 py-2 border-b border-white/10">
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {SEGMENTS.map((seg) => {
              const isSelected = selectedSegment === seg.id;
              const isAiPick = aiRecommendedSegment === seg.id && !isSelected;
              const Icon = seg.icon;

              return (
                <motion.button
                  key={seg.id}
                  onClick={() => onSegmentSelect(seg.id)}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    'relative flex items-center gap-1 px-2.5 py-2 rounded-lg',
                    'text-xs font-semibold whitespace-nowrap transition-colors',
                    isSelected ? 'text-white' : 'text-white/40'
                  )}
                  style={{ backgroundColor: isSelected ? seg.color : 'rgba(255,255,255,0.05)' }}
                >
                  {isAiPick && (
                    <motion.div
                      className="absolute inset-0 rounded-lg"
                      style={{ border: `2px solid ${seg.color}` }}
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5" />
                  <span>{seg.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 flex flex-col px-4 py-4 overflow-auto">
          <AnimatePresence mode="wait">
            {isListening ? (
              <motion.div
                key="listening"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center"
              >
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mb-4"
                >
                  <Mic className="w-10 h-10 text-white/50" />
                </motion.div>
                <p className="text-xl text-white/40 font-light">Listening...</p>
              </motion.div>
            ) : (
              <motion.div
                key={selectedSegment}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col"
              >
                {/* JOBS LIST */}
                <div className="bg-white/5 rounded-xl p-3 mb-4">
                  {jobs.length === 0 ? (
                    <p className="text-white/30 text-sm text-center py-4">Listening for jobs...</p>
                  ) : (
                    <div className="space-y-2">
                      {jobs.map((job) => (
                        <div key={job.id} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {job.matched ? (
                              <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <HelpCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            )}
                            <span className={cn('text-sm truncate', job.matched ? 'text-white' : 'text-amber-400')}>
                              {job.description}
                            </span>
                          </div>
                          <span className={cn('text-sm font-semibold flex-shrink-0', job.matched ? 'text-green-400' : 'text-amber-400/70')}>
                            {job.matched && job.pricePence ? formatPrice(job.pricePence) : '(video)'}
                          </span>
                        </div>
                      ))}
                      {matchedJobs.length > 0 && (
                        <>
                          <div className="border-t border-white/10 my-2" />
                          <div className="flex items-center justify-between">
                            <span className="text-white/60 text-sm">Total</span>
                            <span className="text-xl font-bold" style={{ color: segment?.color }}>
                              {formatPrice(totalPence)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* HOOK PHRASE */}
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xl font-medium text-center" style={{ color: segment?.color }}>
                    {segment?.hook}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* AVAILABILITY PANEL */}
        <div className="px-3 py-2">
          <AvailabilityPanel defaultExpanded={false} />
        </div>

        {/* ROUTE RECOMMENDATION */}
        <div className="px-3 py-2 border-t border-white/10">
          {(() => {
            // Use backend route recommendation if available, else calculate locally
            let aiRecommendedAction: 'quote' | 'video' | 'visit' | null = null;
            let recommendationReason = '';
            let recommendationColor = '#6B7280';

            if (routeRecommendation) {
              // Backend Tier 2 recommendation available
              const routeToAction: Record<string, 'quote' | 'video' | 'visit'> = {
                instant: 'quote',
                video: 'video',
                visit: 'visit',
                refer: 'visit', // Refer is also handled via visit flow
              };
              aiRecommendedAction = routeToAction[routeRecommendation.route];
              recommendationReason = routeRecommendation.reason;
              recommendationColor = routeRecommendation.color;
            } else if (jobs.length === 0) {
              recommendationReason = 'Listening for jobs...';
            } else if (hasRed) {
              aiRecommendedAction = 'visit';
              recommendationReason = `${redJobs.length} specialist job${redJobs.length > 1 ? 's' : ''} detected`;
              recommendationColor = '#3B82F6';
            } else if (hasAmber) {
              aiRecommendedAction = 'video';
              recommendationReason = `${amberJobs.length} job${amberJobs.length > 1 ? 's' : ''} need visual confirmation`;
              recommendationColor = '#F59E0B';
            } else if (allGreen) {
              aiRecommendedAction = 'quote';
              recommendationReason = `All ${greenJobs.length} job${greenJobs.length > 1 ? 's' : ''} priced - ready to quote`;
              recommendationColor = '#22C55E';
            }

            return (
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: recommendationColor }}
                />
                <span className="text-xs text-white/60">
                  {aiRecommendedAction ? (
                    <>
                      <span className="text-white font-medium" style={{ color: recommendationColor }}>
                        {aiRecommendedAction === 'quote' ? 'SEND QUOTE' :
                         aiRecommendedAction === 'video' ? 'GET VIDEO' : 'BOOK VISIT'}
                      </span>
                      <span className="text-white/40"> — {recommendationReason}</span>
                    </>
                  ) : (
                    <span className="text-white/40">{recommendationReason}</span>
                  )}
                </span>
              </div>
            );
          })()}

          {/* ACTION BUTTONS */}
          <div className="grid grid-cols-3 gap-2">
            {(['quote', 'video', 'visit'] as const).map((action) => {
              const config = ACTION_CONFIG[action];
              const Icon = config.icon;

              // Determine AI recommended action for pulsing border
              // Use backend recommendation if available
              let aiRecommendedAction: 'quote' | 'video' | 'visit' | null = null;
              if (routeRecommendation) {
                const routeToAction: Record<string, 'quote' | 'video' | 'visit'> = {
                  instant: 'quote',
                  video: 'video',
                  visit: 'visit',
                  refer: 'visit',
                };
                aiRecommendedAction = routeToAction[routeRecommendation.route];
              } else if (hasRed) {
                aiRecommendedAction = 'visit';
              } else if (hasAmber) {
                aiRecommendedAction = 'video';
              } else if (allGreen && jobs.length > 0) {
                aiRecommendedAction = 'quote';
              }

              const isAiPick = aiRecommendedAction === action;

              // Get the state for this action
              const stateMap = { quote: quoteState, video: videoState, visit: visitState };
              const state = stateMap[action];

              // Buttons are ALWAYS clickable - AI only recommends, user decides
              // Only disable during pending state (action in progress)
              const isDisabled = state === 'pending';
              let tooltipText = ''; // Informational tooltip (not blocking)

              if (action === 'quote') {
                if (hasRed) {
                  tooltipText = 'AI suggests site visit for complex job';
                } else if (hasAmber) {
                  tooltipText = 'AI suggests video for unpriced jobs';
                } else if (jobs.length === 0) {
                  tooltipText = 'No jobs detected yet';
                } else if (allGreen) {
                  tooltipText = 'All jobs priced - ready to quote';
                } else {
                  tooltipText = 'Send instant quote to customer';
                }
              } else if (action === 'video') {
                if (hasRed) {
                  tooltipText = 'AI suggests site visit for complex job';
                } else if (allGreen && jobs.length > 0) {
                  tooltipText = 'All jobs already have instant pricing';
                } else if (hasAmber) {
                  tooltipText = `AI recommends video for ${amberJobs.length} job${amberJobs.length > 1 ? 's' : ''}`;
                } else if (jobs.length === 0) {
                  tooltipText = 'No jobs detected yet';
                } else {
                  tooltipText = 'Request video assessment from customer';
                }
              } else if (action === 'visit') {
                if (hasRed) {
                  tooltipText = `AI recommends visit for ${redJobs.length} specialist job${redJobs.length > 1 ? 's' : ''}`;
                } else if (hasAmber) {
                  tooltipText = 'AI suggests video first';
                } else if (allGreen && jobs.length > 0) {
                  tooltipText = 'All jobs already have instant pricing';
                } else if (jobs.length === 0) {
                  tooltipText = 'No jobs detected yet';
                } else {
                  tooltipText = 'Book on-site assessment visit';
                }
              }

              // Determine button appearance based on state
              const isSuccess = state === 'success';
              const isError = state === 'error';
              const isPending = state === 'pending';

              // Get background color based on state
              // Non-recommended buttons get a subtle dim color, but are still clickable
              const getBgColor = () => {
                if (isPending) return config.color;
                if (isSuccess) return '#16A34A'; // Green
                if (isError) return '#DC2626'; // Red
                // AI recommended action gets full color, others get dimmed but still visible
                if (isAiPick) return config.color;
                return 'rgba(255,255,255,0.1)'; // Subtle dim for non-recommended (still clickable)
              };

              return (
                <div key={action} className="flex flex-col items-center gap-1">
                  <motion.button
                    onClick={() => handleAction(action)}
                    disabled={isDisabled}
                    title={tooltipText}
                    whileTap={{ scale: isDisabled ? 1 : 0.95 }}
                    className={cn(
                      'relative w-full flex flex-col items-center justify-center gap-1',
                      'py-3 rounded-xl font-semibold text-xs transition-all',
                      // Only show pending state styling, not disabled styling
                      isPending && 'opacity-70'
                    )}
                    style={{
                      backgroundColor: getBgColor(),
                      color: isAiPick || isPending || isSuccess || isError ? 'white' : 'rgba(255,255,255,0.7)',
                    }}
                  >
                    {/* AI Pick pulsing border - visual recommendation highlight */}
                    {isAiPick && !isPending && !isSuccess && !isError && (
                      <motion.div
                        className="absolute inset-0 rounded-xl pointer-events-none"
                        style={{ border: `2px solid ${config.color}` }}
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    )}
                    {isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : isSuccess ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : isError ? (
                      <AlertCircle className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                    <span>
                      {isPending ? 'SENDING...' : isSuccess ? 'SENT!' : isError ? 'FAILED' : config.label}
                    </span>
                  </motion.button>
                  {/* Show "Recommended" badge for AI pick */}
                  {isAiPick && !isPending && !isSuccess && !isError && (
                    <span className="text-[10px] text-white/60 text-center leading-tight font-medium" style={{ color: config.color }}>
                      Recommended
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* RIGHT SIDE - Customer Info Capture */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-white/10 bg-white/[0.02] p-4 flex flex-col gap-4">
        <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Customer Info</h2>

        {/* NAME */}
        <div>
          <label className="flex items-center gap-2 text-white/40 text-xs mb-1.5">
            <User className="w-3.5 h-3.5" />
            Name
          </label>
          <input
            type="text"
            value={customerInfo.name}
            onChange={(e) => updateInfo({ name: e.target.value })}
            placeholder="Customer name..."
            className={cn(
              "w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30",
              "focus:outline-none focus:ring-2 focus:ring-white/20",
              hasName ? "border-green-500/50" : "border-white/10"
            )}
          />
        </div>

        {/* WHATSAPP */}
        <div>
          <label className="flex items-center gap-2 text-white/40 text-xs mb-1.5">
            <Phone className="w-3.5 h-3.5" />
            WhatsApp Number
          </label>
          {callingNumber && (
            <p className="text-white/30 text-xs mb-2">Calling from: {callingNumber}</p>
          )}
          <div className="space-y-2">
            <button
              onClick={() => updateInfo({ whatsappSameAsCalling: true, whatsappNumber: '' })}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
                customerInfo.whatsappSameAsCalling === true
                  ? "bg-green-500/20 border border-green-500/50 text-green-400"
                  : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                customerInfo.whatsappSameAsCalling === true ? "border-green-500" : "border-white/30"
              )}>
                {customerInfo.whatsappSameAsCalling === true && <div className="w-2 h-2 rounded-full bg-green-500" />}
              </div>
              Same as calling number
            </button>
            <button
              onClick={() => updateInfo({ whatsappSameAsCalling: false })}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
                customerInfo.whatsappSameAsCalling === false
                  ? "bg-amber-500/20 border border-amber-500/50 text-amber-400"
                  : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                customerInfo.whatsappSameAsCalling === false ? "border-amber-500" : "border-white/30"
              )}>
                {customerInfo.whatsappSameAsCalling === false && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              </div>
              Different number
            </button>
            {customerInfo.whatsappSameAsCalling === false && (
              <input
                type="tel"
                value={customerInfo.whatsappNumber}
                onChange={(e) => updateInfo({ whatsappNumber: e.target.value })}
                placeholder="WhatsApp number..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            )}
          </div>
        </div>

        {/* ADDRESS */}
        <AddressInput
          value={customerInfo.address}
          onChange={(value, details) => {
            updateInfo({
              address: value,
              addressDetails: details,
              addressValidated: !!details,
            });
          }}
          isValidated={customerInfo.addressValidated}
          onValidationChange={(validated) => {
            if (!validated) {
              updateInfo({
                addressValidated: false,
                addressDetails: undefined,
              });
            }
          }}
          placeholder="Full address or postcode..."
        />

        {/* STATUS */}
        <div className="mt-auto pt-4 border-t border-white/10">
          <div className={cn(
            "flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium",
            infoComplete ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/40"
          )}>
            {infoComplete ? (
              <>
                <Check className="w-4 h-4" />
                Ready to send
              </>
            ) : (
              <>
                <HelpCircle className="w-4 h-4" />
                Capture info above
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CallHUD;
