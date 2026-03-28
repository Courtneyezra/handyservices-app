/**
 * Quote Matrix Test — 100 scenarios
 *
 * Calls /api/pricing/multi-quote (no DB writes) across a wide spread of:
 *   - Customer types: homeowner, landlord, property manager, small biz, returning
 *   - Job categories: all 16+ categories, single and multi-line
 *   - vaContext lengths: none, minimal, short, medium, long, noisy
 *   - Urgency: standard, priority, emergency
 *   - Timing: standard, after_hours, weekend
 *   - Materials: labor_only, we_supply, customer_supplied
 *
 * Scores each quote on 4 dimensions (0–3 each, max 12 per quote):
 *   1. Headline relevance   — specific to job, not generic
 *   2. Message tone match   — urgency/landlord/returning signals reflected
 *   3. Bullet alignment     — context-appropriate claims selected
 *   4. Price sanity         — within expected range for job type + time
 *
 * Output: terminal summary + /tmp/quote-matrix-results.json
 */

import { writeFileSync } from 'fs';

const BASE_URL = 'http://localhost:49551';
const BATCH_SIZE = 10; // parallel requests per batch
const RESULTS_FILE = '/tmp/quote-matrix-results.json';

// ─── Reference price ranges (pence) per category × 30min ──────────────────
// Calibrated to match the engine's actual hourly rates (hourlyRate / 2 = per 30min).
// The scoring applies a 0.7 factor on top, so the effective floor = 70% of reference price.
const PRICE_FLOOR = {
  general_fixing: 1500, flat_pack: 1400, tv_mounting: 1750, carpentry: 2000,
  plumbing_minor: 2250, electrical_minor: 2500, painting: 1500, tiling: 2000,
  plastering: 2000, lock_change: 2500, guttering: 1750, pressure_washing: 1500,
  fencing: 1750, garden_maintenance: 1250, silicone_sealant: 1250, shelving: 1500,
  door_fitting: 1750, flooring: 1500, curtain_blinds: 1500, furniture_repair: 1500,
  waste_removal: 1250, bathroom_fitting: 2500, kitchen_fitting: 2500, other: 1750,
};

// ─── 100 Test Scenarios ────────────────────────────────────────────────────

const SCENARIOS = [

  // ── HOMEOWNER / DIY DEFERRER ────────────────────────────────────────────

  { id:'H01', label:'Homeowner — simple tap, no context',
    customerType:'homeowner', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Dripping kitchen tap, needs new washer',category:'plumbing_minor',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H02', label:'Homeowner — flat pack assembly, minimal context',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Customer has IKEA boxes in living room, wants it sorted this week.',
      lines:[{id:'l1',description:'Assemble IKEA PAX wardrobe (2-door)',category:'flat_pack',timeEstimateMinutes:120}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H03', label:'Homeowner — TV mount, customer has bracket',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Wants 55 inch TV on the wall. Has the bracket already. Ground floor flat, easy access.',
      lines:[{id:'l1',description:'Wall mount 55" TV, customer has bracket',category:'tv_mounting',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H04', label:'Homeowner — painting, full room touch-up',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Wants living room walls touched up after moving furniture. Customer supplies paint. Flexible timing.',
      lines:[{id:'l1',description:'Touch-up paint on living room walls — customer supplies paint',category:'painting',timeEstimateMinutes:150}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H05', label:'Homeowner — lock change, security concern',
    customerType:'homeowner', urgencyType:'priority',
    body:{ vaContext:'Just moved in to a new house. Wants all exterior locks changed as soon as possible for peace of mind.',
      lines:[{id:'l1',description:'Replace front door lock',category:'lock_change',timeEstimateMinutes:45},
             {id:'l2',description:'Replace back door lock',category:'lock_change',timeEstimateMinutes:45}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H06', label:'Homeowner — bathroom silicone, mouldy',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Bath silicone is black and peeling. Customer said it looks terrible. Flexible timing.',
      lines:[{id:'l1',description:'Remove old silicone around bath and apply fresh anti-mould bead',category:'silicone_sealant',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H07', label:'Homeowner — multi-job batch, 3 small fixes',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Has a list of small jobs that have been piling up. Wants them all done in one visit. Very flexible on dates.',
      lines:[{id:'l1',description:'Fix loose door handle on bedroom door',category:'general_fixing',timeEstimateMinutes:20},
             {id:'l2',description:'Hang 2 floating shelves in hallway',category:'shelving',timeEstimateMinutes:40},
             {id:'l3',description:'Reattach towel rail in bathroom',category:'general_fixing',timeEstimateMinutes:15}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H08', label:'Homeowner — flooring, small area kitchen',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Kitchen vinyl is lifting and cracking. Has already bought replacement LVT tiles from B&Q.',
      lines:[{id:'l1',description:'Remove old vinyl and lay new LVT tiles in kitchen (approx 8sqm)',category:'flooring',timeEstimateMinutes:180}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H09', label:'Homeowner — fence panel storm damage, urgent',
    customerType:'homeowner', urgencyType:'priority',
    body:{ vaContext:'Storm blew over two fence panels. Neighbour is annoyed. Needs it sorted this week. Has a dog.',
      lines:[{id:'l1',description:'Replace 2 blown fence panels and reset posts',category:'fencing',timeEstimateMinutes:180}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'H10', label:'Homeowner — pressure washing driveway',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Driveway is covered in algae. Wants it cleaned before family visit next weekend.',
      lines:[{id:'l1',description:'Pressure wash block paved driveway (approx 40sqm)',category:'pressure_washing',timeEstimateMinutes:180}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'weekend',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── LANDLORD (ABSENTEE) ─────────────────────────────────────────────────

  { id:'L01', label:'Landlord — tap repair, not on site, wants photos',
    customerType:'landlord', urgencyType:'standard',
    body:{ vaContext:'Landlord based in Manchester. Tenant has reported a dripping kitchen tap. He cannot attend. Wants photos sent when done.',
      lines:[{id:'l1',description:'Replace dripping kitchen tap washer',category:'plumbing_minor',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'L02', label:'Landlord — emergency boiler area leak',
    customerType:'landlord', urgencyType:'emergency',
    body:{ vaContext:'Landlord called urgently. Tenant says water coming from under the boiler cupboard. Landlord is 2hrs away and cannot get there. Tenant is elderly and panicking.',
      lines:[{id:'l1',description:'Emergency leak investigation under boiler cupboard',category:'plumbing_minor',timeEstimateMinutes:60}],
      signals:{urgency:'emergency',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'L03', label:'Landlord — end of tenancy touch-up, 3 jobs',
    customerType:'landlord', urgencyType:'standard',
    body:{ vaContext:'Tenant is leaving end of month. Landlord needs property spruced up. He\'ll coordinate key handover. Wants invoice for his accountant.',
      lines:[{id:'l1',description:'Touch-up scuffed walls in hallway and bedroom',category:'painting',timeEstimateMinutes:120},
             {id:'l2',description:'Replace cracked bathroom tile and regrout',category:'tiling',timeEstimateMinutes:90},
             {id:'l3',description:'Fix stiff kitchen door hinge',category:'carpentry',timeEstimateMinutes:30}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'L04', label:'Landlord — lock change after tenant left',
    customerType:'landlord', urgencyType:'priority',
    body:{ vaContext:'Tenant left yesterday. Landlord wants the locks changed before new tenant moves in on Friday. He\'ll drop the key off or can leave under the mat.',
      lines:[{id:'l1',description:'Change front door lock, post new keys through letterbox',category:'lock_change',timeEstimateMinutes:45}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'L05', label:'Landlord — full bathroom re-seal, between tenancies',
    customerType:'landlord', urgencyType:'standard',
    body:{ vaContext:'Property is empty between lets. Landlord wants the bathroom sorted — silicone is mouldy and there\'s a dripping tap. No tenants so flexible access.',
      lines:[{id:'l1',description:'Re-silicone bath and shower cubicle',category:'silicone_sealant',timeEstimateMinutes:60},
             {id:'l2',description:'Fix dripping bathroom basin tap',category:'plumbing_minor',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'L06', label:'Landlord — HMO, multiple small jobs across rooms',
    customerType:'landlord', urgencyType:'standard',
    body:{ vaContext:'HMO landlord with 6-bed property. Needs small maintenance round: 3 door handles replaced, a towel rail fixed, and a shelf mounted in one of the rooms. Key is with the letting agent next door.',
      lines:[{id:'l1',description:'Replace 3 bedroom door handles',category:'general_fixing',timeEstimateMinutes:30},
             {id:'l2',description:'Fix loose towel rail in bathroom 2',category:'general_fixing',timeEstimateMinutes:15},
             {id:'l3',description:'Mount shelf in room 4',category:'shelving',timeEstimateMinutes:25}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'L07', label:'Landlord — gutter clearing before winter, no access needed',
    customerType:'landlord', urgencyType:'standard',
    body:{ vaContext:'Landlord lives in Spain. Tenant has reported gutters overflowing. Key not needed — gutters are accessible from outside. Wants confirmation photo when done.',
      lines:[{id:'l1',description:'Clear blocked gutters on 3-bed semi, front and back',category:'guttering',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'L08', label:'Landlord — carpet deep clean before viewings',
    customerType:'landlord', urgencyType:'priority',
    body:{ vaContext:'Landlord has viewings next week. Carpets are stained from old tenants. Wants professional clean — not replacement. Must be done by Thursday.',
      lines:[{id:'l1',description:'Professional carpet clean, 3-bed house (3 bedrooms + hallway)',category:'other',timeEstimateMinutes:180}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── PROPERTY MANAGER (PORTFOLIO) ────────────────────────────────────────

  { id:'PM01', label:'Property manager — 3 jobs, one property',
    customerType:'property_manager', urgencyType:'standard',
    body:{ vaContext:'James manages 12 properties around Nottingham. This visit is to one flat in Beeston. Needs a tap replaced, a broken hinge fixed, and cracked tile sorted. Maintenance team will provide access. Tax-ready invoice required for records.',
      lines:[{id:'l1',description:'Replace bathroom cold tap',category:'plumbing_minor',timeEstimateMinutes:45},
             {id:'l2',description:'Repair broken kitchen door hinge',category:'carpentry',timeEstimateMinutes:30},
             {id:'l3',description:'Replace cracked wall tile and regrout',category:'tiling',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'PM02', label:'Property manager — emergency pipe burst at rental',
    customerType:'property_manager', urgencyType:'emergency',
    body:{ vaContext:'Sarah manages 30+ properties. Pipe burst in one of her Wollaton flats. Tenant is at work and she cannot be there. Needs EMERGENCY response. Send photos and invoice immediately.',
      lines:[{id:'l1',description:'Emergency burst pipe repair — trace, isolate, fix',category:'plumbing_minor',timeEstimateMinutes:90}],
      signals:{urgency:'emergency',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'PM03', label:'Property manager — routine maintenance round, 5 jobs',
    customerType:'property_manager', urgencyType:'standard',
    body:{ vaContext:'Quarterly maintenance visit to the Radford portfolio. 5 small jobs across 2 flats in the same block. Caretaker will provide access. Needs consolidated invoice for bookkeeping.',
      lines:[{id:'l1',description:'Fix squeaky door on flat 2 entrance',category:'carpentry',timeEstimateMinutes:30},
             {id:'l2',description:'Bleed radiators in flat 3 (3 radiators)',category:'plumbing_minor',timeEstimateMinutes:30},
             {id:'l3',description:'Replace extractor fan in flat 2 bathroom',category:'electrical_minor',timeEstimateMinutes:60},
             {id:'l4',description:'Hang 2 mirrors in flat 3 hallway',category:'general_fixing',timeEstimateMinutes:30},
             {id:'l5',description:'Touch-up scuffs on stairwell walls',category:'painting',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'PM04', label:'Property manager — after-hours boiler cupboard fix',
    customerType:'property_manager', urgencyType:'priority',
    body:{ vaContext:'Property manager needs electrical work done at a student HMO during daytime when students are out. Priority but not emergency. Must be done outside peak hours.',
      lines:[{id:'l1',description:'Replace faulty socket in kitchen and check consumer unit',category:'electrical_minor',timeEstimateMinutes:90}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'after_hours',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── SMALL BUSINESS ──────────────────────────────────────────────────────

  { id:'B01', label:'Cafe owner — sockets for new equipment, weekend',
    customerType:'small_biz', urgencyType:'priority',
    body:{ vaContext:'Marco runs a small Italian cafe on Mansfield Road. Just bought a new commercial espresso machine and needs extra sockets behind the counter. Must be done Saturday evening after closing at 5pm.',
      lines:[{id:'l1',description:'Install 2 double sockets behind cafe counter',category:'electrical_minor',timeEstimateMinutes:90}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'weekend',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'B02', label:'Retail unit — shelving installation',
    customerType:'small_biz', urgencyType:'standard',
    body:{ vaContext:'New shop opening on Hockley. Needs heavy duty shelving mounted on the main display wall before opening day next Tuesday.',
      lines:[{id:'l1',description:'Mount 4 heavy-duty wall brackets and shelves in retail unit',category:'shelving',timeEstimateMinutes:120}],
      signals:{urgency:'priority',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'B03', label:'Office — blinds and curtain rail install',
    customerType:'small_biz', urgencyType:'standard',
    body:{ vaContext:'Small accountancy firm just moved into new offices. Needs 6 window blinds installed across two rooms. Customer has already bought the blinds.',
      lines:[{id:'l1',description:'Install 6 window blinds in office space',category:'curtain_blinds',timeEstimateMinutes:120}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'B04', label:'Restaurant — after-hours emergency fix',
    customerType:'small_biz', urgencyType:'emergency',
    body:{ vaContext:'Restaurant owner. Kitchen door handle snapped off and door won\'t close properly. Health inspector coming tomorrow morning. Needs it fixed tonight after service ends at 11pm.',
      lines:[{id:'l1',description:'Replace broken commercial kitchen door handle and mechanism',category:'general_fixing',timeEstimateMinutes:45}],
      signals:{urgency:'emergency',materialsSupply:'we_supply',timeOfService:'after_hours',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── RETURNING CUSTOMERS ─────────────────────────────────────────────────

  { id:'R01', label:'Returning customer — 2nd job, tap washer',
    customerType:'returning', urgencyType:'standard',
    body:{ vaContext:'Dave called again — he used us last month for a shelf installation and was happy. Now has a dripping bathroom tap.',
      lines:[{id:'l1',description:'Replace dripping bathroom tap washer',category:'plumbing_minor',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:true,previousJobCount:1,previousAvgPricePence:8500} }},

  { id:'R02', label:'Returning customer — 5th job, batch visit',
    customerType:'returning', urgencyType:'standard',
    body:{ vaContext:'Maria is a loyal customer. This is her 5th booking. Needs a flat pack desk assembled and two picture frames hung.',
      lines:[{id:'l1',description:'Assemble flat pack desk (IKEA MICKE)',category:'flat_pack',timeEstimateMinutes:90},
             {id:'l2',description:'Hang 2 heavy picture frames with wall anchors',category:'general_fixing',timeEstimateMinutes:30}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:true,previousJobCount:4,previousAvgPricePence:9500} }},

  { id:'R03', label:'Returning landlord — 3rd job, routine visit',
    customerType:'returning', urgencyType:'standard',
    body:{ vaContext:'Returning landlord. Third time using us. Has another rental property needing maintenance — bath seal and a stiff door.',
      lines:[{id:'l1',description:'Re-seal bath with anti-mould silicone',category:'silicone_sealant',timeEstimateMinutes:45},
             {id:'l2',description:'Plane and re-hang stiff bathroom door',category:'door_fitting',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:true,previousJobCount:2,previousAvgPricePence:11000} }},

  // ── EMERGENCY SCENARIOS ─────────────────────────────────────────────────

  { id:'E01', label:'Emergency — burst pipe, homeowner panicking',
    customerType:'homeowner', urgencyType:'emergency',
    body:{ vaContext:'Sarah called in panic. Water coming through her living room ceiling. She thinks it\'s from the bathroom above. Home alone. Water spreading fast.',
      lines:[{id:'l1',description:'Emergency leak investigation and repair — ceiling access likely needed',category:'plumbing_minor',timeEstimateMinutes:90}],
      signals:{urgency:'emergency',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'E02', label:'Emergency — flooded kitchen, landlord',
    customerType:'landlord', urgencyType:'emergency',
    body:{ vaContext:'Landlord. Tenant called saying water is pouring from under the kitchen sink. Landlord is abroad. Need someone there within 2 hours.',
      lines:[{id:'l1',description:'Emergency kitchen sink leak — trace and repair',category:'plumbing_minor',timeEstimateMinutes:60}],
      signals:{urgency:'emergency',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'E03', label:'Emergency — no heating in winter',
    customerType:'homeowner', urgencyType:'emergency',
    body:{ vaContext:'Elderly customer. Boiler pressure dropped and radiators are cold. It\'s freezing. Her daughter called on her behalf. Needs someone today.',
      lines:[{id:'l1',description:'Re-pressurise boiler and bleed all radiators',category:'plumbing_minor',timeEstimateMinutes:60}],
      signals:{urgency:'emergency',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'E04', label:'Emergency — broken lock, security risk',
    customerType:'homeowner', urgencyType:'emergency',
    body:{ vaContext:'Front door lock snapped and won\'t secure. Customer is a young woman living alone and is scared to leave the house. Needs a locksmith today.',
      lines:[{id:'l1',description:'Emergency front door lock replacement',category:'lock_change',timeEstimateMinutes:45}],
      signals:{urgency:'emergency',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── MINIMAL / NO CONTEXT ────────────────────────────────────────────────

  { id:'M01', label:'No context — single painting job',
    customerType:'unknown', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Paint hallway and landing walls',category:'painting',timeEstimateMinutes:180}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'M02', label:'No context — tiling bathroom floor',
    customerType:'unknown', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Tile bathroom floor with customer-supplied tiles (4sqm)',category:'tiling',timeEstimateMinutes:240}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'M03', label:'No context — carpentry, door hang',
    customerType:'unknown', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Hang new internal door — frame already in place',category:'door_fitting',timeEstimateMinutes:120}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'M04', label:'No context — garden shed assembly',
    customerType:'unknown', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Assemble wooden garden shed from flat pack (8x6ft)',category:'garden_maintenance',timeEstimateMinutes:240}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'M05', label:'No context — plastering patch',
    customerType:'unknown', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Patch plaster around removed radiator bracket',category:'plastering',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── WEEKEND / AFTER-HOURS ───────────────────────────────────────────────

  { id:'AH01', label:'After-hours — office socket install',
    customerType:'small_biz', urgencyType:'priority',
    body:{ vaContext:'IT company needs new server room sockets installed. Can only be done on a Sunday when no staff are in.',
      lines:[{id:'l1',description:'Install 4 new double sockets in server room',category:'electrical_minor',timeEstimateMinutes:120}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'weekend',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'AH02', label:'Weekend — homeowner, flat pack Saturday',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Customer works Monday-Friday. Can only have work done on a Saturday. Has 2 IKEA Billy bookcases to assemble.',
      lines:[{id:'l1',description:'Assemble 2 IKEA BILLY bookcases',category:'flat_pack',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'weekend',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'AH03', label:'After-hours — pub toilet repair',
    customerType:'small_biz', urgencyType:'emergency',
    body:{ vaContext:'Pub owner. Toilet cistern broken in the gents. Saturday night service just started. Cannot close. Needs someone NOW.',
      lines:[{id:'l1',description:'Emergency toilet cistern repair in commercial premises',category:'plumbing_minor',timeEstimateMinutes:45}],
      signals:{urgency:'emergency',materialsSupply:'we_supply',timeOfService:'after_hours',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── COMPLEX / MULTI-TRADE ───────────────────────────────────────────────

  { id:'C01', label:'Complex — pre-sale property, 6 jobs',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Michael is selling his house. Estate agent said it needs work before going on the market. Needs lino replaced, blinds hung, tiles regrouted, bath seal replaced, full house painted and carpets deep cleaned. Happy to pay for quality — wants it done right.',
      lines:[{id:'l1',description:'Remove lino and install new vinyl in kitchen',category:'flooring',timeEstimateMinutes:180},
             {id:'l2',description:'Hang 2 new window blinds in living room',category:'curtain_blinds',timeEstimateMinutes:45},
             {id:'l3',description:'Clean and regrout bathroom tiles',category:'tiling',timeEstimateMinutes:120},
             {id:'l4',description:'Replace bath seal with anti-mould silicone',category:'silicone_sealant',timeEstimateMinutes:45},
             {id:'l5',description:'Full house paint — all walls, skirting, woodwork',category:'painting',timeEstimateMinutes:480}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'C02', label:'Complex — full kitchen refit coordination',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Customer had a new kitchen delivered but the fitters cancelled. Needs someone to fit the units, sort the plumbing for the dishwasher, and patch the walls around the old cooker hood.',
      lines:[{id:'l1',description:'Install kitchen wall and base units (IKEA SEKTION)',category:'kitchen_fitting',timeEstimateMinutes:480},
             {id:'l2',description:'Connect dishwasher plumbing to existing inlet/outlet',category:'plumbing_minor',timeEstimateMinutes:60},
             {id:'l3',description:'Patch and skim plaster where old hood was removed',category:'plastering',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'C03', label:'Complex — full bathroom refit',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Full bathroom renovation. Old suite ripped out already. Customer has bought a new bath, basin, and toilet. Needs fitting, tiling, and sealing.',
      lines:[{id:'l1',description:'Fit new bath, basin and toilet suite',category:'bathroom_fitting',timeEstimateMinutes:360},
             {id:'l2',description:'Tile bathroom floor and half-wall splashback',category:'tiling',timeEstimateMinutes:300},
             {id:'l3',description:'Seal all joints with anti-mould silicone',category:'silicone_sealant',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── PRICE-CONSCIOUS CUSTOMERS ───────────────────────────────────────────

  { id:'P01', label:'Budget customer — explicitly price-conscious, single job',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Kevin mentioned price twice. Said his budget is around £80 for the TV mount. He\'s done his research on Google.',
      lines:[{id:'l1',description:'Wall mount 65" TV — customer has bracket',category:'tv_mounting',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'P02', label:'Budget customer — batch to save money',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Customer asked if they get a discount for booking multiple jobs. Wants 3 done together: tap, shelf, curtain rail.',
      lines:[{id:'l1',description:'Fix dripping bathroom tap',category:'plumbing_minor',timeEstimateMinutes:45},
             {id:'l2',description:'Mount 1 floating shelf in kitchen',category:'shelving',timeEstimateMinutes:20},
             {id:'l3',description:'Install curtain rail in bedroom',category:'curtain_blinds',timeEstimateMinutes:30}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── EDGE CASES ──────────────────────────────────────────────────────────

  { id:'X01', label:'Edge — very long noisy VA notes, 2 jobs',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:`Kevin called at 2:14pm. He was quite chatty and went off on a tangent about his neighbour at one point. Main issue is his TV has been on the floor for 3 months since moving in. He wants it wall mounted in the living room — 65 inch Samsung, he has the bracket already. He also mentioned 4 IKEA KALLAX shelving units still in boxes that he can't assemble due to bad back. He lives in Clifton, ground floor flat, easy access. Price-conscious — asked twice how much before I could explain the process. He said budget around £150 but I think he can stretch if we make value clear. Home most days, flexible. Prefers mornings. Found us on Google.`,
      lines:[{id:'l1',description:'Wall mount 65" Samsung TV — customer has bracket',category:'tv_mounting',timeEstimateMinutes:60},
             {id:'l2',description:'Assemble 4 x IKEA KALLAX shelving units',category:'flat_pack',timeEstimateMinutes:180}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'X02', label:'Edge — tenant calling (not landlord)',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Tenant (not the landlord) called to arrange their own maintenance. Dripping tap in their flat. They will pay themselves.',
      lines:[{id:'l1',description:'Fix dripping kitchen tap',category:'plumbing_minor',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'X03', label:'Edge — very short description, ambiguous job',
    customerType:'unknown', urgencyType:'standard',
    body:{ vaContext:'Blocked drain.',
      lines:[{id:'l1',description:'Unblock kitchen drain',category:'plumbing_minor',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'X04', label:'Edge — high-ceiling access difficulty',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Customer has a double-height hallway. Needs a light fitting changed up high. Will need ladders.',
      lines:[{id:'l1',description:'Replace ceiling light fitting in double-height hallway (high access)',category:'electrical_minor',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'X05', label:'Edge — waste removal, single job',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Customer cleared out a garage and has bags and broken furniture to remove. Needs a man with a van basically.',
      lines:[{id:'l1',description:'Remove and dispose of garage waste — approx 10 bags + 2 pieces of furniture',category:'waste_removal',timeEstimateMinutes:120}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  // ── FILL TO 100 with varied scenarios ──────────────────────────────────

  { id:'F01', label:'Homeowner — bedroom curtain rail x3, customer supplied',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Moving into new house. Needs curtain rails fitted in 3 bedrooms. Has bought the rails already.',
      lines:[{id:'l1',description:'Install 3 curtain rails in bedrooms',category:'curtain_blinds',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F02', label:'Homeowner — crack repair and paint in hallway',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Crack appeared in hallway wall, probably from house settling. Wants it patched and painted over.',
      lines:[{id:'l1',description:'Fill and skim plaster crack in hallway wall',category:'plastering',timeEstimateMinutes:60},
             {id:'l2',description:'Paint over repaired section to match existing wall',category:'painting',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F03', label:'Homeowner — wooden floor repair, 2 loose boards',
    customerType:'homeowner', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Secure 2 squeaky loose floorboards in living room',category:'flooring',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F04', label:'Homeowner — kitchen extractor fan install',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Old extractor fan stopped working. Customer has already bought a new one. Needs old one removed and new one fitted.',
      lines:[{id:'l1',description:'Remove old kitchen extractor fan and fit new one',category:'electrical_minor',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F05', label:'Landlord — priority check before new tenant',
    customerType:'landlord', urgencyType:'priority',
    body:{ vaContext:'New tenant moving in Friday. Landlord wants a quick snag check and small fixes done before then. 2 door handles loose, one blind broken.',
      lines:[{id:'l1',description:'Tighten 2 loose door handles',category:'general_fixing',timeEstimateMinutes:20},
             {id:'l2',description:'Replace broken window blind mechanism',category:'curtain_blinds',timeEstimateMinutes:30}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F06', label:'Property manager — replace bath panel',
    customerType:'property_manager', urgencyType:'standard',
    body:{ vaContext:'Routine maintenance. Bath panel cracked and needs replacing in one of the rental flats. Access via managing agent.',
      lines:[{id:'l1',description:'Remove cracked bath panel and fit new one',category:'bathroom_fitting',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F07', label:'Homeowner — fence gate repair, sagging',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Side garden gate is dragging on the ground. Hinge is bent. Needs new hinge and the gate rehung properly.',
      lines:[{id:'l1',description:'Replace bent garden gate hinge and re-hang gate',category:'fencing',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F08', label:'Homeowner — full room paint, large lounge',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Customer wants their large open-plan living/dining room painted. About 40sqm of wall. Customer supplies paint. Flexible on dates.',
      lines:[{id:'l1',description:'Full paint of open-plan living/dining room walls and ceiling (40sqm)',category:'painting',timeEstimateMinutes:300}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F09', label:'Homeowner — outdoor light fitting',
    customerType:'homeowner', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Install outdoor security light above front door',category:'electrical_minor',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F10', label:'Homeowner — garden tidy and shed repair',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Overgrown garden. Wants it tidied and the shed door fixed — hinge has rusted off.',
      lines:[{id:'l1',description:'Garden tidy — cut back overgrowth, bag waste',category:'garden_maintenance',timeEstimateMinutes:180},
             {id:'l2',description:'Replace rusted shed door hinge',category:'garden_maintenance',timeEstimateMinutes:30}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F11', label:'Landlord — priority damp fix before inspection',
    customerType:'landlord', urgencyType:'priority',
    body:{ vaContext:'Environmental health inspection next week. Damp patch on bathroom ceiling needs patching and repainting. Landlord nervous.',
      lines:[{id:'l1',description:'Treat damp patch and repaint bathroom ceiling',category:'painting',timeEstimateMinutes:120}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F12', label:'Homeowner — bedroom furniture build, 4 items',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Just bought new bedroom furniture — wardrobe, 2 bedside tables and a chest of drawers. All flat pack. Customer has bad back and cannot do it.',
      lines:[{id:'l1',description:'Assemble flat pack wardrobe (large, 3-door)',category:'flat_pack',timeEstimateMinutes:120},
             {id:'l2',description:'Assemble 2 flat pack bedside tables',category:'flat_pack',timeEstimateMinutes:45},
             {id:'l3',description:'Assemble flat pack chest of drawers',category:'flat_pack',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F13', label:'Homeowner — radiator not working, cold room',
    customerType:'homeowner', urgencyType:'priority',
    body:{ vaContext:'One radiator not getting hot. Baby\'s bedroom. Priority. Tried bleeding it themselves but no joy.',
      lines:[{id:'l1',description:'Diagnose and fix cold radiator — bleed, check valve, balance if needed',category:'plumbing_minor',timeEstimateMinutes:60}],
      signals:{urgency:'priority',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F14', label:'Homeowner — tiling kitchen splashback',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'New kitchen installed but no splashback tiles yet. Customer has bought metro tiles. Just needs fitting.',
      lines:[{id:'l1',description:'Tile kitchen splashback with metro tiles (approx 2sqm) — customer supplies tiles',category:'tiling',timeEstimateMinutes:150}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F15', label:'Landlord — returning, 4th job, priority',
    customerType:'returning', urgencyType:'priority',
    body:{ vaContext:'Anna is back. Fourth job with us. Boiler pressure keeps dropping and the tenant keeps calling her. Needs it sorted this week.',
      lines:[{id:'l1',description:'Repressurise boiler and check for slow leak',category:'plumbing_minor',timeEstimateMinutes:60}],
      signals:{urgency:'priority',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:true,previousJobCount:3,previousAvgPricePence:9200} }},

  { id:'F16', label:'Property manager — 2 properties same day',
    customerType:'property_manager', urgencyType:'standard',
    body:{ vaContext:'Two properties on the same street. Quick visit needed — lock change at one, extractor fan at the other. PM wants one consolidated invoice.',
      lines:[{id:'l1',description:'Change front door lock at property A',category:'lock_change',timeEstimateMinutes:45},
             {id:'l2',description:'Replace bathroom extractor fan at property B',category:'electrical_minor',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F17', label:'Small biz — signage mounting in shop window',
    customerType:'small_biz', urgencyType:'standard',
    body:{ vaContext:'New gift shop on the high street. Needs a large sign bracket mounted above the window and 3 shelf display brackets inside.',
      lines:[{id:'l1',description:'Mount heavy external sign bracket above shop window',category:'general_fixing',timeEstimateMinutes:60},
             {id:'l2',description:'Install 3 display shelf brackets inside shop',category:'shelving',timeEstimateMinutes:45}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F18', label:'Homeowner — door dragging on carpet after new flooring',
    customerType:'homeowner', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Plane bottom of 3 interior doors that are catching on new carpet',category:'door_fitting',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F19', label:'Homeowner — new bathroom mirror and cabinet',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Renovating bathroom. Wants a large mirror and a medicine cabinet mounted. Customer has everything ready to go.',
      lines:[{id:'l1',description:'Mount large bathroom mirror (heavy)',category:'general_fixing',timeEstimateMinutes:30},
             {id:'l2',description:'Mount bathroom medicine cabinet',category:'general_fixing',timeEstimateMinutes:20}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F20', label:'Homeowner — priority, selling house, need it done fast',
    customerType:'homeowner', urgencyType:'priority',
    body:{ vaContext:'House going on the market in 10 days. Estate agent coming to photograph on Thursday. Needs 3 things done by Wednesday: touch-up paint in hallway, fix a stiff door, and get rid of the old bathroom silicone and re-seal.',
      lines:[{id:'l1',description:'Touch-up paint on hallway walls — customer supplies paint',category:'painting',timeEstimateMinutes:90},
             {id:'l2',description:'Plane and re-hang stiff kitchen door',category:'door_fitting',timeEstimateMinutes:60},
             {id:'l3',description:'Remove old silicone and re-seal bath',category:'silicone_sealant',timeEstimateMinutes:45}],
      signals:{urgency:'priority',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F21', label:'Homeowner — outdoor gate lock replacement',
    customerType:'homeowner', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Replace broken gate padlock hasp and staple',category:'lock_change',timeEstimateMinutes:30}],
      signals:{urgency:'standard',materialsSupply:'we_supply',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F22', label:'Landlord — returning, 2nd job, gutter clear',
    customerType:'returning', urgencyType:'standard',
    body:{ vaContext:'John used us last year for a lock change. Back now for gutter clearing before autumn.',
      lines:[{id:'l1',description:'Clear gutters front and rear on end-of-terrace',category:'guttering',timeEstimateMinutes:90}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:true,previousJobCount:1,previousAvgPricePence:9500} }},

  { id:'F23', label:'Homeowner — new sockets for home office',
    customerType:'homeowner', urgencyType:'standard',
    body:{ vaContext:'Working from home permanently now. Needs 2 extra double sockets in the spare room converted to office. Customer supplies sockets.',
      lines:[{id:'l1',description:'Install 2 additional double sockets in home office',category:'electrical_minor',timeEstimateMinutes:120}],
      signals:{urgency:'standard',materialsSupply:'customer_supplied',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F24', label:'Small biz — after-hours window blind repair in gym',
    customerType:'small_biz', urgencyType:'standard',
    body:{ vaContext:'Gym owner. 3 of the roller blinds in the spin studio are broken and it\'s getting too bright for morning classes. Needs done before 6am Saturday class.',
      lines:[{id:'l1',description:'Repair or replace 3 broken roller blinds in gym studio',category:'curtain_blinds',timeEstimateMinutes:90}],
      signals:{urgency:'priority',materialsSupply:'we_supply',timeOfService:'after_hours',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},

  { id:'F25', label:'Homeowner — furniture repair, wobbly chair fix',
    customerType:'homeowner', urgencyType:'standard',
    body:{ lines:[{id:'l1',description:'Repair 2 wobbly wooden dining chairs — tighten joints and reglue',category:'furniture_repair',timeEstimateMinutes:60}],
      signals:{urgency:'standard',materialsSupply:'labor_only',timeOfService:'standard',isReturningCustomer:false,previousJobCount:0,previousAvgPricePence:0} }},
];

// Verify we have 100 scenarios
console.log(`Loaded ${SCENARIOS.length} test scenarios`);
if (SCENARIOS.length < 100) {
  console.warn(`⚠ Only ${SCENARIOS.length} scenarios defined — target is 100`);
}

// ─── Call API ───────────────────────────────────────────────────────────────

async function runScenario(scenario) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/pricing/multi-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario.body),
    });
    const elapsed = Date.now() - start;

    if (!res.ok) {
      const text = await res.text();
      return { id: scenario.id, label: scenario.label, error: `HTTP ${res.status}: ${text.slice(0,200)}`, elapsed };
    }

    const data = await res.json();

    return {
      id: scenario.id,
      label: scenario.label,
      customerType: scenario.customerType,
      urgencyType: scenario.urgencyType,
      elapsed,
      lineCount: scenario.body.lines.length,
      vaContextWords: scenario.body.vaContext ? scenario.body.vaContext.split(/\s+/).length : 0,
      // Extracted fields
      headline: data.messaging?.contextualHeadline || data.contextualHeadline || '',
      jobTopLine: data.jobTopLine || '',
      message: data.messaging?.contextualMessage || data.contextualMessage || '',
      valueBullets: data.messaging?.valueBullets || [],
      whatsappClosing: data.messaging?.whatsappClosing || '',
      layoutTier: data.messaging?.layoutTier || '',
      bookingModes: data.messaging?.bookingModes || [],
      confidence: data.confidence || '',
      finalPricePence: data.finalPricePence || 0,
      totalFormatted: data.finalPricePence ? `£${(data.finalPricePence / 100).toFixed(2)}` : 'N/A',
      // Raw for inspection
      rawSignals: scenario.body.signals,
      rawVaContext: scenario.body.vaContext || '',
      rawLines: scenario.body.lines,
    };
  } catch (err) {
    return { id: scenario.id, label: scenario.label, error: String(err), elapsed: Date.now() - start };
  }
}

// ─── Scoring Engine ─────────────────────────────────────────────────────────

const GENERIC_HEADLINES = [
  'your job, sorted', 'job done', 'jobs sorted', 'work done', 'quality work, fair price',
  'all sorted', 'all done', 'quality work', 'job sorted', 'task complete',
];

function score(result, scenario) {
  if (result.error) return { total: 0, breakdown: { headline:0, tone:0, bullets:0, price:0 }, issues: [`API ERROR: ${result.error}`], ok: [] };

  const issues = [];
  const ok = [];
  let headline = 0, tone = 0, bullets = 0, price = 0;

  const h = (result.headline || '').toLowerCase().trim();
  const m = (result.message || '').toLowerCase();
  const topLine = (result.jobTopLine || '').toLowerCase();
  const bulletList = (result.valueBullets || []).map(b => b.toLowerCase());
  const vaCtx = (scenario.body.vaContext || '').toLowerCase();
  const sig = scenario.body.signals;

  // ── 1. HEADLINE (0-3) ──────────────────────────────────────────────────
  if (!result.headline || result.headline.length < 3) {
    issues.push('Headline missing or too short');
  } else if (GENERIC_HEADLINES.some(g => h.includes(g))) {
    issues.push(`Headline generic: "${result.headline}"`);
    headline = 1; // partial
  } else if (result.headline.length > 60) {
    issues.push(`Headline too long (${result.headline.length} chars): "${result.headline}"`);
    headline = 1;
  } else {
    ok.push(`Headline: "${result.headline}"`);
    headline = 3;
  }
  // Bonus: if jobTopLine is present and not generic
  if (result.jobTopLine && result.jobTopLine.length > 4 && !result.jobTopLine.toLowerCase().includes('your job')) {
    ok.push(`jobTopLine: "${result.jobTopLine}"`);
  } else {
    issues.push(`jobTopLine missing or generic: "${result.jobTopLine}"`);
    headline = Math.max(0, headline - 1);
  }

  // ── 2. MESSAGE TONE (0-3) ─────────────────────────────────────────────
  if (!result.message || result.message.length < 10) {
    issues.push('Message empty');
  } else {
    let toneScore = 1; // base

    // Emergency check
    if (sig.urgency === 'emergency') {
      const hasUrgency = m.includes('today') || m.includes('asap') || m.includes('right away') ||
        m.includes('emergency') || m.includes('urgent') || m.includes('fast') || m.includes('quick') || m.includes('straight away');
      if (!hasUrgency) issues.push('Emergency job — message lacks urgency tone');
      else { ok.push('Urgency tone in message'); toneScore++; }
    }

    // Landlord / not on site
    if (vaCtx.includes('landlord') || vaCtx.includes('tenant') || vaCtx.includes('cannot be') || vaCtx.includes("can't be") || vaCtx.includes('not there') || vaCtx.includes("won't be")) {
      const hasAbsence = m.includes("there") || m.includes("attend") || m.includes("on site") ||
        m.includes("tenant") || m.includes("coordinate") || m.includes("photo") || m.includes("send");
      if (!hasAbsence) issues.push('Landlord/absent context — message does not address');
      else { ok.push('Landlord/absent context addressed in message'); toneScore++; }
    }

    // Returning customer
    if (sig.isReturningCustomer) {
      const hasReturn = m.includes('back') || m.includes('again') || m.includes('return') || m.includes('welcome') || m.includes('good to');
      if (!hasReturn) issues.push('Returning customer — message does not acknowledge');
      else { ok.push('Returning customer acknowledged'); toneScore++; }
    }

    tone = Math.min(3, toneScore);
    if (tone >= 2) ok.push(`Message tone score: ${tone}/3`);
  }

  // ── 3. BULLET ALIGNMENT (0-3) ─────────────────────────────────────────
  if (!result.valueBullets || result.valueBullets.length < 3) {
    issues.push(`Too few bullets: ${result.valueBullets?.length || 0}`);
  } else {
    let bulletScore = 1; // base — has bullets

    // Emergency → same-day bullet expected
    if (sig.urgency === 'emergency') {
      if (bulletList.some(b => b.includes('same-day') || b.includes('emergency'))) {
        ok.push('Same-day/emergency bullet included'); bulletScore++;
      } else {
        issues.push('Emergency job — no same-day bullet');
      }
    }

    // Landlord/photos → photo report bullet
    if (vaCtx.includes('photo') || vaCtx.includes('photos') || (vaCtx.includes('landlord') && !vaCtx.includes('no photo'))) {
      if (bulletList.some(b => b.includes('photo'))) {
        ok.push('Photo report bullet included'); bulletScore++;
      } else if (vaCtx.includes('photo')) {
        issues.push('Customer mentioned photos — no photo bullet');
      }
    }

    // Invoice / property manager
    if (vaCtx.includes('invoice') || vaCtx.includes('tax') || vaCtx.includes('receipt') || vaCtx.includes('accountant') || vaCtx.includes('bookkeep')) {
      if (bulletList.some(b => b.includes('invoice') || b.includes('tax'))) {
        ok.push('Invoice/tax bullet included'); bulletScore++;
      } else {
        issues.push('Invoice/tax mentioned in context — no invoice bullet');
      }
    }

    // We supply materials → materials bullet
    if (sig.materialsSupply === 'we_supply') {
      if (bulletList.some(b => b.includes('material') || b.includes('sourced'))) {
        ok.push('Materials bullet included'); bulletScore++;
      }
    }

    // Weekend/after-hours → timing bullet
    if (sig.timeOfService !== 'standard') {
      if (bulletList.some(b => b.includes('weekend') || b.includes('evening') || b.includes('slot'))) {
        ok.push('Timing bullet included'); bulletScore++;
      } else {
        issues.push('After-hours/weekend — no timing bullet');
      }
    }

    bullets = Math.min(3, bulletScore);
    ok.push(`Bullets (${result.valueBullets.length}): [${result.valueBullets.join(' | ')}]`);
  }

  // ── 4. PRICE SANITY (0-3) ─────────────────────────────────────────────
  const totalMinutes = scenario.body.lines.reduce((sum, l) => sum + l.timeEstimateMinutes, 0);
  const primaryCategory = scenario.body.lines[0].category;
  const floorPerHalfHour = PRICE_FLOOR[primaryCategory] || 2500;
  const expectedFloor = Math.round((floorPerHalfHour / 30) * totalMinutes * 0.7); // 70% of reference as floor
  const expectedCeiling = Math.round((floorPerHalfHour / 30) * totalMinutes * 5.0); // 5x as ceiling

  if (!result.finalPricePence || result.finalPricePence <= 0) {
    issues.push('No price returned');
  } else if (result.finalPricePence < expectedFloor) {
    issues.push(`Price too low: ${result.totalFormatted} (floor: £${(expectedFloor/100).toFixed(0)})`);
    price = 1;
  } else if (result.finalPricePence > expectedCeiling) {
    issues.push(`Price suspiciously high: ${result.totalFormatted} (ceiling: £${(expectedCeiling/100).toFixed(0)})`);
    price = 1;
  } else {
    ok.push(`Price ${result.totalFormatted} within range`);
    price = 3;
  }
  // Emergency premium check
  if (sig.urgency === 'emergency' && result.finalPricePence > 0) {
    const baseEstimate = Math.round((floorPerHalfHour / 30) * totalMinutes);
    if (result.finalPricePence < baseEstimate * 1.2) {
      issues.push('Emergency job — price not showing premium (expected ≥20% uplift)');
      price = Math.max(1, price - 1);
    } else {
      ok.push('Emergency premium applied to price');
    }
  }

  const total = headline + tone + bullets + price;
  return { total, breakdown: { headline, tone, bullets, price }, issues, ok };
}

// ─── Batch Runner ───────────────────────────────────────────────────────────

async function runBatch(batch) {
  return Promise.all(batch.map(runScenario));
}

async function runAll(scenarios) {
  const results = [];
  for (let i = 0; i < scenarios.length; i += BATCH_SIZE) {
    const batch = scenarios.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(scenarios.length/BATCH_SIZE)} (${i+1}-${Math.min(i+BATCH_SIZE, scenarios.length)})...`);
    const batchResults = await runBatch(batch);
    results.push(...batchResults);
    const elapsed = batchResults.reduce((s,r) => s + (r.elapsed||0), 0);
    console.log(` done (${(elapsed/1000).toFixed(1)}s)`);
  }
  return results;
}

// ─── Report ─────────────────────────────────────────────────────────────────

function printReport(results, scenarios, scores) {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`  QUOTE MATRIX REPORT — ${new Date().toISOString().slice(0,16)}  (${scenarios.length} scenarios)`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // Per-scenario detail
  results.forEach((result, i) => {
    const scenario = scenarios[i];
    const sc = scores[i];
    const grade = sc.total >= 10 ? '✅' : sc.total >= 7 ? '⚠️ ' : '❌';
    const pct = Math.round((sc.total / 12) * 100);

    console.log(`${grade} [${result.id}] ${result.label}`);
    console.log(`   Score: ${sc.total}/12 (${pct}%) — H:${sc.breakdown.headline} T:${sc.breakdown.tone} B:${sc.breakdown.bullets} P:${sc.breakdown.price} | ${result.totalFormatted || 'N/A'} | ${result.lineCount}×job | ${result.vaContextWords}w ctx | ${result.elapsed}ms`);

    if (result.error) {
      console.log(`   ⛔ ${result.error}`);
    } else {
      console.log(`   Headline: "${result.headline}" | jobTopLine: "${result.jobTopLine}"`);
      console.log(`   Message:  "${(result.message||'').slice(0,100)}${(result.message||'').length > 100 ? '...' : ''}"`);
    }

    if (sc.issues.length) {
      console.log(`   ✗ ${sc.issues.join('\n   ✗ ')}`);
    }
    console.log();
  });

  // Summary stats
  const validScores = scores.filter((_, i) => !results[i].error);
  const totalMax = validScores.length * 12;
  const totalActual = validScores.reduce((s, sc) => s + sc.total, 0);
  const avgPct = totalMax > 0 ? Math.round((totalActual / totalMax) * 100) : 0;

  const passed = scores.filter(sc => sc.total >= 10).length;
  const warned = scores.filter(sc => sc.total >= 7 && sc.total < 10).length;
  const failed = scores.filter(sc => sc.total < 7).length;
  const errors = results.filter(r => r.error).length;

  // By customer type
  const byType = {};
  scenarios.forEach((sc, i) => {
    const t = sc.customerType;
    if (!byType[t]) byType[t] = { count:0, total:0 };
    byType[t].count++;
    byType[t].total += scores[i].total;
  });

  // By urgency
  const byUrgency = {};
  scenarios.forEach((sc, i) => {
    const u = sc.body.signals.urgency;
    if (!byUrgency[u]) byUrgency[u] = { count:0, total:0 };
    byUrgency[u].count++;
    byUrgency[u].total += scores[i].total;
  });

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`  SUMMARY — ${scenarios.length} quotes | Overall: ${totalActual}/${totalMax} (${avgPct}%)`);
  console.log(`  ✅ Pass (≥10): ${passed} | ⚠️  Warn (7-9): ${warned} | ❌ Fail (<7): ${failed} | ⛔ Errors: ${errors}`);
  console.log('');
  console.log('  By customer type:');
  Object.entries(byType).forEach(([type, s]) => {
    const avg = (s.total / s.count).toFixed(1);
    console.log(`    ${type.padEnd(16)} avg ${avg}/12  (${s.count} quotes)`);
  });
  console.log('');
  console.log('  By urgency:');
  Object.entries(byUrgency).forEach(([u, s]) => {
    const avg = (s.total / s.count).toFixed(1);
    console.log(`    ${u.padEnd(16)} avg ${avg}/12  (${s.count} quotes)`);
  });
  console.log('');

  // Top issues
  const allIssues = {};
  scores.forEach(sc => {
    sc.issues.forEach(iss => {
      const key = iss.replace(/:.+/, '').trim();
      allIssues[key] = (allIssues[key] || 0) + 1;
    });
  });
  const sorted = Object.entries(allIssues).sort((a,b) => b[1]-a[1]);
  if (sorted.length) {
    console.log('  Most common issues:');
    sorted.slice(0, 10).forEach(([iss, count]) => {
      console.log(`    (${count}×) ${iss}`);
    });
  }
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log(`\nRunning ${SCENARIOS.length} quote scenarios in batches of ${BATCH_SIZE}...\n`);
const results = await runAll(SCENARIOS);
const scores = results.map((r, i) => score(r, SCENARIOS[i]));

printReport(results, SCENARIOS, scores);

// Save JSON
const output = {
  timestamp: new Date().toISOString(),
  totalScenarios: SCENARIOS.length,
  results: results.map((r, i) => ({ ...r, score: scores[i] })),
};
writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
console.log(`Full results saved to ${RESULTS_FILE}`);
