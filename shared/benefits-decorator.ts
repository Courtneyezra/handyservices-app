import benefitsTokens from './benefits.tokens.json';

// Types
export interface BenefitToken {
  id: string;
  tiers: string[];
  conditions_any: string[];
  requires_capacity: string | null;
  copy: {
    residential: string;
    pm: string;
  };
  priority: number;
  price_effect: number;
}

export interface BenefitsContext {
  tier: 'essential' | 'enhanced' | 'elite';
  flags: Set<string>;
  segment: 'residential' | 'pm';
  hasCapacity: (key: string) => boolean;
  maxBullets?: number;
}

export interface BenefitsResult {
  visible: string[];
  hidden_count: number;
  ids: string[];
}

// Capacity checking functions
export const createCapacityChecker = () => {
  // In a real implementation, these would check actual calendar/scheduling systems
  // For now, we'll implement basic logic that can be enhanced later
  
  const checkPriorityCapacity = (): boolean => {
    // Check if there are available slots within 7 days
    // This would integrate with booking calendar system
    const currentDate = new Date();
    const weekFromNow = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    // Simulate checking calendar availability
    // In production, this would query the booking system
    return Math.random() > 0.2; // 80% chance of having priority capacity
  };

  const checkSameDayCapacity = (): boolean => {
    // Check if same-day or next-day slots are available
    const currentHour = new Date().getHours();
    
    // More likely to have same-day capacity during business hours
    if (currentHour >= 8 && currentHour <= 16) {
      return Math.random() > 0.4; // 60% chance during business hours
    }
    
    return Math.random() > 0.7; // 30% chance outside business hours
  };

  const checkAftercareCapacity = (): boolean => {
    // Check if aftercare calendar has capacity ~6 months out
    // This would check a different calendar system for follow-up visits
    return Math.random() > 0.1; // 90% chance of aftercare capacity
  };

  return (capacityKey: string): boolean => {
    switch (capacityKey) {
      case 'priority':
        return checkPriorityCapacity();
      case 'same_day':
        return checkSameDayCapacity();
      case 'aftercare':
        return checkAftercareCapacity();
      default:
        return true; // Default to true for unknown capacity keys
    }
  };
};

// Benefits selector function
export const selectBenefits = (context: BenefitsContext): BenefitsResult => {
  const { tier, flags, segment, hasCapacity, maxBullets = 2 } = context;
  const tokens = benefitsTokens.benefits as BenefitToken[];
  
  // Filter tokens based on tier, conditions, and capacity
  const eligibleTokens = tokens.filter(token => {
    // Check if tier matches
    if (!token.tiers.includes(tier)) {
      return false;
    }
    
    // Check if any of the conditions are met
    const hasMatchingCondition = token.conditions_any.some(condition => flags.has(condition));
    if (!hasMatchingCondition) {
      return false;
    }
    
    // Check capacity requirements
    if (token.requires_capacity && !hasCapacity(token.requires_capacity)) {
      return false;
    }
    
    return true;
  });
  
  // Sort by priority (lower number = higher priority)
  const sortedTokens = eligibleTokens.sort((a, b) => a.priority - b.priority);
  
  // Take the top benefits up to maxBullets
  const visibleTokens = sortedTokens.slice(0, maxBullets);
  const hiddenCount = Math.max(0, sortedTokens.length - maxBullets);
  
  // Extract copy for the current segment
  const visibleBenefits = visibleTokens.map(token => token.copy[segment]);
  const visibleIds = visibleTokens.map(token => token.id);
  
  return {
    visible: visibleBenefits,
    hidden_count: hiddenCount,
    ids: visibleIds
  };
};

// Context flags helper
export const createContextFlags = (
  customerType: 'residential' | 'commercial',
  urgency?: 'low' | 'medium' | 'high' | 'emergency'
): Set<string> => {
  const flags = new Set<string>();
  
  // Add segment flags
  if (customerType === 'residential') {
    flags.add('segment_residential');
  } else if (customerType === 'commercial') {
    flags.add('segment_pm'); // Treating commercial as property manager for now
  }
  
  // Add urgency flags
  if (urgency === 'high' || urgency === 'emergency') {
    flags.add('urgent');
  }
  
  return flags;
};