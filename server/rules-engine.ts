/**
 * Rules Engine for Property Maintenance AI Platform
 *
 * Evaluates landlord auto-dispatch rules to determine whether an issue
 * should be auto-dispatched, require approval, or escalate to admin.
 */

import {
    TenantIssue,
    LandlordSettings,
    DispatchDecision,
    PriceEstimate,
    IssueCategory,
    TenantIssueUrgency
} from "@shared/schema";

// Emergency categories that override all rules
const EMERGENCY_CATEGORIES: IssueCategory[] = [
    'plumbing_emergency',
    'electrical_emergency',
    'water_leak',
    'security',
    'heating' // No heating in winter is emergency
];

// Categories that are typically safe for auto-dispatch
const SAFE_AUTO_CATEGORIES: IssueCategory[] = [
    'plumbing',
    'heating',
    'locksmith',
    'security',
    'water_leak'
];

/**
 * Default landlord settings for when no custom settings exist
 */
export function getDefaultLandlordSettings(): Omit<LandlordSettings, 'id' | 'landlordLeadId' | 'createdAt' | 'updatedAt'> {
    return {
        autoApproveUnderPence: 15000, // £150
        requireApprovalAbovePence: 50000, // £500
        autoApproveCategories: ['plumbing_emergency', 'heating', 'security', 'water_leak'],
        alwaysRequireApprovalCategories: ['cosmetic', 'upgrade'],
        emergencyAutoDispatch: true,
        emergencyContactPhone: null,
        monthlyBudgetPence: null,
        budgetAlertThreshold: 80,
        currentMonthSpendPence: 0,
        budgetResetDay: 1,
        notifyOnAutoApprove: true,
        notifyOnCompletion: true,
        notifyOnNewIssue: true,
        preferredChannel: 'whatsapp',
        isPartnerMember: false,
        partnerDiscountPercent: 0
    };
}

/**
 * Evaluates dispatch rules to determine the action for a tenant issue
 *
 * Decision Flow:
 * 1. Emergency override - always auto-dispatch for safety issues
 * 2. Check if category always requires approval (cosmetic, upgrades)
 * 3. Check price thresholds
 * 4. Check if category is in auto-approve list
 * 5. Check budget constraints
 * 6. Default to request approval
 */
export function evaluateDispatchRules(
    issue: Partial<TenantIssue>,
    estimate: PriceEstimate,
    settings: LandlordSettings | null
): DispatchDecision {
    // Use default settings if none provided
    const rules = settings || getDefaultLandlordSettings() as LandlordSettings;

    const category = issue.issueCategory as IssueCategory | null;
    const urgency = issue.urgency as TenantIssueUrgency | null;

    // 1. Emergency override - safety first
    if (urgency === 'emergency') {
        if (rules.emergencyAutoDispatch) {
            return {
                action: 'auto_dispatch',
                reason: 'Emergency issue - auto-dispatched for tenant safety',
                notifyLandlord: true,
                urgencyOverride: true
            };
        } else {
            return {
                action: 'escalate_admin',
                reason: 'Emergency issue - landlord has disabled emergency auto-dispatch',
                notifyLandlord: true,
                urgencyOverride: true
            };
        }
    }

    // 2. Check if category is in emergency list (even if not marked emergency urgency)
    if (category && EMERGENCY_CATEGORIES.includes(category)) {
        if (rules.emergencyAutoDispatch) {
            return {
                action: 'auto_dispatch',
                reason: `Emergency category (${category}) - auto-dispatched for safety`,
                notifyLandlord: true,
                urgencyOverride: true
            };
        }
    }

    // 3. Check if category always requires approval
    if (category && rules.alwaysRequireApprovalCategories?.includes(category)) {
        return {
            action: 'request_approval',
            reason: `Category "${category}" always requires landlord approval`,
            notifyLandlord: true
        };
    }

    // 4. Check price thresholds
    const estimatedPrice = estimate.midPricePence;

    // Always require approval above threshold
    if (rules.requireApprovalAbovePence && estimatedPrice > rules.requireApprovalAbovePence) {
        return {
            action: 'request_approval',
            reason: `Estimated price £${(estimatedPrice / 100).toFixed(0)} exceeds approval threshold £${(rules.requireApprovalAbovePence / 100).toFixed(0)}`,
            notifyLandlord: true
        };
    }

    // 5. Check budget constraints
    if (rules.monthlyBudgetPence) {
        const projectedSpend = (rules.currentMonthSpendPence || 0) + estimatedPrice;

        if (projectedSpend > rules.monthlyBudgetPence) {
            return {
                action: 'request_approval',
                reason: `Would exceed monthly budget (£${(projectedSpend / 100).toFixed(0)} / £${(rules.monthlyBudgetPence / 100).toFixed(0)})`,
                notifyLandlord: true
            };
        }

        // Alert if approaching budget threshold
        const budgetUsagePercent = (projectedSpend / rules.monthlyBudgetPence) * 100;
        if (budgetUsagePercent >= (rules.budgetAlertThreshold || 80)) {
            // Still allow but flag it
            console.log(`[RulesEngine] Budget alert: ${budgetUsagePercent.toFixed(0)}% of monthly budget used`);
        }
    }

    // 6. Auto-approve if under threshold AND category is in auto-approve list
    if (rules.autoApproveUnderPence && estimatedPrice <= rules.autoApproveUnderPence) {
        if (category && rules.autoApproveCategories?.includes(category)) {
            return {
                action: 'auto_dispatch',
                reason: `Under £${(rules.autoApproveUnderPence / 100).toFixed(0)} threshold + approved category "${category}"`,
                notifyLandlord: rules.notifyOnAutoApprove ?? true
            };
        }
    }

    // 7. Auto-approve for safe categories even without explicit config
    if (category && SAFE_AUTO_CATEGORIES.includes(category) && estimate.confidence >= 70) {
        if (rules.autoApproveUnderPence && estimatedPrice <= rules.autoApproveUnderPence) {
            return {
                action: 'auto_dispatch',
                reason: `Safe category "${category}" under threshold with high confidence`,
                notifyLandlord: rules.notifyOnAutoApprove ?? true
            };
        }
    }

    // 8. Default - request approval for anything we're not sure about
    return {
        action: 'request_approval',
        reason: 'Default policy - requesting landlord approval',
        notifyLandlord: true
    };
}

/**
 * Determines the urgency level based on issue details
 */
export function assessUrgency(
    description: string,
    category: IssueCategory | null
): TenantIssueUrgency {
    const descLower = description.toLowerCase();

    // Emergency keywords
    const emergencyKeywords = [
        'gas smell', 'gas leak', 'no heating', 'no hot water', 'flooding',
        'burst pipe', 'water everywhere', 'electrical fire', 'sparks',
        'locked out', 'break in', 'broken lock', 'security', 'unsafe',
        'ceiling collapse', 'structural', 'danger', 'emergency', 'urgent'
    ];

    // High urgency keywords
    const highKeywords = [
        'leak', 'dripping', 'no water', 'toilet broken', 'shower broken',
        'boiler not working', 'fridge broken', 'freezer broken', 'pest',
        'mice', 'rats', 'cockroach', 'bed bugs', 'affecting daily'
    ];

    // Check for emergency
    for (const keyword of emergencyKeywords) {
        if (descLower.includes(keyword)) {
            return 'emergency';
        }
    }

    // Category-based emergency
    if (category && EMERGENCY_CATEGORIES.includes(category)) {
        return 'emergency';
    }

    // Check for high urgency
    for (const keyword of highKeywords) {
        if (descLower.includes(keyword)) {
            return 'high';
        }
    }

    // Default based on category
    if (category) {
        switch (category) {
            case 'plumbing':
            case 'electrical':
            case 'heating':
                return 'medium';
            case 'cosmetic':
            case 'upgrade':
            case 'garden':
                return 'low';
            default:
                return 'medium';
        }
    }

    return 'medium';
}

/**
 * Determines the issue category based on description
 */
export function categorizeIssue(description: string): IssueCategory {
    const descLower = description.toLowerCase();

    // Plumbing keywords
    if (/tap|sink|drain|pipe|leak|water|toilet|shower|bath|plumb/i.test(descLower)) {
        if (/burst|flood|water everywhere|emergency/i.test(descLower)) {
            return 'plumbing_emergency';
        }
        return 'plumbing';
    }

    // Electrical keywords
    if (/electric|socket|switch|light|fuse|power|outlet|wiring/i.test(descLower)) {
        if (/sparks|fire|burning|smell|smoke|emergency/i.test(descLower)) {
            return 'electrical_emergency';
        }
        return 'electrical';
    }

    // Heating keywords
    if (/heating|boiler|radiator|thermostat|hot water|no heat|cold/i.test(descLower)) {
        return 'heating';
    }

    // Security keywords
    if (/lock|door|window|break|secure|key|alarm/i.test(descLower)) {
        if (/locked out|break in|broken lock/i.test(descLower)) {
            return 'security';
        }
        return 'locksmith';
    }

    // Carpentry keywords
    if (/door|window|cupboard|drawer|shelf|wood|cabinet|hinge/i.test(descLower)) {
        return 'carpentry';
    }

    // Appliance keywords
    if (/fridge|freezer|oven|hob|dishwasher|washing machine|dryer|appliance/i.test(descLower)) {
        return 'appliance';
    }

    // Pest control
    if (/pest|mouse|mice|rat|cockroach|bed bug|ant|wasp|bee/i.test(descLower)) {
        return 'pest_control';
    }

    // Cosmetic
    if (/paint|crack|chip|scratch|stain|mark|cosmetic|look/i.test(descLower)) {
        return 'cosmetic';
    }

    // Garden
    if (/garden|lawn|hedge|tree|plant|fence|gate|outdoor/i.test(descLower)) {
        return 'garden';
    }

    // Cleaning
    if (/clean|mould|mold|damp|smell|dirty/i.test(descLower)) {
        return 'cleaning';
    }

    return 'general';
}

/**
 * Calculates whether the landlord should be chased for a response
 */
export function shouldChaseLandlord(issue: TenantIssue): {
    shouldChase: boolean;
    nextChaseTime: Date | null;
    chaseType: 'reminder' | 'final' | 'escalate' | null;
} {
    if (!issue.landlordNotifiedAt) {
        return { shouldChase: false, nextChaseTime: null, chaseType: null };
    }

    const now = new Date();
    const notifiedAt = new Date(issue.landlordNotifiedAt);
    const reminderCount = issue.landlordReminderCount || 0;
    const hoursSinceNotified = (now.getTime() - notifiedAt.getTime()) / (1000 * 60 * 60);

    // Already approved or rejected
    if (issue.landlordApprovedAt || issue.landlordRejectedAt) {
        return { shouldChase: false, nextChaseTime: null, chaseType: null };
    }

    // Chase schedule: 24h, 48h, 72h escalate
    if (reminderCount === 0 && hoursSinceNotified >= 24) {
        return {
            shouldChase: true,
            nextChaseTime: now,
            chaseType: 'reminder'
        };
    }

    if (reminderCount === 1 && hoursSinceNotified >= 48) {
        return {
            shouldChase: true,
            nextChaseTime: now,
            chaseType: 'final'
        };
    }

    if (reminderCount >= 2 && hoursSinceNotified >= 72) {
        return {
            shouldChase: true,
            nextChaseTime: now,
            chaseType: 'escalate'
        };
    }

    // Calculate next chase time
    let nextChaseHours: number;
    if (reminderCount === 0) {
        nextChaseHours = 24;
    } else if (reminderCount === 1) {
        nextChaseHours = 48;
    } else {
        nextChaseHours = 72;
    }

    const nextChaseTime = new Date(notifiedAt.getTime() + nextChaseHours * 60 * 60 * 1000);

    return {
        shouldChase: false,
        nextChaseTime,
        chaseType: null
    };
}

/**
 * Updates the monthly spend for a landlord
 */
export function calculateNewMonthlySpend(
    settings: LandlordSettings,
    amountPence: number
): number {
    const now = new Date();
    const resetDay = settings.budgetResetDay || 1;

    // Check if we need to reset the budget (new month)
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), resetDay);

    // If we're before the reset day this month, use last month's reset
    if (now.getDate() < resetDay) {
        currentMonthStart.setMonth(currentMonthStart.getMonth() - 1);
    }

    // For now, just add to current spend
    // In production, this would check updatedAt to see if budget should reset
    return (settings.currentMonthSpendPence || 0) + amountPence;
}
