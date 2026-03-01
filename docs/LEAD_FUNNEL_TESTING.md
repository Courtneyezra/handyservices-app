# Lead Funnel Kanban - Testing Documentation

## Overview

The Lead Funnel Kanban is a visual board that displays leads organized by their current stage in the sales pipeline. It supports drag-and-drop stage transitions, SLA tracking, and quick actions.

## Components

### Backend

1. **Schema** (`shared/schema.ts`)
   - `leadStageEnum`: PostgreSQL enum with 11 stages
   - `leads.stage`: Column storing current stage
   - `leads.stageUpdatedAt`: Timestamp for SLA tracking

2. **Stage Engine** (`server/lead-stage-engine.ts`)
   - `computeLeadStage()`: Auto-computes stage from related data (calls, quotes, jobs)
   - `updateLeadStage()`: Updates stage with validation (no downgrade without force)
   - `getSLAStatus()`: Returns ok/warning/overdue based on time in stage
   - `getStageDisplayName()`: Human-readable stage names
   - `getNextAction()`: Suggested action for each stage
   - `syncAllLeadStages()`: Batch update all leads

3. **API Endpoints** (`server/leads.ts`)
   - `GET /api/admin/lead-funnel`: Returns all columns with items
   - `PATCH /api/admin/leads/:id/stage`: Update a lead's stage
   - `GET /api/admin/leads/:id`: Get single lead with enrichment

### Frontend

1. **LeadFunnelPage** (`client/src/pages/admin/LeadFunnelPage.tsx`)
   - Kanban board with @dnd-kit for drag-and-drop
   - Columns for each active stage
   - Lead cards with SLA indicators
   - Quick action buttons (Call, WhatsApp, Quote)

2. **Route**: `/admin/funnel`

3. **Navigation**: Added to sidebar under "OPERATIONS"

---

## Manual Testing Checklist

### Pre-requisites

- [ ] Database schema is up to date: `npm run db:push`
- [ ] Server is running: `npm run dev`
- [ ] Have at least 2-3 test leads in the database

### Navigation & Layout

- [ ] Navigate to `/admin/funnel`
- [ ] Page loads without errors
- [ ] Header shows "Lead Funnel" title
- [ ] Totals bar shows Active/Completed/Lost counts
- [ ] Refresh button works
- [ ] All stage columns are visible (scroll horizontally if needed)

### Columns Display

- [ ] Columns appear in correct order:
  - New Leads
  - Contacted
  - Quote Sent
  - Quote Viewed
  - Awaiting Payment
  - Booked
  - In Progress
  - (Terminal: Completed, Lost, Expired, Declined)
- [ ] Column headers show lead counts
- [ ] Columns have correct color indicators

### Lead Cards

- [ ] Cards display customer name
- [ ] Cards display job description (or "No description")
- [ ] Cards show time in stage (e.g., "5m", "2h 30m", "3 days")
- [ ] SLA badges display correctly:
  - Green "On Track" for new leads
  - Yellow "Hurry" for nearly due
  - Red "Overdue" for past SLA
- [ ] Next action displays at bottom of card

### Quick Actions

- [ ] Click "Call" button - opens tel: link
- [ ] Click "WhatsApp" button - navigates to inbox (if window open)
  - WhatsApp button only appears if 24h window is active
- [ ] Click "Quote" button - opens quote page in new tab
  - Quote button only appears if quote exists

### Drag and Drop

- [ ] Drag a card - card lifts and rotates slightly
- [ ] Drag over another column - drop target highlights
- [ ] Drop card in new column - stage updates
- [ ] Toast notification appears confirming stage change
- [ ] Try to drag card backwards (e.g., Quote Sent -> New Lead)
  - Should fail with error toast (downgrade blocked)

### SLA Testing

- [ ] Create a new lead and verify "On Track" badge
- [ ] Wait 20+ minutes - should show "Hurry" (approaching 30min SLA)
- [ ] Wait 30+ minutes - should show "Overdue"

### API Testing (via browser console or curl)

```bash
# Get funnel data
curl http://localhost:5000/api/admin/lead-funnel

# Update stage
curl -X PATCH http://localhost:5000/api/admin/leads/lead_xxx/stage \
  -H "Content-Type: application/json" \
  -d '{"stage": "contacted"}'

# Get single lead
curl http://localhost:5000/api/admin/leads/lead_xxx
```

### Mobile Responsiveness

- [ ] View on mobile device or resize window
- [ ] Columns scroll horizontally
- [ ] Cards are readable and actionable
- [ ] Drag works on touch devices (best effort)

---

## Automated Testing

Run the test script:

```bash
npx tsx scripts/test-lead-funnel.ts
```

Expected output: ALL TESTS PASSED

### What the test covers:

1. Creating a test lead
2. Computing initial stage (should be 'new_lead')
3. Updating stage to 'contacted'
4. Blocking downgrade (contacted -> new_lead)
5. Forcing downgrade (with force=true)
6. Creating a linked quote
7. Stage progression with quote (viewed -> awaiting_payment -> booked)
8. SLA status calculations (ok, warning, overdue)
9. Helper function verification

---

## Known Issues / Limitations

1. **WhatsApp 24h Window**: The "WhatsApp" button only appears if there's been inbound activity in the last 24 hours from that number.

2. **Stage Downgrade**: By design, stages cannot be downgraded without `force=true`. This prevents accidental data loss.

3. **Lost Lead Detection**: Leads are auto-marked as "lost" if no activity for 7 days after quote sent. This runs on stage recomputation.

4. **No Undo**: Drag-and-drop has no undo. Use force API call to revert.

5. **Large Dataset**: For 500+ leads, consider pagination (not implemented yet).

---

## SLA Thresholds

| Stage | SLA Time | Threshold |
|-------|----------|-----------|
| New Lead | 30 min | Contact customer ASAP |
| Contacted | 24 hours | Send quote |
| Quote Sent | 12 hours | Expect view |
| Quote Viewed | 24 hours | Close deal |
| Awaiting Payment | 12 hours | Chase payment |
| Booked | None | Wait for job date |
| In Progress | None | Monitor job |
| Completed | None | Request review |

---

## Future Enhancements

1. Batch stage updates
2. Filter by date range
3. Search/filter leads within funnel
4. Stage transition history/timeline
5. WhatsApp template buttons per stage
6. Automated reminders based on SLA
