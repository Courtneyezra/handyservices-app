/**
 * Tenant Worker
 *
 * Handles tenant issue reports with three main goals:
 * 1. REASSURE - Make tenant feel heard
 * 2. ENSURE SAFETY - Guide through immediate safety concerns
 * 3. GATHER INFORMATION - Collect details for maintenance team
 */

import { BaseWorker, commonTools } from './base-worker';
import { Tool, AIProvider } from '../provider';
import { categorizeIssue, assessUrgency } from '../../rules-engine';
import { flowEngine, selectFlowForIssue } from '../../troubleshooting/flow-engine';
import { WorkerContext } from '@shared/schema';

const TENANT_SYSTEM_PROMPT = `You are a friendly property maintenance assistant helping tenants with home issues.
Your job is to help them either fix things themselves (DIY) or arrange for a professional handyman.

## TROUBLESHOOTING FIRST - CRITICAL

When a tenant reports an issue, ALWAYS try guided troubleshooting before arranging a callout:

1. **Identify the Issue** - Understand what's wrong
2. **Start Troubleshooting** - Use the start_troubleshooting tool immediately
3. **Guide Through Steps** - Use continue_troubleshooting as tenant responds
4. **Resolve or Escalate** - If DIY works, great! If not, arrange professional visit

WHY: Many issues can be fixed remotely, saving time and money for everyone.

WHEN TO USE start_troubleshooting:
- Tenant describes ANY maintenance issue
- Even if it sounds complex - the flow will decide if it's safe for DIY
- Examples: "my tap is dripping", "radiator is cold", "toilet keeps running"

WHEN TO USE continue_troubleshooting:
- You have an active troubleshooting session
- Tenant responds to a troubleshooting question
- Always pass their response to continue the guided flow

## Your 3 Goals (Handle Simultaneously)

### 1. REASSURE
- "Don't worry, we'll get this sorted"
- "You're doing the right thing reporting this"
- "We deal with this all the time"

### 2. ENSURE SAFETY (when relevant)
- Gas smell → "Open windows, don't use switches, leave if strong smell"
- Water leak → "Turn off stopcock if you can find it"
- Electrical issues → "Don't touch it, we'll send someone"
- No heating in winter → "We'll prioritize this"

### 3. GATHER INFORMATION
- What exactly is the issue?
- Where in the property?
- When did it start / is it getting worse?
- **ALWAYS ask for a video or photos** - this helps us prepare properly
- Access instructions (key location, alarm code, pets?)
- When are you available for a visit?

## CRITICAL: Always Ask for Video (For ALL Issues)

**A video is worth 1000 photos.** Our team can diagnose and prepare 10x better with video.

ALWAYS ask for a video early in the conversation - this is STANDARD for every single issue:
- "Can you send a quick 10-15 second video? It really helps us see exactly what's going on"
- "A short video would be super helpful - just point your phone at the problem"
- "If you can send a video that'd be brilliant - helps our team come prepared"

Why video helps for EVERYTHING:
- See the actual problem (not just a frozen moment)
- Hear any sounds (dripping, rattling, creaking)
- Understand the scale, location, and access
- Prepare the right tools and parts before arrival
- Sometimes diagnose remotely and save a callout fee

Even "simple" issues benefit: a broken door handle, loose fitting, cracked tile - video shows us exactly what we're dealing with.

If tenant sends only a photo: "Thanks for the photo! A quick video would help even more if you can - even 10 seconds helps us see things a photo can't capture"

If tenant sends only text: "Could you send a quick video showing the problem? Just point your phone at it for 10-15 seconds - really helps us prepare"

## Conversation Flow

1. **Greet & Understand** - Ask what's wrong
2. **Assess Safety** - Check for any immediate dangers
3. **Start Troubleshooting** - Use start_troubleshooting tool for guided DIY
4. **Ask for Video/Photos** - Get visual evidence early
5. **Continue Troubleshooting** - Use continue_troubleshooting as tenant responds
6. **If DIY doesn't work** - Gather remaining details for professional visit
7. **Confirm & Report** - Let them know next steps

## Safety Rules - NEVER Suggest DIY For:
- Anything involving gas
- Electrical beyond flipping breakers
- Working at height
- Structural issues
- Anything that smells dangerous or feels unsafe

## Communication Style
- Keep messages SHORT (2-3 sentences max)
- Friendly and conversational, not robotic
- Use simple language, no jargon
- Empathetic - acknowledge frustration
- Ask one question at a time
- Use the get_diy_advice tool for DIY suggestions
`;

export class TenantWorker extends BaseWorker {
    name: 'TENANT_WORKER' = 'TENANT_WORKER';
    systemPrompt = TENANT_SYSTEM_PROMPT;

    constructor(provider: AIProvider) {
        super(provider);
        this.chatOptions = {
            temperature: 0.7,
            maxTokens: 512 // Keep responses short
        };
    }

    tools: Tool[] = [
        ...commonTools,
        {
            name: 'start_troubleshooting',
            description: 'Start a guided troubleshooting flow for the reported issue. Use this when a tenant first reports a maintenance issue to guide them through DIY resolution steps.',
            parameters: {
                type: 'object',
                properties: {
                    issueCategory: {
                        type: 'string',
                        description: 'Category of issue (e.g., plumbing, heating, electrical, doors_windows)'
                    },
                    issueDescription: {
                        type: 'string',
                        description: 'Brief description of the issue from tenant'
                    }
                },
                required: ['issueCategory', 'issueDescription']
            },
            handler: async (args, ctx) => {
                const { issueCategory, issueDescription } = args as {
                    issueCategory: string;
                    issueDescription: string;
                };
                const context = ctx as WorkerContext | undefined;

                console.log('[TenantWorker] Starting troubleshooting:', { issueCategory, issueDescription });

                // Select the best flow for this issue
                const flowId = selectFlowForIssue(issueCategory, issueDescription);
                if (!flowId) {
                    return {
                        success: false,
                        message: 'No troubleshooting flow available for this issue type',
                        shouldEscalate: true
                    };
                }

                // Get issue ID from context if available
                const issueId = context?.currentIssue?.id || `temp_${Date.now()}`;

                // Start the troubleshooting session
                const result = await flowEngine.startSession(issueId, flowId, issueDescription);

                return {
                    success: true,
                    sessionStatus: result.sessionStatus,
                    response: result.response,
                    outcome: result.outcome,
                    nextStepId: result.nextStepId
                };
            }
        },
        {
            name: 'continue_troubleshooting',
            description: 'Continue an active troubleshooting session with the tenant response. Use this when the tenant responds to a troubleshooting question.',
            parameters: {
                type: 'object',
                properties: {
                    sessionId: {
                        type: 'string',
                        description: 'The troubleshooting session ID'
                    },
                    tenantResponse: {
                        type: 'string',
                        description: 'The tenant response to the troubleshooting question'
                    }
                },
                required: ['sessionId', 'tenantResponse']
            },
            handler: async (args) => {
                const { sessionId, tenantResponse } = args as {
                    sessionId: string;
                    tenantResponse: string;
                };

                console.log('[TenantWorker] Continuing troubleshooting:', { sessionId, tenantResponse: tenantResponse.substring(0, 100) });

                const result = await flowEngine.processResponse(sessionId, tenantResponse);

                return {
                    success: true,
                    sessionStatus: result.sessionStatus,
                    response: result.response,
                    outcome: result.outcome,
                    nextStepId: result.nextStepId,
                    dataToCollect: result.dataToCollect
                };
            }
        },
        {
            name: 'get_diy_advice',
            description: 'Get safe DIY suggestions for common household issues',
            parameters: {
                type: 'object',
                properties: {
                    issueType: {
                        type: 'string',
                        description: 'Type of issue (e.g., plumbing, door, heating)'
                    },
                    description: {
                        type: 'string',
                        description: 'Detailed description of the problem'
                    }
                },
                required: ['issueType', 'description']
            },
            handler: async (args) => {
                const { issueType, description } = args as { issueType: string; description: string };
                return getDIYAdvice(issueType, description);
            }
        },
        {
            name: 'assess_issue',
            description: 'Assess the category and urgency of an issue based on description',
            parameters: {
                type: 'object',
                properties: {
                    description: {
                        type: 'string',
                        description: 'Description of the issue'
                    }
                },
                required: ['description']
            },
            handler: async (args) => {
                const { description } = args as { description: string };
                const category = categorizeIssue(description);
                const urgency = assessUrgency(description, category);
                return {
                    category,
                    urgency,
                    isSafetyIssue: ['emergency', 'high'].includes(urgency),
                    suggestDIY: !['emergency', 'high'].includes(urgency) &&
                                !['plumbing_emergency', 'electrical_emergency', 'security', 'heating'].includes(category)
                };
            }
        },
        {
            name: 'request_photos',
            description: 'Request photos or video from the tenant',
            parameters: {
                type: 'object',
                properties: {
                    reason: {
                        type: 'string',
                        description: 'Why photos would help'
                    }
                },
                required: ['reason']
            },
            handler: async (args) => {
                console.log('[TenantWorker] Requesting photos:', args.reason);
                return {
                    requested: true,
                    message: 'Photo request logged'
                };
            }
        },
        {
            name: 'request_availability',
            description: 'Ask tenant when they are available for a visit',
            parameters: {
                type: 'object',
                properties: {
                    urgency: {
                        type: 'string',
                        enum: ['today', 'tomorrow', 'this_week', 'flexible'],
                        description: 'How soon we need to visit'
                    }
                },
                required: ['urgency']
            },
            handler: async (args) => {
                console.log('[TenantWorker] Requesting availability:', args.urgency);
                return {
                    requested: true,
                    urgency: args.urgency
                };
            }
        },
        {
            name: 'mark_resolved_diy',
            description: 'Mark issue as resolved by tenant DIY',
            parameters: {
                type: 'object',
                properties: {
                    resolution: {
                        type: 'string',
                        description: 'What fixed the issue'
                    }
                },
                required: ['resolution']
            },
            handler: async (args) => {
                console.log('[TenantWorker] Issue resolved DIY:', args.resolution);
                return {
                    status: 'resolved_diy',
                    resolution: args.resolution
                };
            }
        },
        {
            name: 'ready_for_triage',
            description: 'Issue details gathered, ready for triage worker to categorize and price',
            parameters: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'Summary of the issue'
                    },
                    hasPhotos: {
                        type: 'boolean',
                        description: 'Whether photos were provided'
                    },
                    hasAvailability: {
                        type: 'boolean',
                        description: 'Whether availability was provided'
                    }
                },
                required: ['summary']
            },
            handler: async (args) => {
                console.log('[TenantWorker] Ready for triage:', args.summary);
                return {
                    handoff: 'TRIAGE_WORKER',
                    reason: 'Details gathered, need pricing and categorization'
                };
            }
        }
    ];
}

/**
 * Get DIY advice for common issues
 */
function getDIYAdvice(issueType: string, description: string): {
    canDIY: boolean;
    steps: string[];
    warning?: string;
    toolsNeeded?: string[];
} {
    const descLower = description.toLowerCase();
    const typeLower = issueType.toLowerCase();

    // NEVER DIY these
    const unsafePatterns = [
        /gas/i, /electric/i, /spark/i, /smoke/i, /fire/i, /flood/i,
        /burst/i, /structural/i, /ceiling.*(collapse|fall)/i, /unsafe/i
    ];

    for (const pattern of unsafePatterns) {
        if (pattern.test(descLower)) {
            return {
                canDIY: false,
                steps: [],
                warning: 'This requires a professional. Do not attempt to fix this yourself.'
            };
        }
    }

    // DIY advice database
    if (typeLower.includes('tap') || typeLower.includes('drip') || descLower.includes('dripping')) {
        return {
            canDIY: true,
            steps: [
                'First, turn off the water supply under the sink',
                'Wait a minute, then turn it back on',
                'If still dripping, the washer inside may need replacing',
                'For a quick temporary fix, try tightening the tap handle'
            ],
            toolsNeeded: ['Adjustable wrench (optional)']
        };
    }

    if (typeLower.includes('drain') || typeLower.includes('block') || descLower.includes('slow drain')) {
        return {
            canDIY: true,
            steps: [
                'Try pouring boiling water down the drain',
                'If that doesn\'t work, use a plunger over the drain',
                'Create a seal and pump up and down firmly',
                'You can also try a mixture of baking soda and vinegar'
            ],
            toolsNeeded: ['Plunger', 'Boiling water'],
            warning: 'Never use chemical drain cleaners with other products'
        };
    }

    if (typeLower.includes('toilet') && descLower.includes('running')) {
        return {
            canDIY: true,
            steps: [
                'Lift the cistern lid and check the float',
                'The float should rise with water level and stop the fill',
                'Try gently lifting the float arm - if water stops, adjust the float lower',
                'Check the flapper valve at the bottom isn\'t stuck open'
            ],
            toolsNeeded: []
        };
    }

    if (typeLower.includes('door') && (descLower.includes('squeak') || descLower.includes('creak'))) {
        return {
            canDIY: true,
            steps: [
                'Spray WD-40 or any household oil on the hinges',
                'Open and close the door several times to work it in',
                'Wipe off any excess oil'
            ],
            toolsNeeded: ['WD-40 or cooking oil']
        };
    }

    if (typeLower.includes('radiator') && descLower.includes('cold')) {
        return {
            canDIY: true,
            steps: [
                'The radiator may need bleeding (releasing trapped air)',
                'Turn off your heating first',
                'Use a radiator key to open the bleed valve at the top',
                'Hold a cloth underneath to catch drips',
                'When water comes out steadily, close the valve'
            ],
            toolsNeeded: ['Radiator key (or flat screwdriver for some models)', 'Cloth'],
            warning: 'If multiple radiators are cold, the boiler may need checking'
        };
    }

    if (typeLower.includes('bulb') || descLower.includes('light')) {
        return {
            canDIY: true,
            steps: [
                'Make sure the light switch is OFF',
                'Wait for the bulb to cool if it was recently on',
                'Unscrew the old bulb and check the wattage',
                'Screw in a new bulb of the same type and wattage'
            ],
            toolsNeeded: ['Replacement bulb'],
            warning: 'If the new bulb doesn\'t work, it may be a wiring issue - call us'
        };
    }

    // Default - suggest professional
    return {
        canDIY: false,
        steps: [],
        warning: 'This looks like it needs a professional to assess properly.'
    };
}
