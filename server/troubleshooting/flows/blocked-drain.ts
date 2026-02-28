/**
 * Blocked Drain Flow
 *
 * Troubleshooting flow for blocked drains in sinks, showers, baths, and toilets.
 * Guides tenants through safe DIY unblocking methods.
 */

import { TroubleshootingFlow, FlowStep } from '../flow-schema';

/**
 * Step definitions for the blocked drain flow
 */
const steps: FlowStep[] = [
    // Step 1: Identify location
    {
        id: 'identify_location',
        type: 'question',
        template: "Let's get that drain unblocked. First, which drain is blocked?\n\n1. Kitchen sink\n2. Bathroom sink\n3. Shower or bath\n4. Toilet\n5. Outside drain",
        expectedResponses: [
            {
                id: 'kitchen_sink',
                patterns: ['kitchen', '^1$', 'kitchen sink'],
                semanticMatch: 'Kitchen sink drain',
                examples: ['Kitchen', '1', 'Kitchen sink', 'The kitchen one']
            },
            {
                id: 'bathroom_sink',
                patterns: ['bathroom sink', 'basin', 'hand basin', '^2$'],
                semanticMatch: 'Bathroom sink/basin',
                examples: ['Bathroom sink', '2', 'Basin', 'Hand basin']
            },
            {
                id: 'shower_bath',
                patterns: ['shower', 'bath', '^3$', 'tub'],
                semanticMatch: 'Shower or bath drain',
                examples: ['Shower', 'Bath', '3', 'The bathtub']
            },
            {
                id: 'toilet',
                patterns: ['toilet', 'loo', 'wc', '^4$'],
                semanticMatch: 'Toilet',
                examples: ['Toilet', '4', 'The loo', 'WC']
            },
            {
                id: 'outside',
                patterns: ['outside', 'external', 'garden', 'yard', '^5$', 'gully'],
                semanticMatch: 'Outside/external drain',
                examples: ['Outside', '5', 'External drain', 'Garden drain']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'kitchen_sink' },
                action: { type: 'goto_step', stepId: 'kitchen_check_trap' }
            },
            {
                condition: { type: 'response_matches', responseId: 'bathroom_sink' },
                action: { type: 'goto_step', stepId: 'bathroom_sink_check' }
            },
            {
                condition: { type: 'response_matches', responseId: 'shower_bath' },
                action: { type: 'goto_step', stepId: 'shower_check_debris' }
            },
            {
                condition: { type: 'response_matches', responseId: 'toilet' },
                action: { type: 'goto_step', stepId: 'toilet_severity' }
            },
            {
                condition: { type: 'response_matches', responseId: 'outside' },
                action: { type: 'goto_step', stepId: 'outside_drain_check' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "Which drain is blocked? Kitchen sink (1), Bathroom sink (2), Shower/Bath (3), Toilet (4), or Outside drain (5)?" }
        }
    },

    // ===== KITCHEN SINK PATH =====
    {
        id: 'kitchen_check_trap',
        type: 'instruction',
        template: "Kitchen sinks often block due to food debris or grease. Before we try unblocking, let's check the trap.\n\nLook under the sink - do you see a U-shaped or bottle-shaped pipe? This is the trap that often holds the blockage.\n\nDo you see it?",
        expectedResponses: [
            {
                id: 'see_trap',
                patterns: ['yes', 'see it', 'found it', 'u shape', 'bottle'],
                semanticMatch: 'Can see the trap',
                examples: ['Yes', 'I see it', 'Found it', 'Yes there is a U-shape']
            },
            {
                id: 'no_trap',
                patterns: ['no', 'can\'t see', 'not sure', 'hidden'],
                semanticMatch: 'Cannot see trap',
                examples: ['No', "Can't see it", 'Hidden behind cabinet']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'see_trap' },
                action: { type: 'goto_step', stepId: 'kitchen_try_plunger' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_trap' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'try_boiling_water' }
        }
    },

    {
        id: 'kitchen_try_plunger',
        type: 'instruction',
        template: "Let's try to clear it with a plunger first.\n\n**Important for double sinks**: Block the other drain with a wet cloth.\n\n1. Fill the sink with a few inches of water\n2. Place the plunger over the drain hole\n3. Push down and pull up vigorously 10-15 times\n4. Check if water drains\n\nDo you have a plunger, or should I suggest an alternative?",
        expectedResponses: [
            {
                id: 'have_plunger',
                patterns: ['have.*plunger', 'yes', 'got one', 'will try'],
                semanticMatch: 'Has a plunger',
                examples: ['I have one', 'Yes', 'Got a plunger', "I'll try"]
            },
            {
                id: 'no_plunger',
                patterns: ['no plunger', 'don\'t have', 'no', 'alternative'],
                semanticMatch: 'Does not have a plunger',
                examples: ["Don't have one", 'No plunger', 'Need alternative']
            },
            {
                id: 'tried_worked',
                patterns: ['worked', 'draining', 'cleared', 'fixed'],
                semanticMatch: 'Plunging worked',
                examples: ['That worked!', "It's draining now", 'Cleared!']
            },
            {
                id: 'tried_failed',
                patterns: ['didn\'t work', 'still blocked', 'no luck', 'same'],
                semanticMatch: 'Plunging did not work',
                examples: ["Didn't work", 'Still blocked', 'No change']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'have_plunger' },
                action: { type: 'goto_step', stepId: 'wait_for_plunger_result' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_plunger' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            },
            {
                condition: { type: 'response_matches', responseId: 'tried_worked' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'tried_failed' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'wait_for_plunger_result' }
        }
    },

    {
        id: 'wait_for_plunger_result',
        type: 'question',
        template: "Give the plunging a good try. Did it clear the blockage?",
        expectedResponses: [
            {
                id: 'worked',
                patterns: ['yes', 'worked', 'cleared', 'draining', 'fixed'],
                semanticMatch: 'Blockage cleared',
                examples: ['Yes!', 'Worked', 'Cleared', "It's draining now"]
            },
            {
                id: 'not_worked',
                patterns: ['no', 'still', 'didn\'t', 'blocked'],
                semanticMatch: 'Still blocked',
                examples: ['No', 'Still blocked', "Didn't work"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'worked' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'not_worked' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'try_boiling_water' }
        }
    },

    // ===== BOILING WATER (SHARED) =====
    {
        id: 'try_boiling_water',
        type: 'instruction',
        template: "Let's try boiling water - this works well for grease blockages.\n\n1. Boil a full kettle\n2. Pour the boiling water directly down the drain in 2-3 stages\n3. Wait 5-10 seconds between each pour\n4. Check if water drains better\n\n**Safety**: Be careful with boiling water!\n\nDid that help clear the blockage?",
        expectedResponses: [
            {
                id: 'worked',
                patterns: ['yes', 'worked', 'draining', 'better', 'cleared'],
                semanticMatch: 'Boiling water worked',
                examples: ['Yes!', 'That worked', 'Draining better now']
            },
            {
                id: 'partial',
                patterns: ['a bit', 'little', 'slightly', 'some'],
                semanticMatch: 'Partial improvement',
                examples: ['A bit better', 'Slightly improved', 'Helped a little']
            },
            {
                id: 'not_worked',
                patterns: ['no', 'still', 'didn\'t', 'same', 'blocked'],
                semanticMatch: 'Did not help',
                examples: ['No', 'Still blocked', 'Same as before']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'worked' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'partial' },
                action: { type: 'goto_step', stepId: 'try_baking_soda' }
            },
            {
                condition: { type: 'response_matches', responseId: 'not_worked' },
                action: { type: 'goto_step', stepId: 'try_baking_soda' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'try_baking_soda' }
        }
    },

    {
        id: 'try_baking_soda',
        type: 'instruction',
        template: "Let's try a natural drain cleaner. Do you have baking soda and white vinegar?\n\nIf yes:\n1. Pour 1/2 cup baking soda down the drain\n2. Follow with 1/2 cup white vinegar\n3. Cover the drain and wait 15-30 minutes\n4. Flush with more boiling water\n\nOr if you have drain unblocker, try that instead.\n\nLet me know what you have and I'll guide you.",
        expectedResponses: [
            {
                id: 'have_both',
                patterns: ['have both', 'yes', 'have them', 'got both', 'baking soda.*vinegar'],
                semanticMatch: 'Has baking soda and vinegar',
                examples: ['Have both', 'Yes I have them', 'Got baking soda and vinegar']
            },
            {
                id: 'have_unblocker',
                patterns: ['unblocker', 'drain cleaner', 'drano', 'mr muscle'],
                semanticMatch: 'Has commercial drain unblocker',
                examples: ['Got drain unblocker', 'Have Mr Muscle', 'Got some Drano']
            },
            {
                id: 'have_nothing',
                patterns: ['nothing', 'don\'t have', 'no', 'neither'],
                semanticMatch: 'Does not have either',
                examples: ["Don't have any", 'No', 'Neither']
            },
            {
                id: 'tried_worked',
                patterns: ['worked', 'cleared', 'draining', 'fixed'],
                semanticMatch: 'It worked',
                examples: ['That worked!', 'Cleared now', "It's draining"]
            },
            {
                id: 'tried_failed',
                patterns: ['didn\'t work', 'still blocked', 'no luck'],
                semanticMatch: 'Did not work',
                examples: ["Didn't work", 'Still blocked']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'have_both' },
                action: { type: 'goto_step', stepId: 'wait_baking_soda' }
            },
            {
                condition: { type: 'response_matches', responseId: 'have_unblocker' },
                action: { type: 'goto_step', stepId: 'use_unblocker' }
            },
            {
                condition: { type: 'response_matches', responseId: 'have_nothing' },
                action: { type: 'goto_step', stepId: 'escalate_professional' }
            },
            {
                condition: { type: 'response_matches', responseId: 'tried_worked' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'tried_failed' },
                action: { type: 'goto_step', stepId: 'escalate_professional' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'escalate_professional' }
        }
    },

    {
        id: 'wait_baking_soda',
        type: 'question',
        template: "Great! Try the baking soda and vinegar method I described. Wait 15-30 minutes, then flush with boiling water.\n\nLet me know how it went - did it clear the blockage?",
        expectedResponses: [
            {
                id: 'worked',
                patterns: ['worked', 'cleared', 'draining', 'yes', 'fixed'],
                semanticMatch: 'Blockage cleared',
                examples: ['Worked!', 'Cleared', 'Yes draining now']
            },
            {
                id: 'not_worked',
                patterns: ['no', 'still', 'blocked', 'didn\'t'],
                semanticMatch: 'Still blocked',
                examples: ['Still blocked', 'No', "Didn't work"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'worked' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'not_worked' },
                action: { type: 'goto_step', stepId: 'escalate_professional' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'escalate_professional' }
        }
    },

    {
        id: 'use_unblocker',
        type: 'instruction',
        template: "Commercial drain unblocker should help. Follow the instructions on the bottle - usually:\n\n1. Pour recommended amount down drain\n2. Wait the specified time (often 15-30 mins)\n3. Flush with hot water\n\n**Warning**: Don't mix different drain cleaners - this can cause dangerous fumes!\n\nTry that and let me know if it worked.",
        expectedResponses: [
            {
                id: 'worked',
                patterns: ['worked', 'cleared', 'draining', 'yes', 'fixed'],
                semanticMatch: 'Unblocker worked',
                examples: ['That worked!', 'Cleared now', 'Draining']
            },
            {
                id: 'not_worked',
                patterns: ['no', 'still', 'blocked', 'didn\'t'],
                semanticMatch: 'Still blocked',
                examples: ['Still blocked', "Didn't work"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'worked' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'not_worked' },
                action: { type: 'goto_step', stepId: 'escalate_professional' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'escalate_professional' }
        }
    },

    // ===== BATHROOM SINK PATH =====
    {
        id: 'bathroom_sink_check',
        type: 'instruction',
        template: "Bathroom sinks often block due to hair and soap buildup around the plug.\n\nFirst, check if there's a pop-up plug that can be removed. If you can see hair or debris near the drain opening, try to remove it with tweezers or needle-nose pliers.\n\nWere you able to remove any debris?",
        expectedResponses: [
            {
                id: 'removed_debris',
                patterns: ['removed', 'pulled out', 'got it', 'yes', 'lots'],
                semanticMatch: 'Removed debris',
                examples: ['Removed lots of hair', 'Pulled it out', 'Yes got some gunk']
            },
            {
                id: 'no_debris',
                patterns: ['nothing', 'no', 'can\'t see', 'clean'],
                semanticMatch: 'No visible debris',
                examples: ['Nothing there', "Can't see anything", 'Looks clean']
            },
            {
                id: 'draining_now',
                patterns: ['draining', 'fixed', 'working', 'cleared'],
                semanticMatch: 'Now draining',
                examples: ["It's draining now!", 'Fixed!', 'That cleared it']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'draining_now' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'removed_debris' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_debris' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'try_boiling_water' }
        }
    },

    // ===== SHOWER/BATH PATH =====
    {
        id: 'shower_check_debris',
        type: 'instruction',
        template: "Shower and bath drains almost always block due to hair buildup.\n\n1. Remove the drain cover (it usually lifts off or unscrews)\n2. Look for hair wrapped around the cross bars or caught below\n3. Use a bent coat hanger, zip-it tool, or needle-nose pliers to pull out hair\n\n**Tip**: You'll probably pull out a lot - this is normal!\n\nWere you able to remove any hair?",
        expectedResponses: [
            {
                id: 'removed_hair',
                patterns: ['removed', 'pulled', 'lot', 'gross', 'yes', 'disgusting'],
                semanticMatch: 'Removed hair',
                examples: ['Pulled out loads', 'Yes removed lots', 'Gross but got it']
            },
            {
                id: 'cant_access',
                patterns: ['can\'t.*off', 'stuck', 'won\'t budge', 'no cover'],
                semanticMatch: 'Cannot access drain',
                examples: ["Can't get cover off", "It's stuck", 'No removable cover']
            },
            {
                id: 'draining_now',
                patterns: ['draining', 'fixed', 'cleared', 'working'],
                semanticMatch: 'Now draining',
                examples: ['Draining now!', 'That fixed it', 'Cleared']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'draining_now' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'removed_hair' },
                action: { type: 'goto_step', stepId: 'shower_test_drain' }
            },
            {
                condition: { type: 'response_matches', responseId: 'cant_access' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'shower_test_drain' }
        }
    },

    {
        id: 'shower_test_drain',
        type: 'question',
        template: "Good work! Run some water and see if it drains better now.\n\nIs the water draining properly?",
        expectedResponses: [
            {
                id: 'draining_well',
                patterns: ['yes', 'draining', 'better', 'fixed', 'good'],
                semanticMatch: 'Draining well now',
                examples: ['Yes!', 'Much better', 'Draining fine now']
            },
            {
                id: 'still_slow',
                patterns: ['slow', 'still', 'bit', 'not quite'],
                semanticMatch: 'Still draining slowly',
                examples: ['Still slow', 'A bit better but not great']
            },
            {
                id: 'not_draining',
                patterns: ['no', 'blocked', 'nothing', 'same'],
                semanticMatch: 'Not draining',
                examples: ['Still blocked', 'No change', 'Not draining']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'draining_well' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_slow' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            },
            {
                condition: { type: 'response_matches', responseId: 'not_draining' },
                action: { type: 'goto_step', stepId: 'try_boiling_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'try_boiling_water' }
        }
    },

    // ===== TOILET PATH =====
    {
        id: 'toilet_severity',
        type: 'question',
        template: "Blocked toilets need careful handling. Is the water level:\n\n1. High/near the rim (might overflow)\n2. Normal level but won't flush away\n3. Very low or empty",
        expectedResponses: [
            {
                id: 'high_level',
                patterns: ['high', 'rim', 'overflow', 'full', '^1$', 'rising'],
                semanticMatch: 'Water level high',
                examples: ['High', 'Near the rim', 'Might overflow', '1']
            },
            {
                id: 'normal_level',
                patterns: ['normal', 'won\'t flush', 'stuck', '^2$'],
                semanticMatch: 'Normal level but blocked',
                examples: ['Normal level', "Won't flush", '2']
            },
            {
                id: 'low_level',
                patterns: ['low', 'empty', 'no water', '^3$'],
                semanticMatch: 'Low or empty',
                examples: ['Very low', 'Empty', '3']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'high_level' },
                action: { type: 'goto_step', stepId: 'toilet_high_warning' }
            },
            {
                condition: { type: 'response_matches', responseId: 'normal_level' },
                action: { type: 'goto_step', stepId: 'toilet_try_plunger' }
            },
            {
                condition: { type: 'response_matches', responseId: 'low_level' },
                action: { type: 'goto_step', stepId: 'toilet_low_check' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'toilet_try_plunger' }
        }
    },

    {
        id: 'toilet_high_warning',
        type: 'instruction',
        template: "**Don't flush again** - it could overflow!\n\nFirst, let's stop more water entering:\n1. Remove the cistern lid (top of the toilet)\n2. If you see a float/ball, hold it up to stop water\n3. Or turn off the isolation valve behind the toilet (turn clockwise)\n\nOnce you've done that, wait 10 minutes for the water level to drop naturally.\n\nHas the water level dropped at all?",
        expectedResponses: [
            {
                id: 'level_dropped',
                patterns: ['dropped', 'lower', 'going down', 'yes', 'better'],
                semanticMatch: 'Water level has dropped',
                examples: ['Yes dropping', 'Level is lower', 'Going down slowly']
            },
            {
                id: 'still_high',
                patterns: ['still high', 'no', 'same', 'not moving'],
                semanticMatch: 'Level still high',
                examples: ['Still high', 'No change', "Not moving"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'level_dropped' },
                action: { type: 'goto_step', stepId: 'toilet_try_plunger' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_high' },
                action: {
                    type: 'escalate',
                    reason: 'Toilet blocked with high water level - risk of overflow',
                    collectData: ['Is there another toilet in property?', 'Has the isolation valve been turned off?']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'toilet_try_plunger' }
        }
    },

    {
        id: 'toilet_low_check',
        type: 'question',
        template: "A very low water level could mean:\n- A severe blockage further down\n- A problem with the main drain\n\nAre any other drains in the property running slowly or backing up?",
        expectedResponses: [
            {
                id: 'other_drains_slow',
                patterns: ['yes', 'other', 'also', 'all', 'everywhere'],
                semanticMatch: 'Other drains also affected',
                examples: ['Yes other drains too', 'All slow', 'Everywhere backing up']
            },
            {
                id: 'only_toilet',
                patterns: ['no', 'just.*toilet', 'only', 'fine'],
                semanticMatch: 'Only toilet affected',
                examples: ['No just the toilet', 'Only this one', 'Others are fine']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'other_drains_slow' },
                action: {
                    type: 'escalate',
                    reason: 'Multiple drains affected - possible main drain blockage',
                    collectData: ['Ground floor or upper floor?', 'Any outside drain covers visible?']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'only_toilet' },
                action: { type: 'goto_step', stepId: 'toilet_try_plunger' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'toilet_try_plunger' }
        }
    },

    {
        id: 'toilet_try_plunger',
        type: 'instruction',
        template: "Let's try plunging the toilet. You'll need a proper toilet plunger (shaped like a ball/cup).\n\n1. Make sure there's water in the bowl (add some if needed)\n2. Place the plunger over the hole at the bottom\n3. Push down slowly first to get a seal\n4. Then pump vigorously 15-20 times\n5. Pull up sharply on the last pump\n\nDid that clear it?",
        expectedResponses: [
            {
                id: 'cleared',
                patterns: ['cleared', 'worked', 'flushing', 'yes', 'fixed'],
                semanticMatch: 'Blockage cleared',
                examples: ['Cleared!', 'That worked', 'Flushing now', 'Fixed!']
            },
            {
                id: 'no_plunger',
                patterns: ['no plunger', 'don\'t have', 'only.*sink plunger'],
                semanticMatch: 'Does not have toilet plunger',
                examples: ["Don't have one", 'No toilet plunger', 'Only have a sink plunger']
            },
            {
                id: 'still_blocked',
                patterns: ['still', 'no', 'didn\'t', 'blocked'],
                semanticMatch: 'Still blocked',
                examples: ['Still blocked', "Didn't work", 'No luck']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'cleared' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_plunger' },
                action: { type: 'goto_step', stepId: 'toilet_hot_water' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_blocked' },
                action: { type: 'goto_step', stepId: 'toilet_hot_water' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'toilet_hot_water' }
        }
    },

    {
        id: 'toilet_hot_water',
        type: 'instruction',
        template: "Let's try hot water with washing up liquid.\n\n1. Squirt some washing up liquid into the bowl\n2. Heat a bucket of water (hot but not boiling - to avoid cracking the toilet)\n3. Pour from waist height into the bowl\n4. Wait 10-15 minutes\n5. Try flushing\n\nDid that clear it?",
        expectedResponses: [
            {
                id: 'cleared',
                patterns: ['cleared', 'worked', 'flushing', 'yes', 'fixed'],
                semanticMatch: 'Blockage cleared',
                examples: ['Yes!', 'That worked', 'Flushing now']
            },
            {
                id: 'still_blocked',
                patterns: ['still', 'no', 'didn\'t', 'blocked'],
                semanticMatch: 'Still blocked',
                examples: ['Still blocked', "Didn't work"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'cleared' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_blocked' },
                action: { type: 'goto_step', stepId: 'escalate_professional' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'escalate_professional' }
        }
    },

    // ===== OUTSIDE DRAIN PATH =====
    {
        id: 'outside_drain_check',
        type: 'question',
        template: "Outside drains can be blocked by leaves, debris, or grease. Can you lift the drain cover to look inside?\n\n**Safety**: Wear gloves if possible!\n\nIs the drain:\n1. Full of standing water\n2. Has visible debris/blockage\n3. Dry/empty",
        expectedResponses: [
            {
                id: 'standing_water',
                patterns: ['water', 'full', 'standing', '^1$'],
                semanticMatch: 'Full of standing water',
                examples: ['Full of water', 'Standing water', '1']
            },
            {
                id: 'debris_visible',
                patterns: ['debris', 'leaves', 'blockage', 'stuff', '^2$'],
                semanticMatch: 'Debris visible',
                examples: ['Lots of leaves', 'Can see a blockage', '2']
            },
            {
                id: 'dry',
                patterns: ['dry', 'empty', '^3$'],
                semanticMatch: 'Dry or empty',
                examples: ['Dry', 'Empty', '3']
            },
            {
                id: 'cant_open',
                patterns: ['can\'t open', 'stuck', 'won\'t lift', 'sealed'],
                semanticMatch: 'Cannot open cover',
                examples: ["Can't lift it", "It's stuck", 'Sealed shut']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'standing_water' },
                action: { type: 'goto_step', stepId: 'outside_clear_visible' }
            },
            {
                condition: { type: 'response_matches', responseId: 'debris_visible' },
                action: { type: 'goto_step', stepId: 'outside_clear_visible' }
            },
            {
                condition: { type: 'response_matches', responseId: 'dry' },
                action: {
                    type: 'escalate',
                    reason: 'Outside drain is dry - blockage may be further down the system',
                    collectData: ['Are other drains in the house backing up?', 'Location of drain']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'cant_open' },
                action: {
                    type: 'escalate',
                    reason: 'Cannot access outside drain cover',
                    collectData: ['Location of drain', 'Type of cover (metal/plastic)']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Outside drain needs professional assessment',
                collectData: ['Location of drain', 'Symptoms']
            }
        }
    },

    {
        id: 'outside_clear_visible',
        type: 'instruction',
        template: "If you can see debris at the top:\n\n1. Put on rubber gloves\n2. Remove any leaves, dirt, or debris you can reach\n3. Use a stick or drain rod if you have one to push deeper debris\n4. Flush with a bucket of water\n\n**Note**: If there's a lot of grease or it's deeper than you can reach, we'll need a drainage specialist.\n\nWere you able to clear any debris?",
        expectedResponses: [
            {
                id: 'cleared_draining',
                patterns: ['cleared', 'draining', 'flowing', 'worked', 'yes'],
                semanticMatch: 'Cleared and now draining',
                examples: ['Cleared it', 'Draining now', 'Water flowing']
            },
            {
                id: 'removed_some',
                patterns: ['some', 'bit', 'still', 'deeper'],
                semanticMatch: 'Removed some but still blocked',
                examples: ['Removed some but still blocked', 'Goes deeper', "Can't reach it all"]
            },
            {
                id: 'cant_reach',
                patterns: ['can\'t reach', 'too deep', 'need.*tool', 'no'],
                semanticMatch: 'Cannot reach the blockage',
                examples: ["Can't reach it", 'Too deep', 'Need proper tools']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'cleared_draining' },
                action: { type: 'goto_step', stepId: 'confirm_fixed' }
            },
            {
                condition: { type: 'response_matches', responseId: 'removed_some' },
                action: {
                    type: 'escalate',
                    reason: 'Outside drain partially blocked - needs drain rods or jetting',
                    collectData: ['Location of drain', 'What debris was visible?']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'cant_reach' },
                action: {
                    type: 'escalate',
                    reason: 'Outside drain blocked beyond reach - needs professional clearing',
                    collectData: ['Location of drain']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Outside drain needs professional clearing',
                collectData: ['Location of drain']
            }
        }
    },

    // ===== SHARED FINAL STEPS =====
    {
        id: 'confirm_fixed',
        type: 'confirmation',
        template: "Excellent! Run the water for a minute to make sure it's draining properly. Is it all working well now?",
        confirmationRequired: true,
        expectedResponses: [
            {
                id: 'all_good',
                patterns: ['yes', 'good', 'working', 'fixed', 'great', 'draining'],
                semanticMatch: 'Confirmed working',
                examples: ['Yes all good', 'Working great', 'Fixed!']
            },
            {
                id: 'still_slow',
                patterns: ['slow', 'bit', 'not quite', 'still'],
                semanticMatch: 'Still a bit slow',
                examples: ['Still a bit slow', 'Not quite right']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'all_good' },
                action: {
                    type: 'resolve',
                    resolution: 'The drain is now clear. To prevent future blockages:\n- Kitchen: Avoid pouring grease down the drain\n- Bathroom: Use a drain cover to catch hair\n- Regular flush with hot water once a week'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_slow' },
                action: { type: 'goto_step', stepId: 'slow_drain_advice' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'resolve',
                resolution: 'Great, the drain should be clear now. Let us know if you have any more issues!'
            }
        }
    },

    {
        id: 'slow_drain_advice',
        type: 'instruction',
        template: "A slightly slow drain might just need time to fully clear, or there could be buildup further down.\n\nTry:\n1. Pour boiling water down once a day for the next few days\n2. Use a drain cleaner once a week for maintenance\n\nIf it doesn't improve or gets worse, let us know and we'll arrange for it to be properly cleared.\n\nIs that OK?",
        expectedResponses: [
            {
                id: 'ok',
                patterns: ['ok', 'yes', 'fine', 'will do', 'thanks'],
                semanticMatch: 'Acknowledged',
                examples: ['OK', 'Will do', 'Thanks']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'ok' },
                action: {
                    type: 'resolve',
                    resolution: 'Keep an eye on it and let us know if it gets worse. A slow drain that persists might need professional clearing.'
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'resolve',
                resolution: 'Let us know if the drain problem continues and we can arrange professional clearing.'
            }
        }
    },

    {
        id: 'escalate_professional',
        type: 'confirmation',
        template: "It looks like this blockage needs professional attention. The drain may need:\n- Drain rods to reach the blockage\n- High-pressure water jetting\n- CCTV inspection for deeper issues\n\nI'll arrange for a drainage specialist to visit. Is there anything else you can tell me about the problem?",
        expectedResponses: [
            {
                id: 'has_info',
                patterns: ['smell', 'gurgling', 'backing up', 'multiple', 'sewage'],
                semanticMatch: 'Has additional symptoms',
                examples: ['There is a smell', "It's gurgling", 'Multiple drains affected']
            },
            {
                id: 'no_info',
                patterns: ['no', 'nothing', 'that\'s all'],
                semanticMatch: 'No additional info',
                examples: ['No', "That's everything"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'has_info' },
                action: {
                    type: 'escalate',
                    reason: 'Blocked drain needs professional clearing',
                    collectData: ['Additional symptoms reported by tenant']
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_info' },
                action: {
                    type: 'end_flow',
                    outcome: 'needs_callout'
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'end_flow',
                outcome: 'needs_callout'
            }
        }
    }
];

/**
 * Complete flow definition for blocked drain issues
 */
export const BLOCKED_DRAIN_FLOW: TroubleshootingFlow = {
    id: 'blocked_drain',
    name: 'Blocked Drain',
    description: 'Troubleshoot blocked drains in sinks, showers, baths, toilets, and outside drains.',
    category: 'plumbing',
    triggerKeywords: [
        'blocked drain',
        'drain blocked',
        'water not draining',
        'sink blocked',
        'shower blocked',
        'bath blocked',
        'toilet blocked',
        'clogged',
        'slow drain',
        'backing up',
        'won\'t drain'
    ],
    safeForDIY: true,
    safetyWarning: 'Never mix different drain cleaning chemicals - this can create dangerous fumes. Wear gloves when dealing with drains.',
    maxAttempts: 3,
    estimatedTimeMinutes: 10,
    steps,
    escalationDataNeeded: [
        'Which drain is affected',
        'Multiple drains or just one',
        'Any bad smells',
        'Ground floor or upper floor property',
        'Photo of the drain if possible'
    ]
};
