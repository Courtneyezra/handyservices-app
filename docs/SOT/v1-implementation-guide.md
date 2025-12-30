# V1 Implementation Guide

**Version:** 1.0  
**Date:** 2025-12-28  
**Target:** MVP with guaranteed booking fulfillment

---

## Overview

This guide provides step-by-step implementation instructions for V1. Follow these phases sequentially - each phase builds on the previous.

---

## Phase 1: Foundation (Week 1)

### 1.1 Database Migration

**File:** `migrations/0004_unified_booking_system.sql`

```sql
-- 1. Update leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state VARCHAR(50) DEFAULT 'created';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);

-- 2. Update handyman_profiles
ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS max_concurrent_jobs INTEGER DEFAULT 3;
ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 3. Create contractor_tasks (skill taxonomy)
CREATE TABLE IF NOT EXISTS contractor_tasks (
    id VARCHAR PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    requires_certification BOOLEAN DEFAULT FALSE,
    certification_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Create contractor_skills (junction)
CREATE TABLE IF NOT EXISTS contractor_skills (
    id VARCHAR PRIMARY KEY,
    handyman_id VARCHAR REFERENCES handyman_profiles(id) NOT NULL,
    task_id VARCHAR REFERENCES contractor_tasks(id) NOT NULL,
    confidence VARCHAR(20) NOT NULL,
    years_experience INTEGER,
    completed_count INTEGER DEFAULT 0,
    last_performed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(handyman_id, task_id)
);

-- 5. Create quotes table
CREATE TABLE IF NOT EXISTS quotes (
    id VARCHAR PRIMARY KEY,
    lead_id VARCHAR REFERENCES leads(id),
    version INTEGER DEFAULT 1,
    style VARCHAR(20),
    total INTEGER,
    deposit_percent INTEGER DEFAULT 20,
    line_items JSONB,
    optional_items JSONB,
    expires_at TIMESTAMP,
    sent_at TIMESTAMP,
    viewed_at TIMESTAMP,
    accepted_at TIMESTAMP,
    created_by VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotes_lead ON quotes(lead_id);

-- 6. Create bookings table
CREATE TABLE IF NOT EXISTS bookings (
    id VARCHAR PRIMARY KEY,
    quote_id VARCHAR REFERENCES quotes(id),
    contractor_id VARCHAR REFERENCES handyman_profiles(id),
    date DATE NOT NULL,
    time_slot VARCHAR(20) NOT NULL,
    payment_intent_id VARCHAR,
    deposit_amount INTEGER,
    status VARCHAR(20) DEFAULT 'confirmed',
    confirmed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    completed_at TIMESTAMP,
    cancellation_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_contractor ON bookings(contractor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);

-- 7. Create slot_holds table
CREATE TABLE IF NOT EXISTS slot_holds (
    id VARCHAR PRIMARY KEY,
    contractor_id VARCHAR REFERENCES handyman_profiles(id) NOT NULL,
    date DATE NOT NULL,
    time_slot VARCHAR(20) NOT NULL,
    session_id VARCHAR NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slot_holds_lookup ON slot_holds(contractor_id, date, time_slot);
CREATE INDEX IF NOT EXISTS idx_slot_holds_expires ON slot_holds(expires_at);

-- 8. Create job_task_requirements table
CREATE TABLE IF NOT EXISTS job_task_requirements (
    id VARCHAR PRIMARY KEY,
    lead_id VARCHAR REFERENCES leads(id),
    task_id VARCHAR REFERENCES contractor_tasks(id) NOT NULL,
    required_confidence VARCHAR(20) NOT NULL,
    is_primary BOOLEAN DEFAULT TRUE,
    ai_confidence INTEGER,
    manually_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_tasks_lead ON job_task_requirements(lead_id);

-- 9. Create job_matching_history table
CREATE TABLE IF NOT EXISTS job_matching_history (
    id VARCHAR PRIMARY KEY,
    booking_id VARCHAR REFERENCES bookings(id),
    contractor_id VARCHAR REFERENCES handyman_profiles(id) NOT NULL,
    match_score INTEGER,
    was_selected BOOLEAN DEFAULT FALSE,
    job_completed BOOLEAN,
    customer_rating INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 1.2 Seed Task Taxonomy

**File:** `scripts/seed-contractor-tasks.ts`

```typescript
import { db } from '../server/db';
import { contractorTasks } from '../shared/schema';
import { v4 as uuid } from 'uuid';

const TASKS = {
  Plumbing: [
    'Fix leaking taps/faucets',
    'Replace toilet seat/flush mechanism',
    'Unblock sink/toilet',
    'Install dishwasher/washing machine',
    'Replace radiator valves',
    'Fix dripping shower',
    'Install new taps',
    'Install bathroom suite',
    'Relocate radiators',
    'Install outside tap',
    'Fix water pressure issues',
    'Replace toilet cistern',
    'Install bath/shower',
    'Emergency leak repair',
  ],
  Electrical: [
    'Replace light bulbs/fixtures',
    'Install dimmer switches',
    'Replace plug sockets/face plates',
    'Install ceiling fans',
    'Add new power sockets',
    'Install outdoor lighting',
    'Fault finding/testing',
    'Replace light switches',
    'Install smart home devices',
    'Install electric showers',
  ],
  Carpentry: [
    'Assemble flat-pack furniture',
    'Hang pictures/mirrors/shelves',
    'Install curtain rails/blinds',
    'Fix squeaky floor boards',
    'Install kitchen cabinets',
    'Build shelving units',
    'Repair/replace skirting boards',
    'Hang internal doors',
    'Install door handles/locks',
    'Build decking',
    'Install laminate/wood flooring',
    'Repair wooden furniture',
    'Install kitchen worktops',
    'Build wardrobes',
    'Staircase repairs',
    'Window frame repairs',
    'Install architraves/beading',
  ],
  Decorating: [
    'Paint single room (walls only)',
    'Paint ceilings',
    'Wallpaper removal',
    'Wallpaper hanging',
    'Fill and sand walls',
    'Paint woodwork/trim',
    'Exterior painting',
    'Stairwell painting',
  ],
  General: [
    'Mount TVs',
    'Patch drywall holes',
    'Install coat hooks/towel rails',
    'Replace door locks',
    'Draught proofing',
    'Tile grouting/repair',
    'Replace broken tiles',
    'Install grab rails',
    'Seal bathrooms/kitchens',
    'General odd jobs',
  ],
  Garden: [
    'Fence panel replacement',
    'Gate repairs/installation',
    'Deck cleaning/treatment',
    'Gutter cleaning',
    'Shed assembly',
    'Patio cleaning',
    'Basic landscaping',
  ],
};

async function seedTasks() {
  let order = 0;
  
  for (const [category, tasks] of Object.entries(TASKS)) {
    for (const taskName of tasks) {
      await db.insert(contractorTasks).values({
        id: uuid(),
        name: taskName,
        category,
        displayOrder: order++,
        isActive: true,
      }).onConflictDoNothing();
    }
  }
  
  console.log(`Seeded ${order} tasks`);
}

seedTasks();
```

### 1.3 Update Schema Types

**File:** `shared/schema.ts` (additions)

```typescript
// Add to existing file

// Contractor Tasks (Skill Taxonomy)
export const contractorTasks = pgTable("contractor_tasks", {
    id: varchar("id").primaryKey().notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    description: text("description"),
    requiresCertification: boolean("requires_certification").default(false),
    certificationName: varchar("certification_name", { length: 100 }),
    isActive: boolean("is_active").default(true),
    displayOrder: integer("display_order"),
    createdAt: timestamp("created_at").defaultNow(),
});

// Contractor Skills
export const contractorSkills = pgTable("contractor_skills", {
    id: varchar("id").primaryKey().notNull(),
    handymanId: varchar("handyman_id").references(() => handymanProfiles.id).notNull(),
    taskId: varchar("task_id").references(() => contractorTasks.id).notNull(),
    confidence: varchar("confidence", { length: 20 }).notNull(),
    yearsExperience: integer("years_experience"),
    completedCount: integer("completed_count").default(0),
    lastPerformedAt: timestamp("last_performed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

// Quotes
export const quotes = pgTable("quotes", {
    id: varchar("id").primaryKey().notNull(),
    leadId: varchar("lead_id").references(() => leads.id),
    version: integer("version").default(1),
    style: varchar("style", { length: 20 }),
    total: integer("total"),
    depositPercent: integer("deposit_percent").default(20),
    lineItems: jsonb("line_items"),
    optionalItems: jsonb("optional_items"),
    expiresAt: timestamp("expires_at"),
    sentAt: timestamp("sent_at"),
    viewedAt: timestamp("viewed_at"),
    acceptedAt: timestamp("accepted_at"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
});

// Bookings
export const bookings = pgTable("bookings", {
    id: varchar("id").primaryKey().notNull(),
    quoteId: varchar("quote_id").references(() => quotes.id),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id),
    date: timestamp("date").notNull(),
    timeSlot: varchar("time_slot", { length: 20 }).notNull(),
    paymentIntentId: varchar("payment_intent_id"),
    depositAmount: integer("deposit_amount"),
    status: varchar("status", { length: 20 }).default('confirmed'),
    confirmedAt: timestamp("confirmed_at"),
    cancelledAt: timestamp("cancelled_at"),
    completedAt: timestamp("completed_at"),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at").defaultNow(),
});

// Slot Holds
export const slotHolds = pgTable("slot_holds", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    date: timestamp("date").notNull(),
    timeSlot: varchar("time_slot", { length: 20 }).notNull(),
    sessionId: varchar("session_id").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
});

// Job Task Requirements
export const jobTaskRequirements = pgTable("job_task_requirements", {
    id: varchar("id").primaryKey().notNull(),
    leadId: varchar("lead_id").references(() => leads.id),
    taskId: varchar("task_id").references(() => contractorTasks.id).notNull(),
    requiredConfidence: varchar("required_confidence", { length: 20 }).notNull(),
    isPrimary: boolean("is_primary").default(true),
    aiConfidence: integer("ai_confidence"),
    manuallyVerified: boolean("manually_verified").default(false),
    verifiedBy: varchar("verified_by"),
    createdAt: timestamp("created_at").defaultNow(),
});

// Type exports
export type ContractorTask = typeof contractorTasks.$inferSelect;
export type ContractorSkill = typeof contractorSkills.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type SlotHold = typeof slotHolds.$inferSelect;
```

---

## Phase 2: Core Services (Week 2)

### 2.1 State Machine Service

**File:** `server/services/state-machine.ts`

```typescript
import { db } from '../db';
import { leads } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { EventEmitter } from 'events';

export enum LeadState {
  CREATED = 'created',
  SKU_DETECTED = 'sku_detected',
  VIDEO_REQUESTED = 'video_requested',
  // ... all states from state-machine.md
}

const validTransitions: Record<LeadState, LeadState[]> = {
  [LeadState.CREATED]: [LeadState.SKU_DETECTED, LeadState.VIDEO_REQUESTED],
  // ... all transitions
};

export const leadEvents = new EventEmitter();

export async function transitionLead(
  leadId: string, 
  newState: LeadState,
  metadata?: Record<string, any>
): Promise<void> {
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, leadId),
  });

  if (!lead) {
    throw new Error(`Lead ${leadId} not found`);
  }

  const currentState = lead.state as LeadState;
  
  if (!validTransitions[currentState]?.includes(newState)) {
    throw new Error(`Invalid transition: ${currentState} → ${newState}`);
  }

  await db.update(leads)
    .set({
      state: newState,
      stateChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  // Emit event for side effects
  leadEvents.emit('stateChanged', {
    leadId,
    from: currentState,
    to: newState,
    metadata,
  });
}
```

### 2.2 Availability Engine

**File:** `server/services/availability-engine.ts`

```typescript
import { db } from '../db';
import { 
  handymanProfiles, 
  contractorSkills, 
  contractorAvailabilityDates,
  slotHolds,
  bookings 
} from '../../shared/schema';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';

interface AvailableSlot {
  date: string;
  slots: Array<{ time: 'am' | 'pm'; contractorCount: number }>;
}

export async function getAvailableSlotsForJob(
  taskIds: string[],
  postcode: string,
  fromDate: Date,
  toDate: Date
): Promise<AvailableSlot[]> {
  // 1. Find contractors with required skills
  const qualifiedContractors = await db.query.contractorSkills.findMany({
    where: inArray(contractorSkills.taskId, taskIds),
    with: {
      handyman: true,
    },
  });

  const contractorIds = [...new Set(
    qualifiedContractors.map(cs => cs.handymanId)
  )];

  if (contractorIds.length === 0) {
    return [];
  }

  // 2. Get their availability
  const availability = await db.query.contractorAvailabilityDates.findMany({
    where: and(
      inArray(contractorAvailabilityDates.contractorId, contractorIds),
      gte(contractorAvailabilityDates.date, fromDate),
      lte(contractorAvailabilityDates.date, toDate),
      eq(contractorAvailabilityDates.isAvailable, true)
    ),
  });

  // 3. Get existing bookings (to exclude)
  const existingBookings = await db.query.bookings.findMany({
    where: and(
      inArray(bookings.contractorId, contractorIds),
      gte(bookings.date, fromDate),
      lte(bookings.date, toDate),
      eq(bookings.status, 'confirmed')
    ),
  });

  // 4. Get active holds (to exclude)
  const activeHolds = await db.query.slotHolds.findMany({
    where: and(
      inArray(slotHolds.contractorId, contractorIds),
      gte(slotHolds.expiresAt, new Date())
    ),
  });

  // 5. Build available slots map
  const slotMap = new Map<string, { am: number; pm: number }>();

  for (const avail of availability) {
    const dateKey = avail.date.toISOString().split('T')[0];
    const contractorId = avail.contractorId;

    // Check if blocked by booking
    const isBookedAM = existingBookings.some(b => 
      b.contractorId === contractorId && 
      b.date.toISOString().split('T')[0] === dateKey &&
      b.timeSlot === 'am'
    );
    const isBookedPM = existingBookings.some(b => 
      b.contractorId === contractorId && 
      b.date.toISOString().split('T')[0] === dateKey &&
      b.timeSlot === 'pm'
    );

    // Check if held
    const isHeldAM = activeHolds.some(h => 
      h.contractorId === contractorId && 
      h.date.toISOString().split('T')[0] === dateKey &&
      h.timeSlot === 'am'
    );
    const isHeldPM = activeHolds.some(h => 
      h.contractorId === contractorId && 
      h.date.toISOString().split('T')[0] === dateKey &&
      h.timeSlot === 'pm'
    );

    if (!slotMap.has(dateKey)) {
      slotMap.set(dateKey, { am: 0, pm: 0 });
    }

    const slot = slotMap.get(dateKey)!;
    if (!isBookedAM && !isHeldAM) slot.am++;
    if (!isBookedPM && !isHeldPM) slot.pm++;
  }

  // 6. Convert to response format
  const result: AvailableSlot[] = [];
  
  for (const [date, counts] of slotMap.entries()) {
    const slots: Array<{ time: 'am' | 'pm'; contractorCount: number }> = [];
    if (counts.am > 0) slots.push({ time: 'am', contractorCount: counts.am });
    if (counts.pm > 0) slots.push({ time: 'pm', contractorCount: counts.pm });
    
    if (slots.length > 0) {
      result.push({ date, slots });
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}
```

### 2.3 Contractor Matcher

**File:** `server/services/contractor-matcher.ts`

```typescript
import { db } from '../db';
import { 
  contractorSkills, 
  handymanProfiles,
  jobMatchingHistory 
} from '../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

interface MatchResult {
  contractorId: string;
  name: string;
  score: number;
  distance: number;
  confidence: string;
}

export async function findBestContractor(
  taskIds: string[],
  date: Date,
  timeSlot: 'am' | 'pm',
  postcode: string
): Promise<MatchResult | null> {
  // 1. Get qualified + available contractors
  const qualified = await db.query.contractorSkills.findMany({
    where: inArray(contractorSkills.taskId, taskIds),
    with: {
      handyman: {
        with: {
          user: true,
        },
      },
    },
  });

  // Group by contractor, get best confidence
  const contractorMap = new Map<string, {
    profile: any;
    user: any;
    bestConfidence: string;
    skillCount: number;
  }>();

  for (const skill of qualified) {
    const existing = contractorMap.get(skill.handymanId);
    if (!existing) {
      contractorMap.set(skill.handymanId, {
        profile: skill.handyman,
        user: skill.handyman.user,
        bestConfidence: skill.confidence,
        skillCount: 1,
      });
    } else {
      existing.skillCount++;
      if (skill.confidence === 'expert') {
        existing.bestConfidence = 'expert';
      }
    }
  }

  // 2. Score each contractor
  const scored: MatchResult[] = [];

  for (const [contractorId, data] of contractorMap.entries()) {
    let score = 0;

    // Skill match (35 pts)
    if (data.bestConfidence === 'expert') {
      score += 35;
    } else {
      score += 20;
    }
    score += Math.min(data.skillCount * 5, 15); // Bonus for multiple skills

    // Proximity (20 pts) - simplified for now
    const distance = calculateDistance(postcode, data.profile.postcode);
    score += Math.max(0, 20 - (distance * 2));

    // Performance (15 pts) - TODO: implement when we have data
    score += 10; // Default

    // Reliability (10 pts) - TODO: implement
    score += 8; // Default

    // Workload (10 pts) - TODO: check active jobs
    score += 8; // Default

    // Recency (5 pts) - TODO: check last job date
    score += 3; // Default

    // Specialization (5 pts) - TODO: calculate
    score += 3; // Default

    scored.push({
      contractorId,
      name: `${data.user.firstName} ${data.user.lastName}`,
      score,
      distance,
      confidence: data.bestConfidence,
    });
  }

  // 3. Sort by score
  scored.sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

function calculateDistance(postcode1: string, postcode2: string): number {
  // Simplified - in production, use geocoding
  // For now, return mock distance based on postcode match
  if (postcode1.substring(0, 2) === postcode2.substring(0, 2)) {
    return 1; // Same area
  }
  if (postcode1.substring(0, 1) === postcode2.substring(0, 1)) {
    return 5; // Same region
  }
  return 15; // Different region
}
```

---

## Phase 3: Quote & Booking Flow (Week 3)

### 3.1 Quote Generator Service

**File:** `server/services/quote-generator.ts`

```typescript
import { db } from '../db';
import { quotes, leads } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { nanoid } from 'nanoid';

interface LineItem {
  skuId?: string;
  description: string;
  pricePence: number;
  quantity: number;
}

interface GenerateQuoteOptions {
  leadId: string;
  lineItems: LineItem[];
  style: 'hhh' | 'fixed' | 'fixed_optionals';
  customerType?: 'homeowner' | 'landlord' | 'pm' | 'commercial';
  createdBy: 'system' | 'va' | 'estimator';
}

export async function generateQuote(options: GenerateQuoteOptions) {
  const { leadId, lineItems, style, customerType, createdBy } = options;

  // Calculate total with customer type modifier
  let total = lineItems.reduce((sum, item) => 
    sum + (item.pricePence * item.quantity), 0
  );

  // Apply customer type modifier
  switch (customerType) {
    case 'pm':
      total = Math.round(total * 0.85); // -15%
      break;
    case 'commercial':
      total = Math.round(total * 1.20); // +20%
      break;
    // homeowner and landlord = standard
  }

  const quoteId = uuid();
  const shortSlug = nanoid(8);
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days

  await db.insert(quotes).values({
    id: quoteId,
    leadId,
    version: 1,
    style,
    total,
    depositPercent: 20,
    lineItems: JSON.stringify(lineItems),
    expiresAt,
    createdBy,
  });

  // Update lead state
  await db.update(leads)
    .set({ state: 'quote_generated' })
    .where(eq(leads.id, leadId));

  return {
    quoteId,
    shortSlug,
    quoteUrl: `https://handyservices.app/quote-link/${shortSlug}`,
    total,
    depositAmount: Math.round(total * 0.20),
    expiresAt,
  };
}
```

### 3.2 Slot Holder Service

**File:** `server/services/slot-holder.ts`

```typescript
import { db } from '../db';
import { slotHolds } from '../../shared/schema';
import { eq, and, gte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const HOLD_TTL_SECONDS = 300; // 5 minutes

interface HoldSlotResult {
  holdId: string;
  expiresAt: Date;
  ttlSeconds: number;
}

export async function holdSlot(
  contractorId: string,
  date: Date,
  timeSlot: 'am' | 'pm',
  sessionId: string
): Promise<HoldSlotResult> {
  // Check if slot already held
  const existing = await db.query.slotHolds.findFirst({
    where: and(
      eq(slotHolds.contractorId, contractorId),
      eq(slotHolds.date, date),
      eq(slotHolds.timeSlot, timeSlot),
      gte(slotHolds.expiresAt, new Date())
    ),
  });

  if (existing) {
    // Check if it's our own hold (same session)
    if (existing.sessionId === sessionId) {
      return {
        holdId: existing.id,
        expiresAt: existing.expiresAt,
        ttlSeconds: Math.floor((existing.expiresAt.getTime() - Date.now()) / 1000),
      };
    }
    
    throw new Error('SLOT_UNAVAILABLE');
  }

  // Create new hold
  const holdId = uuid();
  const expiresAt = new Date(Date.now() + HOLD_TTL_SECONDS * 1000);

  await db.insert(slotHolds).values({
    id: holdId,
    contractorId,
    date,
    timeSlot,
    sessionId,
    expiresAt,
  });

  return {
    holdId,
    expiresAt,
    ttlSeconds: HOLD_TTL_SECONDS,
  };
}

export async function releaseHold(holdId: string): Promise<void> {
  await db.delete(slotHolds).where(eq(slotHolds.id, holdId));
}

export async function cleanupExpiredHolds(): Promise<number> {
  const result = await db.delete(slotHolds)
    .where(lt(slotHolds.expiresAt, new Date()));
  
  return result.rowCount || 0;
}
```

---

## Phase 4: Frontend (Week 4)

### 4.1 Contractor Skill Selection Component

**File:** `client/src/pages/ContractorSkillSelection.tsx`

```tsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';

interface Task {
  id: string;
  name: string;
  category: string;
}

interface Skill {
  taskId: string;
  confidence: 'expert' | 'capable';
}

export default function ContractorSkillSelection() {
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedSkills, setSelectedSkills] = useState<Map<string, 'expert' | 'capable'>>(new Map());

  const { data: tasks } = useQuery<Task[]>({
    queryKey: ['contractor-tasks'],
    queryFn: () => fetch('/api/contractor/tasks').then(r => r.json()).then(d => d.tasks),
  });

  const saveMutation = useMutation({
    mutationFn: (skills: Skill[]) =>
      fetch('/api/contractor/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(['contractor-skills']);
    },
  });

  const tasksByCategory = tasks?.reduce((acc, task) => {
    if (!acc[task.category]) acc[task.category] = [];
    acc[task.category].push(task);
    return acc;
  }, {} as Record<string, Task[]>) || {};

  const toggleTask = (taskId: string, confidence: 'expert' | 'capable') => {
    const newSkills = new Map(selectedSkills);
    if (newSkills.get(taskId) === confidence) {
      newSkills.delete(taskId);
    } else {
      newSkills.set(taskId, confidence);
    }
    setSelectedSkills(newSkills);
  };

  const handleSave = () => {
    const skills = Array.from(selectedSkills.entries()).map(([taskId, confidence]) => ({
      taskId,
      confidence,
    }));
    saveMutation.mutate(skills);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Select Your Skills</h1>
        <p className="text-slate-400 mb-6">
          {selectedSkills.size} of {tasks?.length || 0} tasks selected
        </p>

        <div className="space-y-4">
          {Object.entries(tasksByCategory).map(([category, categoryTasks]) => (
            <div key={category} className="bg-white/5 rounded-xl overflow-hidden">
              <button
                onClick={() => {
                  const newExpanded = new Set(expandedCategories);
                  if (newExpanded.has(category)) {
                    newExpanded.delete(category);
                  } else {
                    newExpanded.add(category);
                  }
                  setExpandedCategories(newExpanded);
                }}
                className="w-full flex items-center justify-between p-4 text-left"
              >
                <span className="text-white font-medium">
                  {category} ({categoryTasks.filter(t => selectedSkills.has(t.id)).length})
                </span>
                {expandedCategories.has(category) ? (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                )}
              </button>

              {expandedCategories.has(category) && (
                <div className="px-4 pb-4 space-y-2">
                  {categoryTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5"
                    >
                      <span className="text-slate-300">{task.name}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleTask(task.id, 'capable')}
                          className={`px-3 py-1 rounded-full text-sm ${
                            selectedSkills.get(task.id) === 'capable'
                              ? 'bg-yellow-500 text-black'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          Capable
                        </button>
                        <button
                          onClick={() => toggleTask(task.id, 'expert')}
                          className={`px-3 py-1 rounded-full text-sm ${
                            selectedSkills.get(task.id) === 'expert'
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          Expert
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="w-full mt-6 py-4 bg-emerald-500 text-white rounded-xl font-semibold"
        >
          {saveMutation.isPending ? 'Saving...' : `Save ${selectedSkills.size} Skills`}
        </button>
      </div>
    </div>
  );
}
```

---

## Testing Checklist

### Phase 1 Verification
- [ ] Migration runs without errors
- [ ] Task taxonomy seeded (70 tasks)
- [ ] Schema types compile correctly

### Phase 2 Verification
- [ ] State machine transitions work
- [ ] Invalid transitions are rejected
- [ ] Availability engine returns correct slots
- [ ] Contractor matcher scores correctly

### Phase 3 Verification
- [ ] Quotes generate with correct pricing
- [ ] Slot holds work (5-min TTL)
- [ ] Race conditions prevented
- [ ] Payments integrate with Stripe

### Phase 4 Verification
- [ ] Skill selection UI works
- [ ] Contractors can select/deselect skills
- [ ] Skills persist correctly
- [ ] Quote page shows available dates

---

## Deployment Checklist

1. [ ] Run database migration
2. [ ] Seed task taxonomy
3. [ ] Deploy backend services
4. [ ] Deploy frontend updates
5. [ ] Configure Stripe webhooks
6. [ ] Test end-to-end booking flow
7. [ ] Monitor for errors
