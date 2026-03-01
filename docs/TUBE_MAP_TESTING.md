# Lead Tube Map - Testing Documentation

## Overview

The Lead Tube Map is a London Tube-style visualization of the lead pipeline. It displays leads as "passengers" traveling along different "lines" (routes) through "stations" (stages). This document provides comprehensive testing procedures.

## Visual Concept

```
                    LEAD TUBE MAP
    ================================================

    [VIDEO LINE - Blue]
    o--New Lead--o--Contacted--o--Video Req--o--Quote--o--Booked--o

    [INSTANT QUOTE LINE - Green]
    o--New Lead--o--Contacted--o--Quote Sent--o--Payment--o--Booked--o

    [SITE VISIT LINE - Orange]
    o--New Lead--o--Contacted--o--Visit Booked--o--Quote--o--Booked--o

    [CALLBACK LINE - Red]
    o--New Lead--o--Callback Due--o--Contacted--o--> (joins other line)
```

---

## Components

### Backend

1. **Schema** (`shared/schema.ts`)
   - `leadStageEnum`: PostgreSQL enum with stages
   - `leads.stage`: Current stage column
   - `leads.stageUpdatedAt`: Timestamp for SLA tracking
   - Route tracking (when implemented): `leads.route`, `leads.routeAssignedAt`

2. **Stage Engine** (`server/lead-stage-engine.ts`)
   - `computeLeadStage()`: Auto-computes stage from related data
   - `updateLeadStage()`: Updates stage with validation
   - `getSLAStatus()`: Returns ok/warning/overdue
   - `getStageDisplayName()`: Human-readable names
   - `getNextAction()`: Suggested action per stage

3. **API Endpoints** (`server/leads.ts` / `server/lead-tube-map.ts`)
   - `GET /api/admin/lead-tube-map`: Main tube map data
   - `GET /api/admin/lead-funnel`: Column-based funnel view
   - `PATCH /api/admin/leads/:id/stage`: Update stage
   - `POST /api/admin/leads/:id/move`: Move lead on map
   - `POST /api/admin/leads/:id/route`: Assign route
   - `POST /api/admin/leads/:id/segment`: Update segment
   - `POST /api/admin/leads/:id/snooze`: Snooze lead
   - `POST /api/admin/leads/:id/merge`: Merge duplicate leads

### Frontend

1. **TubeMapPage** (`client/src/pages/admin/TubeMapPage.tsx` - when created)
   - SVG-based tube map visualization
   - Real-time updates via WebSocket
   - Click-to-expand station details
   - Drag-to-move lead capabilities

2. **Route**: `/admin/tube-map`

---

## Manual Testing Checklist

### Pre-requisites

- [ ] Database schema is up to date: `npm run db:push`
- [ ] Server is running: `npm run dev`
- [ ] Have at least 5-10 test leads in the database
- [ ] Test leads should be in various stages

### Navigation & Layout

- [ ] Navigate to `/admin/tube-map`
- [ ] Page loads without errors
- [ ] Tube map SVG renders correctly
- [ ] All route lines are visible with correct colors:
  - [ ] Video Route (Blue)
  - [ ] Instant Quote Route (Green)
  - [ ] Site Visit Route (Orange)
  - [ ] Callback Route (Red)
- [ ] Station dots appear at correct positions
- [ ] Lead counts show on each station

### Station Interactions

- [ ] Hover over station - tooltip shows stage name + count
- [ ] Click station - leads panel opens on right side
- [ ] Panel shows list of leads at that station
- [ ] Each lead card shows:
  - [ ] Customer name
  - [ ] Phone number
  - [ ] Job description (truncated)
  - [ ] Time in stage
  - [ ] SLA indicator (green/yellow/red)
  - [ ] Segment color indicator

### Lead Detail Panel

- [ ] Click a lead in the list
- [ ] Detail panel slides in
- [ ] Shows full customer information
- [ ] Shows job description
- [ ] Shows quote details (if exists)
- [ ] Shows conversation history summary
- [ ] Quick action buttons appear:
  - [ ] Call
  - [ ] WhatsApp (if 24h window active)
  - [ ] View Quote
  - [ ] Edit

### Stage Transitions

- [ ] "Move to" dropdown shows valid next stages
- [ ] Select a stage - confirmation dialog appears
- [ ] Confirm move - lead animates to new station
- [ ] Toast notification shows success
- [ ] Try backward move without force - should fail
- [ ] Use "Force move" option - should succeed with warning

### Route Assignment

- [ ] Click "Change Route" button
- [ ] Route options appear:
  - [ ] Video Route
  - [ ] Instant Quote Route
  - [ ] Site Visit Route
  - [ ] Callback Route
- [ ] Select route - lead moves to that line
- [ ] Route assignment timestamp is recorded

### Segment Changes

- [ ] Click segment color indicator
- [ ] Segment picker appears:
  - [ ] BUSY_PRO (Professional blue)
  - [ ] PROP_MGR (Corporate gray)
  - [ ] LANDLORD (Property green)
  - [ ] DIY_DEFERRER (DIY orange)
  - [ ] BUDGET (Budget yellow)
  - [ ] UNKNOWN (Gray)
- [ ] Select segment - lead color updates
- [ ] Quote segment also updates (if linked)

### Snooze Functionality

- [ ] Click "Snooze" button on lead
- [ ] Snooze options appear:
  - [ ] 1 hour
  - [ ] 4 hours
  - [ ] Tomorrow morning
  - [ ] Custom date/time
- [ ] Select snooze duration
- [ ] Lead disappears from active view
- [ ] "Show Snoozed" toggle reveals snoozed leads (dimmed)
- [ ] Snoozed lead shows "Until: [datetime]"

### Merge Functionality

- [ ] Select two leads with same phone number
- [ ] "Merge" button appears
- [ ] Click merge - confirmation dialog shows:
  - [ ] Which lead to keep as primary
  - [ ] What data will be merged
- [ ] Confirm merge
- [ ] Secondary lead disappears
- [ ] Primary lead has combined history

### Real-time Updates

- [ ] Open tube map in two browser tabs
- [ ] In Tab 1: Move a lead to different stage
- [ ] In Tab 2: Verify lead updates without refresh
- [ ] Make a test call to create new lead
- [ ] Verify new lead appears on map in real-time
- [ ] Send test WhatsApp - verify activity shows

### SLA Testing

- [ ] Create new lead - shows green SLA indicator
- [ ] Wait 20+ minutes - changes to yellow (warning)
- [ ] Wait 30+ minutes - changes to red (overdue)
- [ ] Station with overdue leads has warning badge
- [ ] Overdue count shows in header stats

### Mobile Responsiveness

- [ ] View on mobile device or narrow window
- [ ] Tube map scrolls horizontally
- [ ] Tap station opens leads panel (full screen on mobile)
- [ ] Lead cards are touch-friendly
- [ ] Actions work via touch

---

## Automated Testing

### Run All Tube Map Tests

```bash
# Basic API and engine tests
npx tsx scripts/test-tube-map.ts

# With API endpoint tests (requires running server)
npx tsx scripts/test-tube-map.ts --api

# E2E flow tests
npx tsx scripts/test-tube-map-flow.ts

# Route detection tests
npx tsx scripts/test-route-detection.ts

# WebSocket real-time tests
npx tsx scripts/test-tube-map-websocket.ts

# Web form auto-chase tests
npx tsx scripts/test-webform-chase.ts
npx tsx scripts/test-webform-chase.ts --dry-run

# Data integrity verification
npx tsx scripts/verify-tube-map-data.ts
npx tsx scripts/verify-tube-map-data.ts --fix
```

### Test Coverage

| Test File | Coverage |
|-----------|----------|
| `test-tube-map.ts` | Stage engine, transitions, SLA |
| `test-tube-map-flow.ts` | Call, WhatsApp, Web Form journeys |
| `test-route-detection.ts` | Transcript analysis for routes |
| `test-tube-map-websocket.ts` | Real-time event delivery |
| `test-webform-chase.ts` | Auto-chase automation |
| `verify-tube-map-data.ts` | Data integrity checks |

---

## API Testing (curl examples)

```bash
# Get tube map data
curl http://localhost:5000/api/admin/lead-tube-map

# Get funnel data
curl http://localhost:5000/api/admin/lead-funnel

# Get single lead
curl http://localhost:5000/api/admin/leads/lead_xxx

# Update stage
curl -X PATCH http://localhost:5000/api/admin/leads/lead_xxx/stage \
  -H "Content-Type: application/json" \
  -d '{"stage": "contacted", "reason": "Manual update"}'

# Assign route (when implemented)
curl -X POST http://localhost:5000/api/admin/leads/lead_xxx/route \
  -H "Content-Type: application/json" \
  -d '{"route": "video"}'

# Update segment (when implemented)
curl -X POST http://localhost:5000/api/admin/leads/lead_xxx/segment \
  -H "Content-Type: application/json" \
  -d '{"segment": "BUSY_PRO"}'

# Snooze lead (when implemented)
curl -X POST http://localhost:5000/api/admin/leads/lead_xxx/snooze \
  -H "Content-Type: application/json" \
  -d '{"until": "2025-02-19T09:00:00Z"}'

# Merge leads (when implemented)
curl -X POST http://localhost:5000/api/admin/leads/lead_xxx/merge \
  -H "Content-Type: application/json" \
  -d '{"mergeIntoId": "lead_yyy"}'
```

---

## WebSocket Events

The tube map uses WebSocket for real-time updates. Events to test:

| Event | Trigger | Payload |
|-------|---------|---------|
| `lead:created` | New lead created | `{ leadId, stage, route }` |
| `lead:stage_change` | Stage updated | `{ leadId, oldStage, newStage }` |
| `lead:route_assigned` | Route assigned | `{ leadId, route }` |
| `lead:snoozed` | Lead snoozed | `{ leadId, until }` |
| `lead:unsnoozed` | Snooze expired | `{ leadId }` |
| `lead:merged` | Leads merged | `{ primaryId, mergedId }` |
| `quote:created` | Quote created | `{ quoteId, leadId }` |
| `quote:viewed` | Quote viewed | `{ quoteId, leadId }` |
| `quote:selected` | Package selected | `{ quoteId, leadId, package }` |
| `payment:received` | Payment successful | `{ quoteId, leadId }` |

---

## Route Detection Test Cases

### Video Route
```
"Can you send us a video of the tap?"                    -> video
"If you could WhatsApp us a quick video..."              -> video
"Take a video showing the leak under the sink"           -> video
```

### Instant Quote Route
```
"That's GBP85 for the TV mounting"                       -> instant_quote
"I can quote you right now - GBP120 all-in"              -> instant_quote
"Simple job, GBP65 for the first hour"                   -> instant_quote
```

### Site Visit Route
```
"I'll need to come and see the property first"           -> site_visit
"That requires a site assessment"                         -> site_visit
"I need to survey the area before quoting"               -> site_visit
```

### Callback Route
```
"Someone will call you back within the hour"             -> callback
"Let me get the details and ring you back"               -> callback
```

---

## Data Integrity Checks

Run `npx tsx scripts/verify-tube-map-data.ts` to check:

1. **Valid Stages**: All leads have valid stage values
2. **Stage/Quote Consistency**: Stage matches quote state
3. **Timestamps**: All leads have stageUpdatedAt
4. **Orphaned Quotes**: No quotes without linked leads
5. **Stage Distribution**: Balanced funnel progression
6. **Conversation Alignment**: Conversations linked to leads
7. **Duplicates**: No duplicate phone numbers
8. **Stale Leads**: Leads stuck in quote stages > 7 days

---

## Known Issues / Limitations

1. **Route Assignment**: Currently manual - autonomous detection planned
2. **WebSocket Events**: Some events may not be implemented yet
3. **Mobile Drag**: Drag-and-drop may not work on touch devices
4. **Large Datasets**: May need pagination for 500+ leads
5. **Snooze Persistence**: Snoozed leads need cron job to un-snooze
6. **Merge Undo**: No undo for merge operations

---

## SLA Thresholds

| Stage | SLA Time | Warning At |
|-------|----------|------------|
| New Lead | 30 min | 23 min |
| Contacted | 24 hours | 18 hours |
| Awaiting Video | 24 hours | 18 hours |
| Quote Sent | 12 hours | 9 hours |
| Quote Viewed | 24 hours | 18 hours |
| Awaiting Payment | 12 hours | 9 hours |
| Booked | None | - |
| In Progress | None | - |
| Completed | None | - |

---

## Future Enhancements

1. Autonomous route detection from call transcripts
2. Drag-and-drop leads between stations
3. Route performance analytics
4. A/B test different route strategies
5. AI-suggested next best action
6. Batch operations (move multiple leads)
7. Custom route creation
8. Integration with calendar for site visits
