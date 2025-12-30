# Database Schema & Entity Relationship Diagram

**Version:** 1.0  
**Date:** 2025-12-28

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              HANDY SERVICES DATABASE ERD                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     1:N     ┌──────────────────┐     N:1     ┌──────────────────┐
│      users       │─────────────│ handyman_profiles │─────────────│ contractor_skills│
│──────────────────│             │──────────────────│             │──────────────────│
│ id (PK)          │             │ id (PK)          │             │ id (PK)          │
│ email            │             │ user_id (FK)     │             │ handyman_id (FK) │
│ role             │             │ postcode         │             │ task_id (FK)     │
│ ...              │             │ radius_miles     │             │ confidence       │
└──────────────────┘             │ ...              │             │ completed_count  │
                                 └──────────────────┘             └────────┬─────────┘
                                        │                                  │
                                        │ 1:N                              │ N:1
                                        ▼                                  ▼
                          ┌──────────────────────────┐          ┌──────────────────┐
                          │ contractor_availability  │          │ contractor_tasks │
                          │ _dates                   │          │──────────────────│
                          │──────────────────────────│          │ id (PK)          │
                          │ id (PK)                  │          │ name             │
                          │ contractor_id (FK)       │          │ category         │
                          │ date                     │          │ ...              │
                          │ is_available             │          └──────────────────┘
                          │ start_time               │
                          │ end_time                 │
                          └──────────────────────────┘
                                        │
                                        │ Referenced by
                                        ▼
┌──────────────────┐     1:N     ┌──────────────────┐     1:1     ┌──────────────────┐
│      leads       │─────────────│     quotes       │─────────────│    bookings      │
│──────────────────│             │──────────────────│             │──────────────────│
│ id (PK)          │             │ id (PK)          │             │ id (PK)          │
│ customer_name    │             │ lead_id (FK)     │             │ quote_id (FK)    │
│ phone            │             │ version          │             │ contractor_id(FK)│
│ state            │             │ style            │             │ date             │
│ customer_type    │             │ total            │             │ time_slot        │
│ source           │             │ line_items       │             │ payment_intent_id│
│ expires_at       │             │ expires_at       │             │ status           │
│ ...              │             │ ...              │             │ ...              │
└──────────────────┘             └──────────────────┘             └──────────────────┘
        │                                │                                │
        │ 1:N                            │                                │
        ▼                                │                                │
┌──────────────────────┐                 │                                │
│ job_task_requirements│                 │                                │
│──────────────────────│                 │                                │
│ id (PK)              │                 │                                │
│ lead_id (FK)         │                 │                                │
│ task_id (FK)         │◄────────────────┼────────────────────────────────┘
│ required_confidence  │                 │           Links job to tasks
│ is_primary           │                 │
│ ai_confidence        │                 │
└──────────────────────┘                 │
                                         │
┌──────────────────┐                     │     ┌──────────────────┐
│  video_scores    │                     │     │   slot_holds     │
│──────────────────│                     │     │──────────────────│
│ id (PK)          │                     │     │ id (PK)          │
│ lead_id (FK)     │                     │     │ contractor_id(FK)│
│ video_url        │                     │     │ date             │
│ transcript       │                     │     │ time_slot        │
│ complexity_score │                     │     │ session_id       │
│ quotable_score   │                     │     │ expires_at       │
│ detected_skus    │                     │     └──────────────────┘
│ ...              │                     │
└──────────────────┘                     │
                                         │
┌──────────────────┐                     │     ┌──────────────────────────┐
│ estimator_queue  │                     │     │   job_matching_history   │
│──────────────────│                     │     │──────────────────────────│
│ id (PK)          │                     │     │ id (PK)                  │
│ lead_id (FK)     │◄────────────────────┘     │ booking_id (FK)          │
│ priority         │                           │ contractor_id (FK)       │
│ assigned_to      │                           │ match_score              │
│ status           │                           │ was_selected             │
│ ...              │                           │ job_completed            │
└──────────────────┘                           │ customer_rating          │
                                               └──────────────────────────┘
```

---

## New Tables (V1)

### 1. contractor_tasks
**Purpose:** Master list of ~70 specific tasks contractors can perform

```sql
CREATE TABLE contractor_tasks (
    id VARCHAR PRIMARY KEY,
    name VARCHAR(200) NOT NULL,           -- "Fix leaking taps/faucets"
    category VARCHAR(50) NOT NULL,         -- "Plumbing"
    description TEXT,
    requires_certification BOOLEAN DEFAULT FALSE,
    certification_name VARCHAR(100),       -- "Gas Safe"
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Seed with ~70 tasks across 6 categories
-- See: scripts/seed-contractor-tasks.ts
```

### 2. contractor_skills
**Purpose:** Junction table - which tasks each contractor can do + confidence level

```sql
CREATE TABLE contractor_skills (
    id VARCHAR PRIMARY KEY,
    handyman_id VARCHAR REFERENCES handyman_profiles(id) NOT NULL,
    task_id VARCHAR REFERENCES contractor_tasks(id) NOT NULL,
    confidence VARCHAR(20) NOT NULL,       -- "expert" | "capable"
    years_experience INTEGER,
    completed_count INTEGER DEFAULT 0,     -- System tracks completions
    last_performed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(handyman_id, task_id)
);
```

### 3. quotes
**Purpose:** Generated quotes with versioning support

```sql
CREATE TABLE quotes (
    id VARCHAR PRIMARY KEY,
    lead_id VARCHAR REFERENCES leads(id),
    version INTEGER DEFAULT 1,
    style VARCHAR(20),                     -- "hhh" | "fixed" | "fixed_optionals"
    total INTEGER,                         -- Total in pence
    deposit_percent INTEGER DEFAULT 20,
    line_items JSONB,                      -- [{sku_id, description, price, qty}]
    optional_items JSONB,                  -- For HHH/optionals
    expires_at TIMESTAMP,                  -- 3 days from creation
    sent_at TIMESTAMP,
    viewed_at TIMESTAMP,
    accepted_at TIMESTAMP,
    created_by VARCHAR,                    -- "va" | "estimator" | "system"
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_quotes_lead ON quotes(lead_id);
CREATE INDEX idx_quotes_expires ON quotes(expires_at);
```

### 4. bookings
**Purpose:** Confirmed bookings with payment + contractor assignment

```sql
CREATE TABLE bookings (
    id VARCHAR PRIMARY KEY,
    quote_id VARCHAR REFERENCES quotes(id),
    contractor_id VARCHAR REFERENCES handyman_profiles(id),
    date DATE NOT NULL,
    time_slot VARCHAR(20) NOT NULL,        -- "am" | "pm" | "09:00"
    payment_intent_id VARCHAR,             -- Stripe Payment Intent
    deposit_amount INTEGER,                -- Amount in pence
    status VARCHAR(20),                    -- "confirmed" | "cancelled" | "completed"
    confirmed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    completed_at TIMESTAMP,
    cancellation_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bookings_contractor ON bookings(contractor_id);
CREATE INDEX idx_bookings_date ON bookings(date);
CREATE INDEX idx_bookings_status ON bookings(status);
```

### 5. slot_holds
**Purpose:** Temporary holds to prevent race conditions during checkout

```sql
CREATE TABLE slot_holds (
    id VARCHAR PRIMARY KEY,
    contractor_id VARCHAR REFERENCES handyman_profiles(id) NOT NULL,
    date DATE NOT NULL,
    time_slot VARCHAR(20) NOT NULL,
    session_id VARCHAR NOT NULL,           -- Customer session identifier
    expires_at TIMESTAMP NOT NULL,         -- 5 minutes from creation
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_slot_holds_contractor ON slot_holds(contractor_id, date, time_slot);
CREATE INDEX idx_slot_holds_expires ON slot_holds(expires_at);

-- Cleanup job runs every minute to delete expired holds
```

### 6. job_task_requirements
**Purpose:** Maps jobs/leads to required tasks (AI-tagged or manual)

```sql
CREATE TABLE job_task_requirements (
    id VARCHAR PRIMARY KEY,
    lead_id VARCHAR REFERENCES leads(id),
    task_id VARCHAR REFERENCES contractor_tasks(id) NOT NULL,
    required_confidence VARCHAR(20) NOT NULL, -- "expert" | "capable"
    is_primary BOOLEAN DEFAULT TRUE,
    ai_confidence INTEGER,                 -- 0-100 if AI-tagged
    manually_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_job_tasks_lead ON job_task_requirements(lead_id);
```

### 7. video_scores
**Purpose:** AI analysis results for video quotes

```sql
CREATE TABLE video_scores (
    id VARCHAR PRIMARY KEY,
    lead_id VARCHAR REFERENCES leads(id),
    video_url TEXT,
    transcript TEXT,
    extracted_frames JSONB,                -- URLs to key frames
    complexity_score INTEGER,              -- 0-100
    quotable_score INTEGER,                -- 0-100 (can we quote without human?)
    detected_skus JSONB,                   -- [{sku_id, confidence}]
    detected_tasks JSONB,                  -- [{task_id, confidence}]
    recommended_action VARCHAR(20),        -- "auto_quote" | "estimator"
    scored_at TIMESTAMP
);

CREATE INDEX idx_video_scores_lead ON video_scores(lead_id);
```

### 8. estimator_queue
**Purpose:** Queue for videos needing manual estimator review

```sql
CREATE TABLE estimator_queue (
    id VARCHAR PRIMARY KEY,
    lead_id VARCHAR REFERENCES leads(id),
    priority INTEGER DEFAULT 0,            -- Higher = more urgent
    assigned_to VARCHAR,                   -- Estimator user ID
    status VARCHAR(20),                    -- "queued" | "in_progress" | "complete"
    claimed_at TIMESTAMP,
    completed_at TIMESTAMP,
    last_reminder_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_estimator_queue_status ON estimator_queue(status, priority);
CREATE INDEX idx_estimator_queue_assigned ON estimator_queue(assigned_to);
```

### 9. job_matching_history
**Purpose:** Track matching decisions for learning/analytics

```sql
CREATE TABLE job_matching_history (
    id VARCHAR PRIMARY KEY,
    booking_id VARCHAR REFERENCES bookings(id),
    contractor_id VARCHAR REFERENCES handyman_profiles(id) NOT NULL,
    match_score INTEGER,                   -- 0-100
    was_selected BOOLEAN DEFAULT FALSE,
    job_completed BOOLEAN,
    customer_rating INTEGER,               -- 1-5
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_matching_history_contractor ON job_matching_history(contractor_id);
```

---

## Schema Updates to Existing Tables

### leads (UPDATE)
```sql
ALTER TABLE leads ADD COLUMN state VARCHAR(50) DEFAULT 'created';
ALTER TABLE leads ADD COLUMN state_changed_at TIMESTAMP;
ALTER TABLE leads ADD COLUMN customer_type VARCHAR(20); -- homeowner, landlord, pm, commercial
ALTER TABLE leads ADD COLUMN expires_at TIMESTAMP;

CREATE INDEX idx_leads_state ON leads(state);
CREATE INDEX idx_leads_customer_type ON leads(customer_type);
```

### handyman_profiles (UPDATE)
```sql
ALTER TABLE handyman_profiles ADD COLUMN max_concurrent_jobs INTEGER DEFAULT 3;
ALTER TABLE handyman_profiles ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE handyman_profiles ADD COLUMN reactive_mode BOOLEAN DEFAULT FALSE;
```

---

## Drizzle ORM Schema

See: `shared/schema.ts` for the TypeScript Drizzle ORM definitions.

Key additions:
```typescript
// New tables
export const contractorTasks = pgTable("contractor_tasks", {...});
export const contractorSkills = pgTable("contractor_skills", {...});
export const quotes = pgTable("quotes", {...});
export const bookings = pgTable("bookings", {...});
export const slotHolds = pgTable("slot_holds", {...});
export const jobTaskRequirements = pgTable("job_task_requirements", {...});
export const videoScores = pgTable("video_scores", {...});
export const estimatorQueue = pgTable("estimator_queue", {...});
export const jobMatchingHistory = pgTable("job_matching_history", {...});

// Relations
export const bookingsRelations = relations(bookings, ({ one }) => ({
    quote: one(quotes, {...}),
    contractor: one(handymanProfiles, {...}),
}));
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATA FLOW                               │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   INTAKE    │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌─────────────┐          ┌─────────────┐
       │    Call     │          │  WhatsApp   │
       │   (Twilio)  │          │   (Twilio)  │
       └──────┬──────┘          └──────┬──────┘
              │                        │
              └────────────┬───────────┘
                           ▼
                    ┌─────────────┐
                    │    leads    │  ◄── State machine
                    │   (table)   │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐
  │ SKU Detect  │  │ Video Score │  │ Estimator Queue │
  │ (instant)   │  │ (AI)        │  │ (manual)        │
  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘
         │                │                  │
         └────────────────┼──────────────────┘
                          ▼
                   ┌─────────────┐
                   │   quotes    │  ◄── Versioned
                   │   (table)   │
                   └──────┬──────┘
                          │
                          ▼
                   ┌─────────────┐
                   │ Quote Page  │  ◄── Customer-facing
                   │   (React)   │
                   └──────┬──────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌─────────────┐         ┌─────────────┐
       │ slot_holds  │         │   Stripe    │
       │ (5 min TTL) │         │  (Payment)  │
       └──────┬──────┘         └──────┬──────┘
              │                       │
              └───────────┬───────────┘
                          ▼
                   ┌─────────────┐
                   │  bookings   │  ◄── Confirmed
                   │   (table)   │
                   └──────┬──────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  Matching   │  ◄── Auto-assign
                   │  Algorithm  │
                   └──────┬──────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
  ┌─────────────────────┐   ┌─────────────────────┐
  │ contractor_jobs     │   │ job_matching_history│
  │ (assignment)        │   │ (analytics)         │
  └─────────────────────┘   └─────────────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  WhatsApp   │  ◄── Contractor notification
                   │  (Twilio)   │
                   └─────────────┘
```
