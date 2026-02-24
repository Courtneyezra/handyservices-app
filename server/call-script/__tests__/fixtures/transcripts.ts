/**
 * Test transcript fixtures for Call Script Tube Map system
 *
 * Each fixture represents a realistic call scenario with:
 * - Realistic dialogue between agent and caller
 * - Expected segment classification
 * - Expected detection signals
 * - Expected destination routing
 * - Expected captured information
 */

export interface TranscriptEntry {
  speaker: 'agent' | 'caller';
  text: string;
}

export interface TranscriptFixture {
  name: string;
  description?: string;
  transcript: TranscriptEntry[];
  expectedSegment: string;
  expectedSignals: string[];
  expectedDestination: 'INSTANT_QUOTE' | 'SITE_VISIT' | 'EMERGENCY_DISPATCH' | 'EXIT' | 'CALLBACK';
  expectedCapturedInfo: {
    job?: string;
    postcode?: string;
    name?: string;
    contact?: string;
    isDecisionMaker?: boolean;
    isRemote?: boolean;
    hasTenant?: boolean;
  };
}

export const TRANSCRIPT_FIXTURES: Record<string, TranscriptFixture> = {
  LANDLORD: {
    name: 'Landlord - Remote with tenant',
    description: 'Buy-to-let landlord living remotely, tenant reported the issue',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi yeah, I've got a rental property in Brixton, the boiler's not working. My tenant called me about it this morning." },
      { speaker: 'agent', text: 'No problem, boiler issues are never fun. So this is a rental you own?' },
      { speaker: 'caller', text: "Yeah, buy to let. I'm up in Manchester so can't be there myself." },
      { speaker: 'agent', text: "And you're the owner yourself?" },
      { speaker: 'caller', text: "Yes, it's my property." },
    ],
    expectedSegment: 'LANDLORD',
    expectedSignals: ['rental property', 'tenant', 'buy to let', "can't be there"],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'boiler not working',
      postcode: 'Brixton',
      isRemote: true,
      hasTenant: true,
      isDecisionMaker: true,
    },
  },

  LANDLORD_LOCAL: {
    name: 'Landlord - Local with empty property',
    description: 'Landlord with property nearby, currently between tenants',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I've got a flat in Clapham that needs some work before the new tenant moves in." },
      { speaker: 'agent', text: 'What kind of work are you looking at?' },
      { speaker: 'caller', text: 'Painting, fixing some door handles, and the bathroom tap is dripping.' },
      { speaker: 'agent', text: 'Is the property empty at the moment?' },
      { speaker: 'caller', text: "Yes, the last tenant just moved out. I can give you access, I'm just round the corner." },
      { speaker: 'agent', text: 'Perfect. What\'s the postcode?' },
      { speaker: 'caller', text: 'SW4 6AB' },
    ],
    expectedSegment: 'LANDLORD',
    expectedSignals: ['flat', 'tenant', 'investment property'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'painting, door handles, tap',
      postcode: 'SW4 6AB',
      isRemote: false,
      hasTenant: false,
      isDecisionMaker: true,
    },
  },

  BUSY_PRO: {
    name: 'Busy Professional - Key safe access',
    description: 'Professional who works long hours, has key safe for access',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I need someone to fix a leaking tap. I'm at work all day so won't be there." },
      { speaker: 'agent', text: 'No problem. Do you have a key safe or someone who can let us in?' },
      { speaker: 'caller', text: "Yeah I've got a key safe, I can give you the code." },
      { speaker: 'agent', text: "Perfect. What's the postcode there?" },
      { speaker: 'caller', text: 'SW11 2AB' },
    ],
    expectedSegment: 'BUSY_PRO',
    expectedSignals: ['at work', "won't be there", 'key safe'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'leaking tap',
      postcode: 'SW11 2AB',
      isRemote: false,
      isDecisionMaker: true,
    },
  },

  BUSY_PRO_NEIGHBOUR_ACCESS: {
    name: 'Busy Professional - Neighbour has key',
    description: 'Busy professional, neighbour can provide access',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: 'Hi, I need a shelf put up. My schedule is crazy this week though.' },
      { speaker: 'agent', text: 'No worries. Can you be there or do you have someone who can let us in?' },
      { speaker: 'caller', text: 'My neighbour has a spare key. She\'s retired so she\'s always home.' },
      { speaker: 'agent', text: 'Perfect, we can coordinate with her. What\'s the job exactly?' },
      { speaker: 'caller', text: 'Just a floating shelf in the living room, about 3 feet long.' },
      { speaker: 'agent', text: 'And the postcode?' },
      { speaker: 'caller', text: 'SE15 4QD' },
    ],
    expectedSegment: 'BUSY_PRO',
    expectedSignals: ['schedule', "can't be there", 'spare key'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'floating shelf',
      postcode: 'SE15 4QD',
      isRemote: false,
      isDecisionMaker: true,
    },
  },

  OAP: {
    name: 'OAP - Trust seeker, lives alone',
    description: 'Elderly caller prioritizing trust and safety, wants to meet first',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hello dear, I hope you can help me. I need some shelves put up but I live alone and I want to make sure whoever comes is trustworthy." },
      { speaker: 'agent', text: 'Of course, I completely understand. All our team are DBS checked and fully insured.' },
      { speaker: 'caller', text: "Oh that's good. My daughter usually helps me with these things but she's moved away now." },
      { speaker: 'agent', text: "Would you like us to pop round first so you can meet the person who'd be doing the work?" },
      { speaker: 'caller', text: 'Yes, I think that would be better.' },
    ],
    expectedSegment: 'OAP',
    expectedSignals: ['live alone', 'trustworthy', 'daughter helps', 'DBS'],
    expectedDestination: 'SITE_VISIT',
    expectedCapturedInfo: {
      job: 'shelves',
      isDecisionMaker: true,
    },
  },

  OAP_MOBILITY_ISSUES: {
    name: 'OAP - Mobility concerns',
    description: 'Elderly caller with mobility issues, needs help with tasks they can no longer do',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hello, I'm hoping you can help. I've got some light bulbs that need changing but I can't manage the ladder anymore." },
      { speaker: 'agent', text: "Of course, we can help with that. How many bulbs are we talking about?" },
      { speaker: 'caller', text: "About five or six. My knees aren't what they used to be, you know." },
      { speaker: 'agent', text: "No problem at all. We help a lot of people with these kinds of jobs. All our team are DBS checked too." },
      { speaker: 'caller', text: "That's reassuring. My neighbour recommended you, said you were very patient." },
      { speaker: 'agent', text: "That's lovely to hear. Would you like someone to pop round and have a look first, or shall I give you a price now?" },
      { speaker: 'caller', text: "Could someone come round? I'd feel better meeting them first." },
    ],
    expectedSegment: 'OAP',
    expectedSignals: ['ladder', "can't manage", 'DBS', 'patient'],
    expectedDestination: 'SITE_VISIT',
    expectedCapturedInfo: {
      job: 'light bulbs',
      isDecisionMaker: true,
    },
  },

  PROP_MGR: {
    name: 'Property Manager - Agency with portfolio',
    description: 'Property management agency managing multiple properties, needs reliable contractor',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I manage about 15 properties in South London. We need a reliable handyman we can call for repairs." },
      { speaker: 'agent', text: 'How many properties do you manage?' },
      { speaker: 'caller', text: "About 15 currently. We need proper invoicing and quick response times." },
      { speaker: 'agent', text: "We work with several agencies. You'd get a dedicated account and 48-72 hour response." },
      { speaker: 'caller', text: 'That sounds good. Can you send me your rates?' },
    ],
    expectedSegment: 'PROP_MGR',
    expectedSignals: ['manage properties', 'portfolio', 'invoicing', 'agency'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'general repairs',
      isDecisionMaker: true,
    },
  },

  PROP_MGR_URGENT: {
    name: 'Property Manager - Urgent tenant issue',
    description: 'Property manager with urgent repair needed for tenant',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I'm calling from Apex Property Management. We've got a tenant in SE1 with a broken front door lock - it won't close properly." },
      { speaker: 'agent', text: "That's a priority - security issue. When did this happen?" },
      { speaker: 'caller', text: "Tenant reported it this morning. They're worried about leaving the flat." },
      { speaker: 'agent', text: "Understood. We can get someone there today. Do we need to coordinate with the tenant?" },
      { speaker: 'caller', text: "Yes please. I'll text you their number. We'll need an invoice with the property address for our records." },
    ],
    expectedSegment: 'PROP_MGR',
    expectedSignals: ['property management', 'tenant', 'invoice', 'property address'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'broken door lock',
      postcode: 'SE1',
      hasTenant: true,
      isDecisionMaker: true,
    },
  },

  SMALL_BIZ: {
    name: 'Small Business - Restaurant after hours',
    description: 'Restaurant owner needing work done outside business hours',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I've got a restaurant and need some repair work done. Would need to be after hours though, can't have noise during service." },
      { speaker: 'agent', text: 'No problem, we can do early morning or evening. What\'s the work?' },
      { speaker: 'caller', text: 'Door handle broken on the bathroom, and a few tiles need replacing.' },
      { speaker: 'agent', text: "We're used to working around businesses. We'll be in and out, clean up after ourselves." },
      { speaker: 'caller', text: "Perfect, that's what I need." },
    ],
    expectedSegment: 'SMALL_BIZ',
    expectedSignals: ['restaurant', 'after hours', 'business', 'customers'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'door handle, tiles',
      isDecisionMaker: true,
    },
  },

  SMALL_BIZ_SHOP: {
    name: 'Small Business - Shop front repair',
    description: 'Shop owner needing exterior work done',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I've got a shop on the high street. The sign above the door is coming loose and I need it fixed before it falls on someone." },
      { speaker: 'agent', text: "Safety first, definitely. Is this a wall-mounted sign?" },
      { speaker: 'caller', text: "Yeah, it's bolted to the brick. Been there years but it's wobbling now." },
      { speaker: 'agent', text: "We can take a look and secure it. Would need to do it when you're closed or quieter - don't want ladders in front of customers." },
      { speaker: 'caller', text: "We close at 5pm, could someone come after that?" },
      { speaker: 'agent', text: "Absolutely. What's the address?" },
      { speaker: 'caller', text: "42 Brixton Road, SW9 8AB" },
    ],
    expectedSegment: 'SMALL_BIZ',
    expectedSignals: ['shop', 'high street', 'customers', 'business hours'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'sign repair',
      postcode: 'SW9 8AB',
      isDecisionMaker: true,
    },
  },

  EMERGENCY: {
    name: 'Emergency - Burst pipe flooding',
    description: 'Urgent water leak requiring immediate response',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I've got water coming through my ceiling! I think a pipe has burst upstairs." },
      { speaker: 'agent', text: "OK, let's get this sorted. Can you find the stopcock and turn the water off? Usually under the kitchen sink." },
      { speaker: 'caller', text: "OK I've done that. Can someone come today?" },
      { speaker: 'agent', text: "What's your full address including postcode?" },
      { speaker: 'caller', text: "It's 42 High Street, SW4 7AB" },
    ],
    expectedSegment: 'EMERGENCY',
    expectedSignals: ['water', 'burst', 'flooding', 'today'],
    expectedDestination: 'EMERGENCY_DISPATCH',
    expectedCapturedInfo: {
      job: 'burst pipe',
      postcode: 'SW4 7AB',
      isDecisionMaker: true,
    },
  },

  EMERGENCY_ELECTRICAL: {
    name: 'Emergency - Electrical sparking',
    description: 'Electrical emergency with safety concern',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I've got sparks coming from my fuse box! There's a burning smell too." },
      { speaker: 'agent', text: "Right, first thing - have you turned the main power off at the consumer unit?" },
      { speaker: 'caller', text: "Yes, I've switched everything off. The smell has stopped but I'm worried." },
      { speaker: 'agent', text: "Good thinking. Don't touch anything else. What's your address?" },
      { speaker: 'caller', text: "15 Oak Lane, SE22 0PT" },
      { speaker: 'agent', text: "OK, we'll get an electrician to you within the hour. Stay away from the fuse box." },
    ],
    expectedSegment: 'EMERGENCY',
    expectedSignals: ['sparks', 'burning', 'fuse box', 'urgent'],
    expectedDestination: 'EMERGENCY_DISPATCH',
    expectedCapturedInfo: {
      job: 'electrical sparking fuse box',
      postcode: 'SE22 0PT',
      isDecisionMaker: true,
    },
  },

  BUDGET: {
    name: 'Budget Shopper - Price focused',
    description: 'Price-sensitive caller shopping around for cheapest option',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: 'Yeah hi, just wondering how much you charge per hour?' },
      { speaker: 'agent', text: "It depends on the job. What do you need doing?" },
      { speaker: 'caller', text: 'Just hanging a door. Someone else quoted me 50 quid, can you beat that?' },
      { speaker: 'agent', text: "What's most important to you - getting it done right, fast, or keeping cost down?" },
      { speaker: 'caller', text: 'Definitely keeping the cost down. I just need the cheapest option.' },
    ],
    expectedSegment: 'BUDGET',
    expectedSignals: ['how much per hour', 'beat that price', 'cheapest'],
    expectedDestination: 'EXIT',
    expectedCapturedInfo: {
      job: 'hanging a door',
    },
  },

  BUDGET_AGGRESSIVE: {
    name: 'Budget Shopper - Aggressive negotiator',
    description: 'Caller aggressively trying to negotiate price down',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "What's your hourly rate?" },
      { speaker: 'agent', text: "It depends on the job. What do you need doing?" },
      { speaker: 'caller', text: "Just tell me the hourly rate. I've got 3 other quotes already." },
      { speaker: 'agent', text: "We price by the job rather than hourly. What's the work?" },
      { speaker: 'caller', text: "Look, I'm not paying more than 30 an hour. That's my budget. Can you do it or not?" },
      { speaker: 'agent', text: "We might not be the right fit for you. We focus on quality and guarantee our work." },
      { speaker: 'caller', text: "So you can't match the other quotes then?" },
    ],
    expectedSegment: 'BUDGET',
    expectedSignals: ['hourly rate', 'other quotes', 'budget', "can't match"],
    expectedDestination: 'EXIT',
    expectedCapturedInfo: {
      isDecisionMaker: true,
    },
  },

  BUDGET_RECOVERY: {
    name: 'Budget Shopper - Recovers to quality',
    description: 'Initially price-focused but shifts to valuing quality after bad experience',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: 'Hi, how much do you charge roughly?' },
      { speaker: 'agent', text: "What's most important to you - getting it done right, fast, or keeping cost down?" },
      { speaker: 'caller', text: 'Well, I want it done properly really. Last guy I used was cheap but made a mess of it.' },
      { speaker: 'agent', text: "We're not the cheapest but we guarantee the work. All DBS checked, fully insured." },
      { speaker: 'caller', text: 'That sounds better actually. Can I get a quote?' },
    ],
    expectedSegment: 'BUSY_PRO', // Recovered to regular segment
    expectedSignals: ['done properly', 'guarantee'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      isDecisionMaker: true,
    },
  },

  DIY_DEFERRER: {
    name: 'DIY Deferrer - Overwhelmed homeowner',
    description: 'Homeowner who has been putting off multiple jobs',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I've got a list of jobs I've been meaning to do myself but never got round to it." },
      { speaker: 'agent', text: 'Ha, we hear that a lot. What\'s on the list?' },
      { speaker: 'caller', text: 'A dripping tap, couple of doors that stick, and I need some shelves putting up. Oh and the bathroom extractor fan is making a noise.' },
      { speaker: 'agent', text: 'Sounds like a half-day job. We can knock all that out in one visit, save you having to think about it.' },
      { speaker: 'caller', text: 'That would be amazing. I kept saying I\'d do it at the weekend but...' },
      { speaker: 'agent', text: 'Story of my life too! What\'s your postcode?' },
      { speaker: 'caller', text: 'SW16 2BH' },
    ],
    expectedSegment: 'DIY_DEFERRER',
    expectedSignals: ['list of jobs', 'never got round to it', 'meant to do myself'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'dripping tap, sticking doors, shelves, extractor fan',
      postcode: 'SW16 2BH',
      isDecisionMaker: true,
    },
  },

  DIY_DEFERRER_FAILED_ATTEMPT: {
    name: 'DIY Deferrer - Failed DIY attempt',
    description: 'Homeowner who tried DIY and made it worse',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I tried to fix my toilet flush myself and now it won't stop running." },
      { speaker: 'agent', text: 'Ah, the classic DIY backfire. No judgement, happens all the time. What did you try?' },
      { speaker: 'caller', text: 'I watched a YouTube video and replaced the flapper valve but now water keeps trickling.' },
      { speaker: 'agent', text: 'Probably the seal or the float. We can sort that out. Might be quicker than another YouTube session!' },
      { speaker: 'caller', text: "Yeah, I think I should just get someone in. I've made it worse trying to save money." },
    ],
    expectedSegment: 'DIY_DEFERRER',
    expectedSignals: ['tried to fix', 'DIY', 'YouTube', 'made it worse'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'toilet flush repair',
      isDecisionMaker: true,
    },
  },

  NOT_DECISION_MAKER: {
    name: 'Not Decision Maker - Calling for boss',
    description: 'Caller gathering quotes but not the decision maker',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I'm calling on behalf of my boss. He needs some work done at his house." },
      { speaker: 'agent', text: "No problem. Are you able to make decisions on this or would we need to speak to your boss directly?" },
      { speaker: 'caller', text: "I'm just getting quotes for him. He'll decide which one to go with." },
      { speaker: 'agent', text: "OK, I can send through some info. What's the job?" },
      { speaker: 'caller', text: "He needs the garden fence fixed. I don't know much more than that." },
    ],
    expectedSegment: 'BUSY_PRO',
    expectedSignals: ['on behalf of', 'getting quotes', "he'll decide"],
    expectedDestination: 'CALLBACK',
    expectedCapturedInfo: {
      job: 'garden fence',
      isDecisionMaker: false,
    },
  },

  FOREIGN_LANGUAGE_NEEDS_CALLBACK: {
    name: 'Language barrier - Needs callback',
    description: 'Caller has difficulty with English, needs callback with translator',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: 'Hello... my English not good. I need help... water problem.' },
      { speaker: 'agent', text: 'No problem, I understand. Water problem - leak? Flood?' },
      { speaker: 'caller', text: 'Yes, leak. Small leak. Kitchen.' },
      { speaker: 'agent', text: 'Kitchen leak. Is someone there who speaks English? Family member?' },
      { speaker: 'caller', text: 'My son... he come home 5 o\'clock.' },
      { speaker: 'agent', text: 'OK, we\'ll call back at 5 when your son is there. Is that OK?' },
      { speaker: 'caller', text: 'Yes, thank you. Five o\'clock.' },
    ],
    expectedSegment: 'BUSY_PRO',
    expectedSignals: ['language barrier', 'family member', 'call back'],
    expectedDestination: 'CALLBACK',
    expectedCapturedInfo: {
      job: 'kitchen leak',
      isDecisionMaker: false,
    },
  },

  COMPLEX_JOB_SITE_VISIT: {
    name: 'Complex Job - Needs site visit',
    description: 'Job too complex to quote over phone, needs assessment',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I want to convert my garage into a home office. Is that something you do?" },
      { speaker: 'agent', text: 'We can help with some of that. What are you looking to do - insulation, electrics, walls?' },
      { speaker: 'caller', text: "All of it really. New floor, walls, windows, heating. The works." },
      { speaker: 'agent', text: "That's quite a project. We'd need to come and have a look to give you an accurate quote. There might be building regs to consider too." },
      { speaker: 'caller', text: 'Yeah, I thought it might be complicated. When can someone come round?' },
    ],
    expectedSegment: 'DIY_DEFERRER',
    expectedSignals: ['convert', 'the works', 'complicated', 'building regs'],
    expectedDestination: 'SITE_VISIT',
    expectedCapturedInfo: {
      job: 'garage conversion',
      isDecisionMaker: true,
    },
  },

  REPEAT_CUSTOMER: {
    name: 'Repeat Customer - Previous positive experience',
    description: 'Customer who has used service before and is returning',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, you did some work for me last month - fixed my bathroom door. I've got another job if you're available." },
      { speaker: 'agent', text: "Great to hear from you again! What do you need this time?" },
      { speaker: 'caller', text: 'My kitchen tap is leaking. Same address as before.' },
      { speaker: 'agent', text: "No problem, I've got your details. Shall I book you in for this week?" },
      { speaker: 'caller', text: 'Yes please, whenever works.' },
    ],
    expectedSegment: 'BUSY_PRO',
    expectedSignals: ['previous work', 'last month', 'same address'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      job: 'kitchen tap leaking',
      isDecisionMaker: true,
    },
  },
};

/**
 * Edge case transcripts for testing boundary conditions
 */
export const EDGE_CASE_FIXTURES: Record<string, TranscriptFixture> = {
  VERY_SHORT_CALL: {
    name: 'Very Short Call - Minimal information',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: 'How much to fix a tap?' },
    ],
    expectedSegment: 'BUDGET', // Insufficient info, price-focused
    expectedSignals: ['how much'],
    expectedDestination: 'EXIT',
    expectedCapturedInfo: {
      job: 'fix a tap',
    },
  },

  CALLER_HANGS_UP: {
    name: 'Caller Hangs Up Mid-Call',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "I need some shelves put up in my--" },
      // Call ends abruptly
    ],
    expectedSegment: 'UNKNOWN',
    expectedSignals: [],
    expectedDestination: 'EXIT',
    expectedCapturedInfo: {
      job: 'shelves',
    },
  },

  MULTIPLE_SEGMENTS_MENTIONED: {
    name: 'Multiple Segments - Landlord who is also busy pro',
    description: 'Caller exhibits signals from multiple segments',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I've got a rental property that needs work. I'm at work all day so can't be there myself." },
      { speaker: 'agent', text: 'Is this a property you rent out or your own home?' },
      { speaker: 'caller', text: "It's my own place actually, I live there. I'm just really busy with work." },
    ],
    expectedSegment: 'BUSY_PRO', // Clarified they live there
    expectedSignals: ['at work', "can't be there", 'busy'],
    expectedDestination: 'INSTANT_QUOTE',
    expectedCapturedInfo: {
      isRemote: false,
      hasTenant: false,
      isDecisionMaker: true,
    },
  },

  SPAM_SALES_CALL: {
    name: 'Spam/Sales Call',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Hi, I'm calling from XYZ Marketing. We have an amazing offer for small businesses like yours." },
      { speaker: 'agent', text: "Sorry, we're not interested. Thanks." },
    ],
    expectedSegment: 'UNKNOWN',
    expectedSignals: ['marketing', 'offer'],
    expectedDestination: 'EXIT',
    expectedCapturedInfo: {},
  },

  WRONG_NUMBER: {
    name: 'Wrong Number',
    transcript: [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "Oh sorry, I was trying to call the pizza place. Wrong number!" },
      { speaker: 'agent', text: 'No worries, have a good day!' },
    ],
    expectedSegment: 'UNKNOWN',
    expectedSignals: ['wrong number'],
    expectedDestination: 'EXIT',
    expectedCapturedInfo: {},
  },
};

/**
 * Partial transcripts for testing real-time streaming behavior
 * Each array represents progressive chunks of the same conversation
 */
export const STREAMING_FIXTURES = {
  LANDLORD_PROGRESSIVE: [
    // Chunk 1 - Opening
    [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
    ],
    // Chunk 2 - First signal detected (rental property)
    [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "I've got a rental property in Clapham..." },
    ],
    // Chunk 3 - More signals (tenant)
    [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "I've got a rental property in Clapham, my tenant said the boiler stopped working." },
    ],
    // Chunk 4 - Confirmation (buy to let)
    [
      { speaker: 'agent', text: 'Hey, Handy Services, how can I help?' },
      { speaker: 'caller', text: "I've got a rental property in Clapham, my tenant said the boiler stopped working." },
      { speaker: 'agent', text: 'Is this a property you own?' },
      { speaker: 'caller', text: "Yeah, buy to let. I'm the owner." },
    ],
  ],
  expectedProgressiveSegments: [
    null, // Not enough info yet
    'LANDLORD', // rental property detected
    'LANDLORD', // confirmed with tenant
    'LANDLORD', // confirmed with buy to let
  ],
  expectedProgressiveConfidence: [
    0,
    0.4,
    0.7,
    0.95,
  ],
};

export default TRANSCRIPT_FIXTURES;
