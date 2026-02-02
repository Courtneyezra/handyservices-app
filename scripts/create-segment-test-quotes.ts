/**
 * Create test quotes for all segments to verify pricing strategy implementation
 * Run with: npx tsx scripts/create-segment-test-quotes.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5001';

interface QuoteInput {
  customerName: string;
  phone: string;
  email?: string;
  postcode: string;
  address?: string;
  jobDescription: string;
  baseJobPrice: number;
  urgencyReason: 'low' | 'med' | 'high';
  ownershipContext: 'tenant' | 'homeowner' | 'landlord' | 'airbnb' | 'selling';
  desiredTimeframe: 'flex' | 'week' | 'asap';
  quoteMode: 'hhh';
  clientType: 'residential' | 'commercial';
  manualSegment: string;
  tierStandardPrice?: number;
  tierPriorityPrice?: number;
  tierEmergencyPrice?: number;
}

const SEGMENT_TEST_DATA: Record<string, QuoteInput> = {
  BUSY_PRO: {
    customerName: 'Sarah Thompson',
    phone: '07700900001',
    email: 'sarah.thompson@example.com',
    postcode: 'NG1 5FW',
    address: '15 High Street, Nottingham',
    jobDescription: 'Need a TV mounted on the wall in the living room. Samsung 55" LED. Wall is plasterboard.',
    baseJobPrice: 15000, // £150 in pence
    urgencyReason: 'high',
    ownershipContext: 'homeowner',
    desiredTimeframe: 'asap',
    quoteMode: 'hhh',
    clientType: 'residential',
    manualSegment: 'BUSY_PRO',
    tierStandardPrice: 12500,
    tierPriorityPrice: 16900,
    tierEmergencyPrice: 21900,
  },
  PROP_MGR: {
    customerName: 'David Williams - ABC Lettings',
    phone: '07700900002',
    email: 'david@abclettings.com',
    postcode: 'NG7 2QP',
    address: '42 Park Avenue, Nottingham',
    jobDescription: 'Tenant reported leaky tap in kitchen. Need fixed ASAP. Property is HMO with 4 tenants.',
    baseJobPrice: 12000, // £120 in pence
    urgencyReason: 'high',
    ownershipContext: 'landlord',
    desiredTimeframe: 'week',
    quoteMode: 'hhh',
    clientType: 'commercial',
    manualSegment: 'PROP_MGR',
    tierStandardPrice: 12000,
    tierPriorityPrice: 15000,
    tierEmergencyPrice: 19500,
  },
  SMALL_BIZ: {
    customerName: 'The Coffee House',
    phone: '07700900003',
    email: 'manager@coffeehouse.co.uk',
    postcode: 'NG1 6JE',
    address: '8 Market Square, Nottingham',
    jobDescription: 'Need shelving installed in stockroom. 4 heavy-duty shelves. Must be done after 6pm when we close.',
    baseJobPrice: 28000, // £280 in pence
    urgencyReason: 'med',
    ownershipContext: 'homeowner', // Business owner
    desiredTimeframe: 'week',
    quoteMode: 'hhh',
    clientType: 'commercial',
    manualSegment: 'SMALL_BIZ',
    tierStandardPrice: 25000,
    tierPriorityPrice: 32000,
    tierEmergencyPrice: 42000,
  },
  DIY_DEFERRER: {
    customerName: 'Mike Roberts',
    phone: '07700900004',
    email: 'mike.r@gmail.com',
    postcode: 'NG5 1AB',
    address: '27 Maple Road, Arnold',
    jobDescription: 'Got a list of jobs: 1) Hang 3 pictures in hallway, 2) Fix squeaky door in bedroom, 3) Put up floating shelf in bathroom. Been meaning to do these for ages!',
    baseJobPrice: 18000, // £180 in pence
    urgencyReason: 'low',
    ownershipContext: 'homeowner',
    desiredTimeframe: 'flex',
    quoteMode: 'hhh',
    clientType: 'residential',
    manualSegment: 'DIY_DEFERRER',
    tierStandardPrice: 15000,
    tierPriorityPrice: 19500,
    tierEmergencyPrice: 25000,
  },
  BUDGET: {
    customerName: 'Emma Johnson',
    phone: '07700900005',
    email: 'emma.j@yahoo.com',
    postcode: 'NG3 4CD',
    address: '103 Valley Road, Mapperley',
    jobDescription: 'Need a curtain rail fitted in the living room. Basic job, just need it done properly.',
    baseJobPrice: 8500, // £85 in pence
    urgencyReason: 'low',
    ownershipContext: 'tenant',
    desiredTimeframe: 'flex',
    quoteMode: 'hhh',
    clientType: 'residential',
    manualSegment: 'BUDGET',
    tierStandardPrice: 8500,
    tierPriorityPrice: 11000,
    tierEmergencyPrice: 14000,
  },
  OLDER_WOMAN: {
    customerName: 'Margaret Wilson',
    phone: '07700900006',
    email: 'margaret.w@btinternet.com',
    postcode: 'NG4 2EF',
    address: '56 Rose Lane, Carlton',
    jobDescription: 'Need someone reliable to fix the kitchen tap - it keeps dripping. Also the bathroom light needs a new bulb but I cant reach it safely.',
    baseJobPrice: 14000, // £140 in pence
    urgencyReason: 'med',
    ownershipContext: 'homeowner',
    desiredTimeframe: 'week',
    quoteMode: 'hhh',
    clientType: 'residential',
    manualSegment: 'OLDER_WOMAN',
    tierStandardPrice: 12000,
    tierPriorityPrice: 16000,
    tierEmergencyPrice: 21000,
  },
};

async function createQuote(segment: string, data: QuoteInput): Promise<{ success: boolean; slug?: string; error?: string }> {
  try {
    const response = await fetch(`${BASE_URL}/api/personalized-quotes/value`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    return { success: true, slug: result.shortSlug };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Creating Test Quotes for All Segments');
  console.log('='.repeat(60));
  console.log(`Server: ${BASE_URL}`);
  console.log('');

  const results: { segment: string; url: string | null; error?: string }[] = [];

  for (const [segment, data] of Object.entries(SEGMENT_TEST_DATA)) {
    console.log(`Creating quote for ${segment}...`);
    const result = await createQuote(segment, data);

    if (result.success && result.slug) {
      const url = `${BASE_URL}/quote-link/${result.slug}`;
      results.push({ segment, url });
      console.log(`  OK: ${url}`);
    } else {
      results.push({ segment, url: null, error: result.error });
      console.log(`  ERROR: ${result.error}`);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY - Test Quote URLs');
  console.log('='.repeat(60));
  console.log('');

  for (const result of results) {
    if (result.url) {
      console.log(`${result.segment.padEnd(15)} ${result.url}`);
    } else {
      console.log(`${result.segment.padEnd(15)} FAILED: ${result.error}`);
    }
  }

  console.log('');
  console.log('Copy these URLs to test in your browser.');
}

main().catch(console.error);
