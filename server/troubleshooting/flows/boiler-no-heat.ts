/**
 * Boiler No Heat Flow
 *
 * Troubleshooting flow for boilers that aren't producing heat.
 * Guides tenants through common fixes like repressurizing.
 */

import { TroubleshootingFlow, FlowStep } from '../flow-schema';

/**
 * Step definitions for the boiler no heat flow
 */
const steps: FlowStep[] = [
    // Step 1: Check if boiler has power
    {
        id: 'check_power',
        type: 'question',
        template: "Let's start by checking if your boiler has power. Can you see any lights or display on the boiler front panel?",
        expectedResponses: [
            {
                id: 'power_yes',
                patterns: ['^yes', '^yeah', '^yep', 'lights? on', 'display (is )?on', 'can see'],
                semanticMatch: 'Boiler has power/lights visible',
                examples: ['Yes', 'Yeah the lights are on', 'I can see the display', 'Yes there are lights']
            },
            {
                id: 'power_no',
                patterns: ['^no', '^nope', 'nothing', 'no lights?', 'blank', 'dead', 'off'],
                semanticMatch: 'No power or lights visible',
                examples: ['No', 'Nothing showing', 'It looks dead', 'No lights at all', 'The display is blank']
            },
            {
                id: 'power_unsure',
                patterns: ['not sure', 'don\'t know', 'can\'t tell', 'unsure', 'maybe'],
                semanticMatch: 'User is unsure about power status',
                examples: ["I'm not sure", "Can't really tell", "I don't know what to look for"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'power_yes' },
                action: { type: 'goto_step', stepId: 'check_pressure' }
            },
            {
                condition: { type: 'response_matches', responseId: 'power_no' },
                action: { type: 'goto_step', stepId: 'check_power_supply' }
            },
            {
                condition: { type: 'response_matches', responseId: 'power_unsure' },
                action: { type: 'goto_step', stepId: 'locate_boiler' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "I need to know if the boiler has power. Look at the front of the boiler - do you see any lights or a digital display showing numbers or text?" }
        }
    },

    // Step: Help locate the boiler
    {
        id: 'locate_boiler',
        type: 'instruction',
        template: "The boiler is usually in the kitchen, utility room, or airing cupboard. It's a white or cream box mounted on the wall with pipes going in and out. Can you find it and let me know if you see any lights on the front panel?",
        expectedResponses: [
            {
                id: 'found_with_lights',
                patterns: ['found', 'see it', 'yes.*light', 'light.*on'],
                semanticMatch: 'Found boiler with lights',
                examples: ['Found it, lights are on', 'Yes I can see it, there are lights']
            },
            {
                id: 'found_no_lights',
                patterns: ['found.*no light', 'no light', 'found.*dark', 'found.*nothing'],
                semanticMatch: 'Found boiler without lights',
                examples: ['Found it but no lights', 'Yes found it, nothing on the display']
            },
            {
                id: 'cannot_find',
                patterns: ['can\'t find', 'cannot find', 'where is it', 'no idea'],
                semanticMatch: 'Cannot locate boiler',
                examples: ["Can't find it", "I have no idea where it is"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'found_with_lights' },
                action: { type: 'goto_step', stepId: 'check_pressure' }
            },
            {
                condition: { type: 'response_matches', responseId: 'found_no_lights' },
                action: { type: 'goto_step', stepId: 'check_power_supply' }
            },
            {
                condition: { type: 'response_matches', responseId: 'cannot_find' },
                action: {
                    type: 'escalate',
                    reason: 'Tenant cannot locate the boiler',
                    collectData: ['Property address for contractor visit', 'Any photos of where pipes enter the property']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'check_power' }
        }
    },

    // Step: Check power supply
    {
        id: 'check_power_supply',
        type: 'instruction',
        template: "The boiler might have lost power. Please check:\n\n1. Is there a switch on the wall near the boiler? Make sure it's ON.\n2. Check your fuse box for any tripped switches.\n\nOnce you've checked these, has anything changed?",
        expectedResponses: [
            {
                id: 'power_restored',
                patterns: ['working', 'on now', 'came on', 'lights on', 'fixed'],
                semanticMatch: 'Power has been restored',
                examples: ['It came on!', "It's working now", 'The lights came on']
            },
            {
                id: 'still_no_power',
                patterns: ['still (no|nothing)', 'didn\'t work', 'no change', 'same'],
                semanticMatch: 'Still no power',
                examples: ['Still nothing', 'No change', 'Still not working']
            },
            {
                id: 'tripped_fuse',
                patterns: ['fuse.*tripped', 'switch.*tripped', 'flipped.*back'],
                semanticMatch: 'Found a tripped fuse',
                examples: ['Found a tripped switch', 'The fuse was tripped']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'power_restored' },
                action: { type: 'goto_step', stepId: 'check_pressure' }
            },
            {
                condition: { type: 'response_matches', responseId: 'tripped_fuse' },
                action: { type: 'goto_step', stepId: 'fuse_tripped_warning' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_no_power' },
                action: {
                    type: 'escalate',
                    reason: 'Boiler has no power - may need electrical inspection',
                    collectData: ['Age of boiler if known', 'Any recent electrical work', 'Photo of the boiler']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Unable to restore boiler power',
                collectData: ['Photo of the boiler', 'Photo of fuse box']
            }
        }
    },

    // Step: Fuse tripped warning
    {
        id: 'fuse_tripped_warning',
        type: 'instruction',
        template: "A tripped fuse can indicate an electrical fault. If the fuse trips again after you reset it, please don't keep resetting it - this could indicate a serious problem. Has the boiler stayed on after resetting the fuse?",
        expectedResponses: [
            {
                id: 'staying_on',
                patterns: ['yes', 'staying on', 'working', 'fine now'],
                semanticMatch: 'Boiler is staying on',
                examples: ['Yes', "It's staying on", 'Working now']
            },
            {
                id: 'tripped_again',
                patterns: ['tripped again', 'went off', 'keeps tripping'],
                semanticMatch: 'Fuse keeps tripping',
                examples: ['It tripped again', 'Keeps going off']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'staying_on' },
                action: { type: 'goto_step', stepId: 'check_pressure' }
            },
            {
                condition: { type: 'response_matches', responseId: 'tripped_again' },
                action: {
                    type: 'escalate',
                    reason: 'Boiler keeps tripping the fuse - potential electrical fault',
                    collectData: ['Urgently needs Gas Safe registered engineer']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'check_pressure' }
        }
    },

    // Step 2: Check pressure
    {
        id: 'check_pressure',
        type: 'question',
        template: "Great, now let's check the boiler pressure. Look for a small gauge on the front - it's usually a dial or digital display showing 'bar'. What pressure does it show?\n\n(Normal is between 1.0 and 1.5 bar)",
        expectedResponses: [
            {
                id: 'pressure_low',
                patterns: ['0\\.[0-9]', 'under 1', 'below 1', 'low', 'red', 'zero', '0 bar'],
                semanticMatch: 'Pressure is below 1 bar',
                examples: ['0.5 bar', 'Under 1 bar', "It's in the red", 'Very low', 'Shows 0']
            },
            {
                id: 'pressure_normal',
                patterns: ['1\\.[0-4]', '1 bar', 'green', 'normal', 'middle'],
                semanticMatch: 'Pressure is in normal range',
                examples: ['1.2 bar', 'About 1 bar', "It's in the green", 'Looks normal']
            },
            {
                id: 'pressure_high',
                patterns: ['[2-9]\\.[0-9]', 'over 2', 'above 2', 'high', 'too high', '3 bar'],
                semanticMatch: 'Pressure is above 2 bar',
                examples: ['2.5 bar', 'Over 2', 'It says 3', 'Very high']
            },
            {
                id: 'no_gauge',
                patterns: ['can\'t (find|see)', 'no gauge', 'where is', 'don\'t know'],
                semanticMatch: 'Cannot find or read the gauge',
                examples: ["Can't find the gauge", "Don't see any numbers", "Where should I look?"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'pressure_low' },
                action: { type: 'goto_step', stepId: 'repressurize_instructions' }
            },
            {
                condition: { type: 'response_matches', responseId: 'pressure_normal' },
                action: { type: 'goto_step', stepId: 'check_thermostat' }
            },
            {
                condition: { type: 'response_matches', responseId: 'pressure_high' },
                action: { type: 'goto_step', stepId: 'pressure_too_high' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_gauge' },
                action: { type: 'goto_step', stepId: 'help_find_gauge' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "I need to know the pressure reading. Look for a dial or digital display on the boiler - it should show a number followed by 'bar'. What number do you see?" }
        }
    },

    // Step: Help find pressure gauge
    {
        id: 'help_find_gauge',
        type: 'instruction',
        template: "The pressure gauge is usually:\n- A round dial with numbers 0-4\n- Or a digital display showing something like '1.2'\n\nIt's often at the bottom of the boiler or on the front panel. Can you see anything like that?",
        mediaUrl: 'https://example.com/boiler-gauge-diagram.png',
        expectedResponses: [
            {
                id: 'found_low',
                patterns: ['found.*low', 'see.*0\\.', 'below 1'],
                semanticMatch: 'Found gauge showing low pressure',
                examples: ['Found it, shows 0.5', "I see it, it's below 1"]
            },
            {
                id: 'found_normal',
                patterns: ['found.*1\\.', 'see.*1\\.', 'normal'],
                semanticMatch: 'Found gauge showing normal pressure',
                examples: ['Found it, shows 1.2', 'See it now, looks normal']
            },
            {
                id: 'still_cant_find',
                patterns: ['still can\'t', 'no', 'not there'],
                semanticMatch: 'Still cannot find gauge',
                examples: ["Still can't find it", "It's not there"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'found_low' },
                action: { type: 'goto_step', stepId: 'repressurize_instructions' }
            },
            {
                condition: { type: 'response_matches', responseId: 'found_normal' },
                action: { type: 'goto_step', stepId: 'check_thermostat' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_cant_find' },
                action: { type: 'goto_step', stepId: 'request_photo' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'request_photo' }
        }
    },

    // Step: Request photo
    {
        id: 'request_photo',
        type: 'media_request',
        template: "Could you send me a photo of the front of your boiler? This will help me guide you better.",
        expectedResponses: [],
        transitions: [
            {
                condition: { type: 'media_received', mediaType: 'photo' },
                action: {
                    type: 'escalate',
                    reason: 'Photo received for manual review',
                    collectData: []
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'attempt_count_exceeds', count: 2 },
            action: {
                type: 'escalate',
                reason: 'Cannot identify pressure gauge location',
                collectData: ['Boiler make and model', 'Age of boiler']
            }
        }
    },

    // Step: Pressure too high
    {
        id: 'pressure_too_high',
        type: 'instruction',
        template: "The pressure is too high (over 2 bar). This can be dangerous if it gets much higher. **Do not try to add more water.**\n\nThe pressure can be released by bleeding a radiator, but for safety I recommend we send an engineer. Would you like me to arrange a visit?",
        expectedResponses: [
            {
                id: 'yes_engineer',
                patterns: ['^yes', 'please', 'send someone', 'arrange'],
                semanticMatch: 'Wants engineer visit',
                examples: ['Yes please', 'Please send someone', 'Yes arrange a visit']
            },
            {
                id: 'will_try_bleed',
                patterns: ['try.*bleed', 'bleed.*radiator', 'do it myself'],
                semanticMatch: 'Wants to try bleeding radiator',
                examples: ["I'll try bleeding a radiator", 'Let me try that first']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'yes_engineer' },
                action: {
                    type: 'end_flow',
                    outcome: 'needs_callout'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'will_try_bleed' },
                action: { type: 'goto_step', stepId: 'bleed_radiator_instructions' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'end_flow',
                outcome: 'needs_callout'
            }
        }
    },

    // Step: Bleed radiator instructions
    {
        id: 'bleed_radiator_instructions',
        type: 'instruction',
        template: "To bleed a radiator:\n\n1. Turn off your heating\n2. Find a radiator with a small square valve at the top corner\n3. Place a cloth underneath\n4. Use a radiator key to slowly turn the valve anti-clockwise\n5. When water starts dripping, close the valve\n\nCheck the boiler pressure after - did it come down?",
        expectedResponses: [
            {
                id: 'pressure_down',
                patterns: ['came down', 'lower', 'normal', 'better', '1\\.[0-4]'],
                semanticMatch: 'Pressure has reduced',
                examples: ['Yes it came down', "It's lower now", 'Shows 1.2 now']
            },
            {
                id: 'still_high',
                patterns: ['still high', 'same', 'didn\'t work', 'no change'],
                semanticMatch: 'Pressure still high',
                examples: ['Still high', 'No change', "Didn't work"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'pressure_down' },
                action: { type: 'goto_step', stepId: 'check_thermostat' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_high' },
                action: {
                    type: 'end_flow',
                    outcome: 'needs_callout'
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'check_thermostat' }
        }
    },

    // Step 3: Repressurize instructions
    {
        id: 'repressurize_instructions',
        type: 'instruction',
        template: "Low pressure is a common issue and usually easy to fix. Look underneath or near the boiler for a filling loop - it's a braided silver hose with one or two valves.\n\nDo you see a filling loop?",
        expectedResponses: [
            {
                id: 'see_loop',
                patterns: ['^yes', 'see it', 'found it', 'braided', 'silver hose'],
                semanticMatch: 'Can see the filling loop',
                examples: ['Yes', 'I see it', 'Found it']
            },
            {
                id: 'no_loop',
                patterns: ['^no', 'can\'t see', 'don\'t see', 'not there'],
                semanticMatch: 'Cannot find filling loop',
                examples: ['No', "Can't see one", "It's not there"]
            },
            {
                id: 'keyed_type',
                patterns: ['key', 'insert', 'slot'],
                semanticMatch: 'Boiler has key-operated filling',
                examples: ['There is a key slot', 'It needs a key']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'see_loop' },
                action: { type: 'goto_step', stepId: 'do_repressurize' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_loop' },
                action: { type: 'goto_step', stepId: 'internal_filling_loop' }
            },
            {
                condition: { type: 'response_matches', responseId: 'keyed_type' },
                action: { type: 'goto_step', stepId: 'keyed_filling_instructions' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "Look around and underneath the boiler for a braided silver hose connecting two pipes. Can you see anything like that?" }
        }
    },

    // Step: Internal filling loop
    {
        id: 'internal_filling_loop',
        type: 'instruction',
        template: "Some modern boilers have an internal filling loop. Check underneath the boiler for:\n- A small lever or tap\n- A slot where a key might go\n- Any button labeled 'fill' or with a water drop symbol\n\nDo you see any of these?",
        expectedResponses: [
            {
                id: 'found_lever',
                patterns: ['lever', 'tap', 'found'],
                semanticMatch: 'Found a lever or tap',
                examples: ['Found a lever', 'There is a tap', 'Yes found something']
            },
            {
                id: 'found_key_slot',
                patterns: ['key', 'slot'],
                semanticMatch: 'Found key slot',
                examples: ['There is a key slot', 'Found where a key goes']
            },
            {
                id: 'nothing_found',
                patterns: ['no', 'nothing', 'can\'t find'],
                semanticMatch: 'Cannot find any filling mechanism',
                examples: ['No', 'Nothing like that', "Can't find anything"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'found_lever' },
                action: { type: 'goto_step', stepId: 'do_repressurize' }
            },
            {
                condition: { type: 'response_matches', responseId: 'found_key_slot' },
                action: { type: 'goto_step', stepId: 'keyed_filling_instructions' }
            },
            {
                condition: { type: 'response_matches', responseId: 'nothing_found' },
                action: {
                    type: 'escalate',
                    reason: 'Cannot locate filling loop - may be inaccessible or missing',
                    collectData: ['Boiler make and model', 'Photo of boiler underside']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Unable to identify filling loop type',
                collectData: ['Boiler make and model']
            }
        }
    },

    // Step: Keyed filling instructions
    {
        id: 'keyed_filling_instructions',
        type: 'instruction',
        template: "Some boilers need a special filling key. This is often stored:\n- In a cupboard with the boiler manuals\n- Hanging near the boiler\n- In the kitchen drawer with house documents\n\nDo you have the filling key?",
        expectedResponses: [
            {
                id: 'have_key',
                patterns: ['^yes', 'have it', 'found it', 'got it'],
                semanticMatch: 'Has the filling key',
                examples: ['Yes', 'Found it', 'Got it']
            },
            {
                id: 'no_key',
                patterns: ['^no', 'don\'t have', 'can\'t find', 'lost'],
                semanticMatch: 'Does not have the key',
                examples: ['No', "Don't have one", "Can't find it"]
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'have_key' },
                action: { type: 'goto_step', stepId: 'do_repressurize' }
            },
            {
                condition: { type: 'response_matches', responseId: 'no_key' },
                action: {
                    type: 'escalate',
                    reason: 'Missing filling key - engineer can bring replacement',
                    collectData: ['Boiler make and model']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: {
                type: 'escalate',
                reason: 'Keyed filling loop - tenant needs assistance',
                collectData: ['Boiler make and model']
            }
        }
    },

    // Step: Do repressurize
    {
        id: 'do_repressurize',
        type: 'instruction',
        template: "Perfect! Now let's add pressure:\n\n1. Slowly open the valve(s) on the filling loop\n2. Watch the pressure gauge\n3. Stop when it reaches 1.0-1.5 bar\n4. Close the valve(s) completely\n\n**Important**: Add pressure slowly and don't go above 1.5 bar.\n\nLet me know when you've done this - what does the pressure show now?",
        expectedResponses: [
            {
                id: 'pressure_ok',
                patterns: ['1\\.[0-4]', 'good', 'done', 'working', '1 bar', '1.2', '1.5'],
                semanticMatch: 'Pressure is now in normal range',
                examples: ['Shows 1.2 now', 'Done - looks good', 'Working']
            },
            {
                id: 'went_too_high',
                patterns: ['too high', 'over 2', 'went up too much', '2 bar', '2.5'],
                semanticMatch: 'Pressure went too high',
                examples: ['Went too high', "It's over 2 bar now", "I put in too much"]
            },
            {
                id: 'wont_go_up',
                patterns: ['won\'t go up', 'not changing', 'stays low', 'no change'],
                semanticMatch: 'Pressure not increasing',
                examples: ["Won't go up", 'Nothing happening', 'Stays at 0']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'pressure_ok' },
                action: { type: 'goto_step', stepId: 'confirm_repressurize' }
            },
            {
                condition: { type: 'response_matches', responseId: 'went_too_high' },
                action: { type: 'goto_step', stepId: 'bleed_radiator_instructions' }
            },
            {
                condition: { type: 'response_matches', responseId: 'wont_go_up' },
                action: {
                    type: 'escalate',
                    reason: 'Pressure not increasing - possible leak or valve issue',
                    collectData: ['Any visible leaks?', 'Photo of filling loop']
                }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "What does the pressure gauge show now? It should be between 1.0 and 1.5 bar." }
        }
    },

    // Step 4: Confirm repressurize worked
    {
        id: 'confirm_repressurize',
        type: 'confirmation',
        template: "Excellent! The pressure looks good. Now try turning on your heating using the thermostat or timer. Give it 5-10 minutes to warm up.\n\nIs heat coming through the radiators?",
        confirmationRequired: true,
        expectedResponses: [
            {
                id: 'heat_working',
                patterns: ['^yes', 'working', 'warm', 'hot', 'heating up', 'fixed'],
                semanticMatch: 'Heating is now working',
                examples: ['Yes!', "It's working", 'Radiators are warming up', 'Fixed!']
            },
            {
                id: 'still_no_heat',
                patterns: ['^no', 'not working', 'still cold', 'nothing'],
                semanticMatch: 'Still no heat',
                examples: ['No', 'Still cold', 'Nothing happening']
            },
            {
                id: 'some_radiators',
                patterns: ['some', 'one', 'few', 'not all'],
                semanticMatch: 'Only some radiators heating',
                examples: ['Some are warm', 'Only one is hot', 'Not all of them']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'heat_working' },
                action: {
                    type: 'resolve',
                    resolution: 'Your boiler needed repressurizing and is now working. If the pressure drops again frequently, it might indicate a small leak - let us know if it happens again.'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'some_radiators' },
                action: { type: 'goto_step', stepId: 'some_radiators_cold' }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_no_heat' },
                action: { type: 'goto_step', stepId: 'check_thermostat' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'retry_step', message: "Please wait a few minutes for the system to heat up. Are the radiators getting warm?" }
        }
    },

    // Step: Some radiators cold
    {
        id: 'some_radiators_cold',
        type: 'instruction',
        template: "If only some radiators are cold, they might need bleeding (removing trapped air). For each cold radiator:\n\n1. Use a radiator key to open the bleed valve at the top corner\n2. Listen for air hissing out\n3. Close when water starts to drip\n\nAfter bleeding, check the boiler pressure - you may need to top it up again. Did this help?",
        expectedResponses: [
            {
                id: 'all_working',
                patterns: ['working', 'all.*warm', 'fixed', 'yes'],
                semanticMatch: 'All radiators now working',
                examples: ['Yes all working now', 'Fixed!', 'All warm now']
            },
            {
                id: 'still_cold',
                patterns: ['still cold', 'no', 'didn\'t work'],
                semanticMatch: 'Radiators still cold',
                examples: ['Still cold', "Didn't help", 'No change']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'all_working' },
                action: {
                    type: 'resolve',
                    resolution: 'Great! Your radiators needed bleeding. This is normal - air can build up over time. The system should work well now.'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_cold' },
                action: {
                    type: 'escalate',
                    reason: 'Radiators not heating after bleeding - possible valve or pump issue',
                    collectData: ['Which radiators are cold?', 'Are the thermostatic valves open?']
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
    },

    // Step 5: Check thermostat
    {
        id: 'check_thermostat',
        type: 'question',
        template: "Let's check the thermostat controls. Can you confirm:\n\n1. The thermostat is set higher than room temperature\n2. The heating timer/schedule is set to 'on'\n3. Any room thermostats are turned up\n\nAre all these set correctly?",
        expectedResponses: [
            {
                id: 'all_correct',
                patterns: ['^yes', 'all.*correct', 'all.*on', 'set.*correctly'],
                semanticMatch: 'All settings are correct',
                examples: ['Yes', 'All correct', 'Everything is on']
            },
            {
                id: 'found_issue',
                patterns: ['found.*issue', 'wasn\'t.*on', 'timer.*off', 'working now'],
                semanticMatch: 'Found and fixed a setting issue',
                examples: ['Timer was off', "Found it - wasn't on", 'Working now!']
            },
            {
                id: 'not_sure',
                patterns: ['not sure', 'don\'t know', 'how do i'],
                semanticMatch: 'Unsure about settings',
                examples: ['Not sure', "Don't know how to check", 'How do I check?']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'found_issue' },
                action: {
                    type: 'resolve',
                    resolution: 'Great catch! The controls needed adjusting. Your heating should work normally now.'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'all_correct' },
                action: { type: 'goto_step', stepId: 'escalate_callout' }
            },
            {
                condition: { type: 'response_matches', responseId: 'not_sure' },
                action: { type: 'goto_step', stepId: 'thermostat_help' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'escalate_callout' }
        }
    },

    // Step: Thermostat help
    {
        id: 'thermostat_help',
        type: 'instruction',
        template: "Let me help you check:\n\n**Room Thermostat**: Usually on a wall - turn the dial up until you hear a click, or set digital display to 21C or higher.\n\n**Timer/Programmer**: Usually near the boiler or in the hallway. Make sure it shows heating is 'ON' or in an active time period.\n\nHave you tried turning these up?",
        expectedResponses: [
            {
                id: 'adjusted_working',
                patterns: ['working', 'heating', 'warm', 'clicked', 'came on'],
                semanticMatch: 'Heating now working after adjustment',
                examples: ['It clicked and came on!', 'Heating now', 'Working!']
            },
            {
                id: 'still_nothing',
                patterns: ['^no', 'nothing', 'still', 'not working'],
                semanticMatch: 'Still not working',
                examples: ['Nothing', 'Still not working', 'No change']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'adjusted_working' },
                action: {
                    type: 'resolve',
                    resolution: 'Perfect! The thermostat just needed adjusting. Your heating should work normally now.'
                }
            },
            {
                condition: { type: 'response_matches', responseId: 'still_nothing' },
                action: { type: 'goto_step', stepId: 'escalate_callout' }
            }
        ],
        fallbackTransition: {
            condition: { type: 'always' },
            action: { type: 'goto_step', stepId: 'escalate_callout' }
        }
    },

    // Step 6: Escalate to callout
    {
        id: 'escalate_callout',
        type: 'confirmation',
        template: "I've checked everything I can remotely. The boiler may need a professional inspection. Common causes at this stage include:\n- Faulty pump\n- Blocked heat exchanger\n- Diverter valve issues\n\nI'll arrange for a Gas Safe registered engineer to visit. Is there anything else you can tell me about the boiler's behavior?",
        expectedResponses: [
            {
                id: 'has_info',
                patterns: ['noise', 'smell', 'leak', 'error', 'code', 'flashing'],
                semanticMatch: 'Has additional symptoms to report',
                examples: ['There is a noise', 'It shows an error code', "There's a smell"]
            },
            {
                id: 'no_info',
                patterns: ['^no', 'nothing', 'that\'s all'],
                semanticMatch: 'No additional information',
                examples: ['No', "That's everything", 'Nothing else']
            }
        ],
        transitions: [
            {
                condition: { type: 'response_matches', responseId: 'has_info' },
                action: {
                    type: 'escalate',
                    reason: 'Boiler not heating - requires professional diagnosis',
                    collectData: ['Additional symptoms described by tenant']
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
 * Complete flow definition for boiler no heat issues
 */
export const BOILER_NO_HEAT_FLOW: TroubleshootingFlow = {
    id: 'boiler_no_heat',
    name: 'Boiler Not Heating',
    description: 'Troubleshoot a boiler that is not producing heat for the central heating or hot water system.',
    category: 'heating',
    triggerKeywords: [
        'no heat',
        'no heating',
        'boiler not working',
        'cold radiators',
        'no hot water',
        'heating broken',
        'boiler fault',
        'radiators cold',
        'central heating'
    ],
    safeForDIY: true,
    safetyWarning: 'If you smell gas, leave the property immediately and call the National Gas Emergency Line: 0800 111 999. Do not touch any electrical switches.',
    maxAttempts: 3,
    estimatedTimeMinutes: 10,
    steps,
    escalationDataNeeded: [
        'Boiler make and model',
        'Current pressure reading',
        'Any error codes displayed',
        'Age of boiler if known',
        'Photo of boiler front panel'
    ]
};
