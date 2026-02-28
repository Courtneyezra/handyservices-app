/**
 * Dripping Tap Flow
 *
 * Troubleshooting flow for dripping or leaking taps.
 * Guides tenants through identifying the location and attempting simple fixes.
 */

import { TroubleshootingFlow, FlowStep } from '../flow-schema';

/**
 * Step definitions for the dripping tap flow
 */
const steps: FlowStep[] = [
    // Step 1: Identify which tap
    {
        id: 'identify_location',
        type: 'question',
        template: "Let's sort out that dripping tap. First, where is the tap located?\n\nIs it in the kitchen, bathroom, or somewhere else?",
        expectedResponses: [
            {
                id: 'kitchen',
                patterns: ['^kitchen', 'kitchen (sink|tap)'],
                semanticMatch: 'Kitchen tap',
                examples: ['Kitchen', 'Kitchen sink', 'The kitchen tap']
            },
            {
                id: 'bathroom_sink',
                patterns: ['bathroom', 'basin', 'wash basin', 'bathroom sink'],
                semanticMatch: 'Bathroom basin/sink tap',
                examples: ['Bathroom', 'Bathroom sink', 'The basin']
            },
            {
                id: 'bath',
                patterns: ['^bath$', 'bathtub', 'bath tap'],
                semanticMatch: 'Bath tap',
                examples: ['Bath', 'Bathtub', 'The bath tap']
            },
            {
                id: 'shower',
                patterns: ['shower'],
                semanticMatch: 'Shower tap/mixer',
                examples: ['Shower', 'Shower mixer', 'In the shower']
            },
            {
                id: 'outside',
                patterns: ['outside', 'garden', 'outdoor', 'external'],
                semanticMatch: 'Outside/garden tap',
                examples: ['Outside', 'Garden tap', 'External tap']
            },
            {
                id: 'utility',
                patterns: ['utility', 'laundry', 'garage'],
                semanticMatch: 'Utility room tap',
                examples: ['Utility room', 'Laundry room', 'Garage']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'kitchen' },
                action: { type: 'goto_step', stepId: 'check_severity' }
            },
            {
                condition: { type: 'response_matches', responseId: 'bathroom_sink' },
                action: { type: 'goto_step', stepId: 'check_severity' }
            },
            {
                condition: { type: 'response_matches', responseId: 'bath' },
                action: { type: 'goto_step', stepId: 'check_severity' }
            },
            {
                condition: { type: 'response_matches', responseId: 'shower' },
                action: { type: 'goto_step', stepId: 'check_shower_type' }
            },
            {
                condition: { type: 'response_matches', responseId: 'outside' },
                action: { type: 'goto_step', stepId: 'check_outside_tap' }
            },
            {
                condition: { type: 'response_matches', responseId: 'utility' },
                action: { type: 'goto_step', stepId: 'check_severity' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "Which room is the dripping tap in? For example: kitchen, bathroom, bath, or shower?" }
        }
    },

    // Step: Check shower type
    {
        id: 'check_shower_type',
        type: 'question',
        template: "Is this a shower with separate hot and cold taps, or is it a mixer/thermostatic valve?",
        expectedResponses: [
            {
                id: 'separate_taps',
                patterns: ['separate', 'two taps', 'hot and cold', 'individual'],
                semanticMatch: 'Separate hot and cold taps',
                examples: ['Separate taps', 'Has two taps', 'Hot and cold separately']
            },
            {
                id: 'mixer',
                patterns: ['mixer', 'one tap', 'single', 'thermostatic', 'valve'],
                semanticMatch: 'Mixer or thermostatic valve',
                examples: ['Mixer', "It's one tap", 'Thermostatic', 'Single valve']
            },
            {
                id: 'electric',
                patterns: ['electric', 'power shower', 'mira', 'triton'],
                semanticMatch: 'Electric shower',
                examples: ['Electric shower', 'Power shower', "It's a Mira"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'separate_taps' },
                action: { type: 'goto_step', stepId: 'check_severity' }
            },
            {
                condition: { type: 'response_matches', responseId: 'mixer' },
                action: {
                    type: 'escalate',
                    reason: 'Mixer/thermostatic shower valve dripping - requires cartridge replacement',
                    collectData: ['Shower make/model if visible', 'Is it dripping from the head or valve body?']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'electric' },
                action: {
                    type: 'escalate',
                    reason: 'Electric shower dripping - specialist repair needed for safety',
                    collectData: ['Shower make/model', 'Where is water dripping from?']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'check_severity' }
        }
    },

    // Step: Check outside tap
    {
        id: 'check_outside_tap',
        type: 'question',
        template: "Outside taps can freeze and crack in cold weather. Is the tap:\n\n1. Just dripping from the spout when closed\n2. Leaking from around the tap body/handle\n3. Frozen or stuck",
        expectedResponses: [
            {
                id: 'dripping_spout',
                patterns: ['spout', 'dripping.*closed', 'from.*end', '^1$', 'just dripping'],
                semanticMatch: 'Dripping from spout when closed',
                examples: ['From the spout', 'Just dripping when off', '1']
            },
            {
                id: 'leaking_body',
                patterns: ['body', 'handle', 'around', 'base', 'leak.*wall', '^2$'],
                semanticMatch: 'Leaking from tap body or around handle',
                examples: ['Around the handle', 'From the body', 'Near the wall', '2']
            },
            {
                id: 'frozen',
                patterns: ['frozen', 'stuck', 'won\'t turn', 'ice', '^3$'],
                semanticMatch: 'Tap is frozen or stuck',
                examples: ['Frozen', "Won't turn", 'Stuck', '3']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'dripping_spout' },
                action: { type: 'goto_step', stepId: 'check_severity' }
            },
            {
                condition: { type: 'response_matches', responseId: 'leaking_body' },
                action: {
                    type: 'escalate',
                    reason: 'Outside tap leaking from body - may need replacement',
                    collectData: ['Is there an isolation valve to turn it off?', 'How severe is the leak?']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'frozen' },
                action: { type: 'goto_step', stepId: 'frozen_tap_advice' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'check_severity' }
        }
    },

    // Step: Frozen tap advice
    {
        id: 'frozen_tap_advice',
        type: 'instruction',
        template: "**Do not force a frozen tap - it could crack!**\n\nInstead:\n1. Apply gentle heat with warm (not boiling) water wrapped in a cloth\n2. Or use a hairdryer on low setting\n3. Never use a blowtorch or naked flame\n\nIf the pipe behind it looks damaged or bulging, please let me know immediately.\n\nDoes the pipe look normal or is there visible damage?",
        expectedResponses: [
            {
                id: 'looks_ok',
                patterns: ['ok', 'normal', 'fine', 'looks.*good', 'no damage'],
                semanticMatch: 'Pipe looks normal',
                examples: ['Looks ok', 'No damage', 'Seems fine']
            },
            {
                id: 'damaged',
                patterns: ['damage', 'bulge', 'crack', 'split', 'burst', 'leak'],
                semanticMatch: 'Visible damage to pipe',
                examples: ['There is a crack', "It's bulging", 'I can see damage']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'looks_ok' },
                action: {
                    type: 'resolve',
                    resolution: 'Let the tap thaw slowly with gentle heat. Once thawed, check if it works normally. If it still drips, let us know and we can arrange a repair.'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'damaged' },
                action: {
                    type: 'escalate',
                    reason: 'URGENT: Frozen pipe with visible damage - potential burst pipe',
                    collectData: ['Location of isolation valve', 'Water currently leaking?']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Frozen outside tap needs inspection',
                collectData: ['Photo of tap and pipe']
            }
        }
    },

    // Step 2: Check severity
    {
        id: 'check_severity',
        type: 'question',
        template: "How bad is the drip? Is it:\n\n1. A slow drip (a few drops per minute)\n2. A steady drip (drip every few seconds)\n3. A fast drip or running water",
        expectedResponses: [
            {
                id: 'slow',
                patterns: ['slow', 'few drops', 'occasional', 'not.*bad', '^1$', 'once.*while'],
                semanticMatch: 'Slow, occasional drip',
                examples: ['Slow', 'Just a few drops', 'Not too bad', '1', 'Every now and then']
            },
            {
                id: 'steady',
                patterns: ['steady', 'every.*second', 'constant', 'regular', '^2$'],
                semanticMatch: 'Steady, constant dripping',
                examples: ['Steady drip', 'Every few seconds', 'Constant', '2']
            },
            {
                id: 'fast',
                patterns: ['fast', 'running', 'stream', 'lot', 'bad', '^3$', 'pouring'],
                semanticMatch: 'Fast drip or running water',
                examples: ['Running water', 'Really bad', 'Fast', '3', 'Pouring']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'slow' },
                action: { type: 'goto_step', stepId: 'try_tightening' }
            },
            {
                condition: { type: 'response_matches', responseId: 'steady' },
                action: { type: 'goto_step', stepId: 'try_tightening' }
            },
            {
                condition: { type: 'response_matches', responseId: 'fast' },
                action: { type: 'goto_step', stepId: 'isolate_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "How often is it dripping? Just occasionally (1), steadily every few seconds (2), or running fast (3)?" }
        }
    },

    // Step: Isolate water for fast leak
    {
        id: 'isolate_water',
        type: 'instruction',
        template: "That sounds like more than a drip - we should try to reduce the flow if possible.\n\nCheck under the sink for isolation valves (small handles or screwdriver slots on the pipes). Try turning them clockwise to reduce the flow.\n\nDid that help slow or stop the flow?",
        expectedResponses: [
            {
                id: 'found_stopped',
                patterns: ['stopped', 'found', 'worked', 'slowed', 'better'],
                semanticMatch: 'Found valve and reduced flow',
                examples: ['Yes found it', 'Stopped now', 'Much better', 'Slowed down']
            },
            {
                id: 'no_valve',
                patterns: ['no valve', 'can\'t find', 'nothing there', 'no', 'didn\'t work'],
                semanticMatch: 'Cannot find valve or did not help',
                examples: ['No valve', "Can't find one", "Didn't work", "There's nothing"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'found_stopped' },
                action: { type: 'goto_step', stepId: 'try_tightening' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_valve' },
                action: {
                    type: 'escalate',
                    reason: 'Fast-running tap - needs urgent repair',
                    collectData: ['Is there a stopcock to turn off water?', 'Can you place a container to catch water?']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Fast-dripping tap needs professional attention',
                collectData: ['Location of the tap', 'Type of tap (mixer or separate)']
            }
        }
    },

    // Step 3: Try tightening
    {
        id: 'try_tightening',
        type: 'instruction',
        template: "Sometimes taps drip because they're not fully closed. Try:\n\n1. Turn the tap firmly to the fully closed position\n2. For lever taps, push the lever firmly down or up\n3. For mixer taps, make sure both handles are fully off\n\n**Don't force it** - if it won't turn any further, that's fine.\n\nDid that stop the drip?",
        expectedResponses: [
            {
                id: 'fixed',
                patterns: ['stopped', 'fixed', 'worked', 'no.*drip', 'yes'],
                semanticMatch: 'Drip has stopped',
                examples: ['Yes', 'Stopped!', 'Fixed', 'That worked', 'No more drip']
            },
            {
                id: 'still_dripping',
                patterns: ['still drip', 'no', 'didn\'t work', 'same', 'not.*stopped'],
                semanticMatch: 'Still dripping',
                examples: ['Still dripping', 'No', "Didn't work", 'Same as before']
            },
            {
                id: 'stuck',
                patterns: ['stuck', 'stiff', 'won\'t turn', 'hard to turn'],
                semanticMatch: 'Tap is stuck or stiff',
                examples: ['Very stiff', "Won't turn", "It's stuck"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'fixed' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_dripping' },
                action: { type: 'goto_step', stepId: 'check_tap_type' }
            },
            {
                condition: { type: 'response_matches', responseId: 'stuck' },
                action: { type: 'goto_step', stepId: 'stiff_tap_advice' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "Did turning the tap more firmly stop the dripping?" }
        }
    },

    // Step: Stiff tap advice
    {
        id: 'stiff_tap_advice',
        type: 'instruction',
        template: "A stiff tap often means it needs servicing. **Don't force it** as you could damage the valve.\n\nYou can try applying a tiny bit of WD-40 or similar lubricant around the spindle (where the handle meets the body), then gently working the tap back and forth.\n\nDid that help loosen it?",
        expectedResponses: [
            {
                id: 'loosened',
                patterns: ['loosened', 'better', 'easier', 'worked', 'yes'],
                semanticMatch: 'Tap moves easier now',
                examples: ['Better now', 'Yes loosened', 'Easier to turn']
            },
            {
                id: 'still_stiff',
                patterns: ['still stiff', 'no', 'same', 'didn\'t help'],
                semanticMatch: 'Still stiff',
                examples: ['Still stiff', 'No change', "Didn't help"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'loosened' },
                action: { type: 'goto_step', stepId: 'try_tightening' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_stiff' },
                action: {
                    type: 'escalate',
                    reason: 'Tap is very stiff - may need new washer or cartridge',
                    collectData: ['How old is the tap?', 'Type of tap (twist, lever, mixer)?']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Stiff tap needs professional attention',
                collectData: ['Type of tap']
            }
        }
    },

    // Step: Check tap type
    {
        id: 'check_tap_type',
        type: 'question',
        template: "The tap probably needs a new washer or cartridge. To understand what's needed, what type of tap is it?\n\n1. Traditional twist tap (turn the handle/cross top)\n2. Lever tap (flip up/down or side to side)\n3. Mixer tap (one spout, two controls)",
        expectedResponses: [
            {
                id: 'twist',
                patterns: ['twist', 'turn', 'traditional', 'cross', 'round', '^1$'],
                semanticMatch: 'Traditional twist tap',
                examples: ['Twist', 'Traditional', 'You turn it', '1', 'Cross handle']
            },
            {
                id: 'lever',
                patterns: ['lever', 'flip', 'push', '^2$'],
                semanticMatch: 'Lever tap',
                examples: ['Lever', 'Flip up/down', '2']
            },
            {
                id: 'mixer',
                patterns: ['mixer', 'one spout', 'single', '^3$'],
                semanticMatch: 'Mixer tap',
                examples: ['Mixer', 'Single spout', '3', 'One tap']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'twist' },
                action: {
                    type: 'escalate',
                    reason: 'Traditional tap dripping - likely needs new washer',
                    collectData: ['Is it hot, cold, or both taps?', 'Photo of the tap']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'lever' },
                action: {
                    type: 'escalate',
                    reason: 'Lever tap dripping - likely needs new ceramic cartridge',
                    collectData: ['Is it hot, cold, or both?', 'Tap make/brand if visible']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'mixer' },
                action: {
                    type: 'escalate',
                    reason: 'Mixer tap dripping - may need cartridge or O-rings',
                    collectData: ['Is it dripping from spout or around base?', 'Tap make/brand if visible']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Dripping tap needs repair',
                collectData: ['Photo of the tap', 'Hot, cold, or both?']
            }
        }
    },

    // Step 4: Confirm fixed
    {
        id: 'confirm_fixed',
        type: 'confirmation',
        template: "Excellent! Watch it for a minute to make sure it stays dry. Is it still not dripping?",
        confirmationRequired: true,
        expectedResponses: [
            {
                id: 'confirmed_fixed',
                patterns: ['yes', 'still.*dry', 'fixed', 'good', 'stopped'],
                semanticMatch: 'Confirmed fixed',
                examples: ['Yes', 'Still dry', 'All good', 'Confirmed']
            },
            {
                id: 'started_again',
                patterns: ['started', 'dripping again', 'no', 'back'],
                semanticMatch: 'Started dripping again',
                examples: ['Started again', 'Dripping again', 'No', "It's back"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'confirmed_fixed' },
                action: {
                    type: 'resolve',
                    resolution: 'The tap was just not fully closed. If it starts dripping again in future, it may need a new washer - just let us know!'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'started_again' },
                action: { type: 'goto_step', stepId: 'check_tap_type' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'resolve',
                resolution: 'Hopefully the tap is fixed now. If it starts dripping again, it probably needs a new washer - just let us know!'
            }
        }
    }
];

/**
 * Complete flow definition for dripping tap issues
 */
export const DRIPPING_TAP_FLOW: TroubleshootingFlow = {
    id: 'dripping_tap',
    name: 'Dripping Tap',
    description: 'Troubleshoot a dripping or leaking tap in the property.',
    category: 'plumbing',
    triggerKeywords: [
        'dripping tap',
        'leaking tap',
        'tap drips',
        'faucet dripping',
        'tap leaking',
        'water dripping',
        'tap won\'t stop',
        'running tap'
    ],
    safeForDIY: true,
    safetyWarning: undefined, // No major safety concerns for basic tap issues
    maxAttempts: 3,
    estimatedTimeMinutes: 5,
    steps,
    escalationDataNeeded: [
        'Location of the tap (kitchen/bathroom/etc)',
        'Type of tap (twist/lever/mixer)',
        'Is it hot, cold, or both',
        'Make/brand if visible',
        'Photo of the tap'
    ]
};
