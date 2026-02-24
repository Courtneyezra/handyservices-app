/**
 * Segment Signal Test Cases for Call Script Tube Map
 *
 * These fixtures test the segment classifier's ability to detect
 * segment signals from individual phrases and keywords.
 *
 * Each segment has:
 * - shouldMatch: phrases that should trigger this segment
 * - shouldNotMatch: phrases that should NOT trigger this segment
 * - weakSignals: phrases that suggest but don't confirm the segment
 * - strongSignals: phrases that strongly indicate this segment
 */

export interface SegmentSignalTest {
  shouldMatch: string[];
  shouldNotMatch: string[];
  weakSignals?: string[];
  strongSignals?: string[];
  disqualifyingSignals?: string[];
}

export const SEGMENT_SIGNAL_TESTS: Record<string, SegmentSignalTest> = {
  LANDLORD: {
    shouldMatch: [
      'I have a rental property',
      'my tenant called me',
      "it's a buy to let",
      "I'm not local to the property",
      'I own a flat that I rent out',
      'my rental in Brixton',
      'the tenant reported a leak',
      "I can't be there, I live in Manchester",
      'investment property needs work',
      'my BTL property',
      'I landlord a few places',
      'send me photos when done',
    ],
    shouldNotMatch: [
      'I live there myself',
      "it's my home",
      "I'll be there all day",
      "I'm the tenant actually",
      'I rent this place',
      "I'm looking for a flat to rent",
    ],
    weakSignals: [
      "I won't be there",
      "can someone coordinate access",
      'the property is in SW11',
    ],
    strongSignals: [
      'buy to let',
      'my tenant',
      'rental property',
      'I landlord',
      'investment property',
    ],
    disqualifyingSignals: [
      'I live there',
      "I'm the tenant",
      "it's my home",
      "I'm renting",
    ],
  },

  BUSY_PRO: {
    shouldMatch: [
      "I'm at work so can't be there",
      'I have a key safe',
      "I've got a busy schedule",
      "won't be home during the day",
      "can someone come when I'm not there",
      "I work long hours",
      "my schedule is packed this week",
      "I'm in back-to-back meetings",
      "just need it sorted while I'm out",
      "neighbour can let you in",
    ],
    shouldNotMatch: [
      "I'll be here all day",
      'I work from home',
      "I'm retired",
      "I'll wait in for you",
      "I'm always home",
      "I'm a stay at home mum",
    ],
    weakSignals: [
      "I'm quite busy",
      'need it done quickly',
      "don't have much time",
    ],
    strongSignals: [
      'key safe',
      "at work all day",
      "won't be home",
      'busy schedule',
    ],
    disqualifyingSignals: [
      'I work from home',
      "I'm retired",
      "I'm always available",
    ],
  },

  OAP: {
    shouldMatch: [
      'I live alone',
      'I want to make sure whoever comes is trustworthy',
      'my daughter usually helps me',
      "I can't manage the ladder anymore",
      "I'm 75 years old",
      'my son said I should get someone in',
      "my knees aren't what they used to be",
      'are your people DBS checked',
      "I'd like to meet them first",
      "I'm a pensioner",
    ],
    shouldNotMatch: [
      "I'm quite handy myself",
      "I'll do it myself if you can't come today",
      "I'm in a rush",
      "just give me a price",
    ],
    weakSignals: [
      'I need someone reliable',
      'can you send the same person',
      "I'd like someone patient",
    ],
    strongSignals: [
      'live alone',
      "can't manage",
      'trustworthy',
      'DBS checked',
      'meet them first',
      'pensioner',
      'my son/daughter helps',
    ],
    disqualifyingSignals: [
      "I'll do it myself",
      "I'm quite capable",
      'just need a quick job',
    ],
  },

  PROP_MGR: {
    shouldMatch: [
      'I manage 15 properties',
      "I'm calling from an agency",
      'we need a contractor on our books',
      'need proper invoices for our records',
      "I'm a property manager",
      'our portfolio needs',
      'we look after several properties',
      'we need someone we can call regularly',
      "we're a lettings agency",
      'tenant coordination would be helpful',
    ],
    shouldNotMatch: [
      'I own one rental',
      "it's my property",
      'I live there',
      'just need a one-off job',
    ],
    weakSignals: [
      'need invoices',
      'quick response time',
      'professional service',
    ],
    strongSignals: [
      'manage properties',
      'agency',
      'portfolio',
      'property manager',
      'lettings agency',
      'contractor on our books',
    ],
    disqualifyingSignals: [
      'just one property',
      "my own place",
      "I'm the owner myself",
    ],
  },

  SMALL_BIZ: {
    shouldMatch: [
      "I've got a restaurant",
      'need work done after hours',
      "can't have noise during service",
      "I've got a shop on the high street",
      "we're a small business",
      "need it done before we open",
      "customers can't see workmen",
      "I run a cafe",
      "work needs to be done when we're closed",
      "need minimal disruption to trading",
    ],
    shouldNotMatch: [
      "it's my home office",
      'I work from home',
      'residential property',
    ],
    weakSignals: [
      'business premises',
      'commercial property',
      'office space',
    ],
    strongSignals: [
      'restaurant',
      'shop',
      'cafe',
      'after hours',
      'before we open',
      'customers',
      'trading',
      'small business',
    ],
    disqualifyingSignals: [
      'home office',
      'residential',
      'my house',
    ],
  },

  EMERGENCY: {
    shouldMatch: [
      'water coming through the ceiling',
      'pipe has burst',
      'flooding the kitchen',
      "there's sparks coming from the socket",
      "I can smell gas",
      'the ceiling is about to fall down',
      "toilet won't stop overflowing",
      "can someone come right now",
      "it's an emergency",
      "I've turned the water off but it's still leaking",
    ],
    shouldNotMatch: [
      'small drip from the tap',
      "it's been leaking for weeks",
      "not urgent, whenever you can",
      "no rush on this",
      "when you get a chance",
    ],
    weakSignals: [
      'can someone come today',
      "it's quite urgent",
      'sooner the better',
    ],
    strongSignals: [
      'burst pipe',
      'flooding',
      'sparks',
      'gas smell',
      'overflowing',
      'emergency',
      'right now',
      'ceiling falling',
    ],
    disqualifyingSignals: [
      "no rush",
      "whenever you can",
      "been like this for weeks",
    ],
  },

  BUDGET: {
    shouldMatch: [
      'how much per hour',
      'what do you charge',
      'can you beat this quote',
      "I'm looking for the cheapest option",
      'someone else quoted me 50 quid',
      "I'm on a tight budget",
      "I can't afford much",
      "what's your best price",
      "I've got 3 other quotes",
      "that's too expensive",
    ],
    shouldNotMatch: [
      'I want it done properly',
      "price isn't the main concern",
      'I want quality work',
      "I'll pay extra for good service",
      "don't care about the cost",
    ],
    weakSignals: [
      'how much roughly',
      'what kind of price',
      "what's the damage",
    ],
    strongSignals: [
      'cheapest',
      'beat this price',
      'tight budget',
      'hourly rate',
      'other quotes',
      "can't afford",
    ],
    disqualifyingSignals: [
      'done properly',
      'quality work',
      "price doesn't matter",
    ],
  },

  DIY_DEFERRER: {
    shouldMatch: [
      "I've got a list of jobs",
      'been meaning to do it myself',
      'never got round to it',
      "I kept putting it off",
      "I tried to fix it but made it worse",
      "watched a YouTube video but",
      "I bought the parts but never fitted them",
      "it's been on my to-do list for months",
      "I started it but couldn't finish",
      "too many jobs piling up",
    ],
    shouldNotMatch: [
      'I know exactly what I want',
      "I've done this before",
      "I'm quite handy",
      'just need this one thing',
    ],
    weakSignals: [
      'a few jobs that need doing',
      "been meaning to call someone",
      "should probably get someone in",
    ],
    strongSignals: [
      'list of jobs',
      'never got round to it',
      'tried myself',
      'made it worse',
      'YouTube video',
      'to-do list',
      'piling up',
    ],
    disqualifyingSignals: [
      'just one job',
      'I know what I want',
      "I'm quite capable",
    ],
  },
};

/**
 * Tests for phrase patterns that should trigger specific behaviors
 */
export const BEHAVIOR_TRIGGER_TESTS = {
  // Phrases that should trigger immediate segment re-evaluation
  segmentClarification: [
    { input: "Actually, it's my own home, I live there", shouldClear: ['LANDLORD', 'PROP_MGR'] },
    { input: "I'm the tenant, not the owner", shouldClear: ['LANDLORD'] },
    { input: "I work from home actually", shouldClear: ['BUSY_PRO'] },
    { input: "No rush, whenever you can", shouldClear: ['EMERGENCY'] },
    { input: "I want it done properly, not just cheap", shouldClear: ['BUDGET'] },
  ],

  // Phrases that indicate caller is NOT the decision maker
  notDecisionMaker: [
    "I'm just getting quotes for my boss",
    "my husband will decide",
    "I need to check with my landlord",
    "I'll have to ask the owner",
    "I'm calling on behalf of",
    "my manager asked me to call",
  ],

  // Phrases that indicate caller IS the decision maker
  isDecisionMaker: [
    "I'm the owner",
    "it's my property",
    "I make the decisions",
    "yes, I can approve that",
    "that's my call to make",
    "I own the place",
  ],

  // Phrases that indicate access method
  accessMethods: {
    keyInPlace: [
      "there's a key under the mat",
      "key is in the lockbox",
      "I'll leave a key with the neighbour",
      "I have a key safe",
      "there's a coded entry",
    ],
    needsCoordination: [
      "you'll need to call the tenant",
      "my neighbour can let you in",
      "the concierge has a key",
      "I'll get someone to meet you",
      "the letting agent can give access",
    ],
    willBePresent: [
      "I'll be there",
      "I can let you in",
      "I'll wait in",
      "I work from home",
      "I'm always there",
    ],
  },

  // Phrases indicating urgency level
  urgencyIndicators: {
    emergency: [
      "right now",
      "immediately",
      "it's flooding",
      "burst pipe",
      "sparks",
      "gas leak",
      "can't wait",
    ],
    urgent: [
      "today if possible",
      "as soon as you can",
      "this week",
      "quite urgent",
      "sooner the better",
    ],
    flexible: [
      "whenever suits",
      "no rush",
      "when you get a chance",
      "next week is fine",
      "flexible on timing",
    ],
  },
};

/**
 * Compound signal tests - multiple signals in one utterance
 */
export const COMPOUND_SIGNAL_TESTS = [
  {
    input: "I've got a rental property and my tenant reported a leak",
    expectedSegments: ['LANDLORD'],
    expectedSignals: ['rental property', 'tenant', 'leak'],
  },
  {
    input: "I'm at work all day but I have a key safe, so you can let yourself in",
    expectedSegments: ['BUSY_PRO'],
    expectedSignals: ['at work', 'key safe'],
  },
  {
    input: "I manage about 20 properties for a letting agency and we need reliable contractors",
    expectedSegments: ['PROP_MGR'],
    expectedSignals: ['manage properties', 'letting agency', 'contractors'],
  },
  {
    input: "I live alone and I can't manage ladders anymore, so I need someone trustworthy",
    expectedSegments: ['OAP'],
    expectedSignals: ['live alone', "can't manage", 'trustworthy'],
  },
  {
    input: "There's water pouring through my ceiling and I need someone right now!",
    expectedSegments: ['EMERGENCY'],
    expectedSignals: ['water', 'ceiling', 'right now'],
  },
  {
    input: "How much per hour? Someone else quoted me cheaper and I'm on a tight budget",
    expectedSegments: ['BUDGET'],
    expectedSignals: ['per hour', 'cheaper', 'tight budget'],
  },
];

/**
 * Conflicting signal tests - signals from multiple segments
 */
export const CONFLICTING_SIGNAL_TESTS = [
  {
    input: "I have a rental property but I actually live there myself",
    expectedSegment: 'BUSY_PRO', // Live there overrides rental
    reasoning: 'Clarification "live there myself" overrides rental property signal',
  },
  {
    input: "I manage 3 properties for myself, they're all mine",
    expectedSegment: 'LANDLORD', // Owner, not agency
    reasoning: 'Self-ownership suggests individual landlord not property manager',
  },
  {
    input: "My tenant reported the issue but I'm on a really tight budget",
    expectedSegment: 'LANDLORD', // Tenant signal is stronger for routing
    reasoning: 'Landlord-tenant relationship takes priority for service routing',
  },
  {
    input: "I tried to fix it myself but now it's an emergency - water everywhere!",
    expectedSegment: 'EMERGENCY', // Emergency takes priority
    reasoning: 'Emergency status always takes routing priority',
  },
];

/**
 * Segment confidence threshold tests
 * Tests that segments should only be assigned above certain confidence levels
 */
export const CONFIDENCE_THRESHOLD_TESTS = [
  {
    signals: ['rental property'],
    segment: 'LANDLORD',
    expectedMinConfidence: 0.3,
    expectedMaxConfidence: 0.5,
    note: 'Single signal should not give high confidence',
  },
  {
    signals: ['rental property', 'tenant', 'buy to let'],
    segment: 'LANDLORD',
    expectedMinConfidence: 0.8,
    expectedMaxConfidence: 1.0,
    note: 'Multiple strong signals should give high confidence',
  },
  {
    signals: ['at work'],
    segment: 'BUSY_PRO',
    expectedMinConfidence: 0.2,
    expectedMaxConfidence: 0.4,
    note: 'Single weak signal should give low confidence',
  },
  {
    signals: ['at work', 'key safe', "won't be home"],
    segment: 'BUSY_PRO',
    expectedMinConfidence: 0.85,
    expectedMaxConfidence: 1.0,
    note: 'Multiple signals including key access should give high confidence',
  },
];

export default SEGMENT_SIGNAL_TESTS;
