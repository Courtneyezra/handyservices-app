# Frontend Manual Tests

Complete these tests in the browser to verify frontend functionality.

**Base URL:** `http://localhost:5173` (dev) or `https://handyservices.app` (prod)

---

## 1. Landlord Onboarding (`/landlord`)

### 1.1 Page Load
- [ ] Page loads without errors
- [ ] First slide displays with icon and content
- [ ] "Get Started" or "Next" button visible

### 1.2 Slide Navigation
- [ ] Click Next → moves to slide 2
- [ ] Click Next → moves to slide 3
- [ ] Click Next → moves to slide 4
- [ ] Click Back → returns to previous slide
- [ ] Progress indicator shows current slide

### 1.3 Signup Form (Final Slide)
- [ ] Form displays with all fields:
  - [ ] Name (required)
  - [ ] Email (required)
  - [ ] Phone (required)
  - [ ] Property count dropdown
- [ ] Submit with empty fields shows validation errors
- [ ] Submit with valid data shows loading state
- [ ] Successful signup redirects to portal

---

## 2. Landlord Portal Dashboard (`/landlord/:token`)

### 2.1 Page Load
- [ ] Dashboard loads with landlord name
- [ ] Stats cards display (Properties, Tenants, Open Issues)
- [ ] Navigation sidebar/menu visible

### 2.2 Navigation
- [ ] Click "Properties" → goes to properties page
- [ ] Click "Issues" → goes to issues page
- [ ] Click "Settings" → goes to settings page
- [ ] Back to dashboard link works

---

## 3. Properties Page (`/landlord/:token/properties`)

### 3.1 Empty State
- [ ] Shows "No properties yet" if empty
- [ ] "Add Property" button visible

### 3.2 Add Property Modal
- [ ] Click "Add Property" opens modal/form
- [ ] Fields display: Address, Postcode, Nickname, Type
- [ ] Cancel closes modal
- [ ] Submit with valid data creates property
- [ ] New property appears in list

### 3.3 Property List
- [ ] Properties display as cards/rows
- [ ] Shows address, postcode, tenant count
- [ ] Click property → opens detail view

### 3.4 Property Detail
- [ ] Shows full address
- [ ] Shows property type
- [ ] Shows tenant list
- [ ] "Add Tenant" button visible

---

## 4. Tenant Management

### 4.1 Add Tenant
- [ ] Click "Add Tenant" on property detail
- [ ] Form shows: Name, Phone, Email (optional)
- [ ] Submit creates tenant
- [ ] Tenant appears in property's tenant list

### 4.2 Tenant List
- [ ] Shows tenant name and phone
- [ ] Shows email if provided
- [ ] WhatsApp link works (opens wa.me)

### 4.3 Remove Tenant
- [ ] Remove/delete button visible
- [ ] Confirmation dialog appears
- [ ] Tenant removed from list after confirm

---

## 5. Issues Page (`/landlord/:token/issues`)

### 5.1 Page Load
- [ ] Stats cards show: Total, Open, Resolved, DIY Fixed
- [ ] Filter buttons display (All, Open, Quoted, etc.)
- [ ] Issues list loads

### 5.2 Empty State
- [ ] Shows appropriate message if no issues

### 5.3 Issue List
- [ ] Issue cards show:
  - [ ] Property name/address
  - [ ] Issue description (truncated)
  - [ ] Status badge (color coded)
  - [ ] Urgency badge (if set)
  - [ ] Time ago
- [ ] Click issue → opens detail modal

### 5.4 Filter Functionality
- [ ] Click "Open" → shows only open issues
- [ ] Click "Quoted" → shows only quoted
- [ ] Click "All" → shows all issues
- [ ] Counts update based on filter

---

## 6. Issue Detail Modal (Landlord)

### 6.1 Basic Info
- [ ] Property name and address display
- [ ] Tenant name and phone display
- [ ] Issue description displays
- [ ] Status badge shows correctly
- [ ] Urgency badge shows (if set)
- [ ] Category shows (if set)

### 6.2 Media Display
- [ ] **Photos display as thumbnails**
- [ ] **Videos show with play icon (not as images)**
- [ ] Click photo → opens full size
- [ ] Click video → opens/plays video
- [ ] Media count shows correctly

### 6.3 Chat History
- [ ] **Chat log section visible**
- [ ] Messages show with correct direction (left/right)
- [ ] Tenant messages on left (gray)
- [ ] AI messages on right (yellow/gold)
- [ ] Timestamps show on messages
- [ ] Images in chat clickable
- [ ] Videos in chat show link/icon
- [ ] Scrollable if many messages

### 6.4 Actions
- [ ] "Approve" button visible (for quoted/reported)
- [ ] "Reject" button visible
- [ ] Approve click → updates status → modal closes
- [ ] Reject click → prompts for reason → updates status

### 6.5 Timestamps
- [ ] "Reported" date shows
- [ ] "Notified you" date shows (if applicable)
- [ ] "Resolved" date shows (if applicable)

---

## 7. Admin Issues Page (`/admin/tenant-issues`)

### 7.1 Page Load
- [ ] Header shows "Maintenance Hub"
- [ ] Stats cards: Total, Auto-Dispatched, Awaiting Approval, DIY Resolved, Emergencies
- [ ] Emergency alert section (if emergencies exist)
- [ ] Filter bar with search

### 7.2 Filters
- [ ] Search box filters by description/address/name
- [ ] Status dropdown filters correctly
- [ ] Landlord dropdown filters by landlord
- [ ] Urgency dropdown filters by urgency

### 7.3 Issues Table
- [ ] Columns: Property, Issue, Tenant, Landlord, Status, Created, Actions
- [ ] Rows show correct data
- [ ] Status badges colored correctly
- [ ] Urgency badges show
- [ ] Click row → opens detail modal

### 7.4 Quick Actions (in table)
- [ ] Chase icon (for reported/quoted)
- [ ] Convert to Quote icon
- [ ] View Quote link (if quote exists)

---

## 8. Admin Issue Detail Modal

### 8.1 Basic Info
- [ ] Property card with full details
- [ ] Landlord card with phone/email
- [ ] Tenant card with WhatsApp link
- [ ] Issue description
- [ ] Status, urgency, category badges

### 8.2 Media Display
- [ ] **Photos display as thumbnails (clickable)**
- [ ] **Videos display with play icon**
- [ ] **Video badge shows "Video" label**
- [ ] Media count header correct

### 8.3 Chat History
- [ ] **"Chat History (X messages)" header**
- [ ] **Scrollable chat container**
- [ ] Inbound messages (tenant) on left
- [ ] Outbound messages (AI) on right
- [ ] Media in messages displays correctly
- [ ] Timestamps on each message
- [ ] "AI" label on outbound messages

### 8.4 AI Resolution Section
- [ ] Shows if AI attempted resolution
- [ ] Shows suggestions given
- [ ] Shows if tenant accepted/declined

### 8.5 Quote Section
- [ ] Shows if quote generated
- [ ] Displays quote amount
- [ ] Link to view/edit quote

### 8.6 Actions
- [ ] "Convert to Quote" button (if no quote)
- [ ] "Chase Landlord" button
- [ ] "Message Tenant" WhatsApp link
- [ ] "Mark Resolved" button

---

## 9. Landlord Settings (`/landlord/:token/settings`)

### 9.1 Auto-Approval Settings
- [ ] Toggle for enable/disable
- [ ] Threshold input (£)
- [ ] Save button works
- [ ] Success message shows

### 9.2 Notification Settings
- [ ] WhatsApp notifications toggle
- [ ] Email notifications toggle
- [ ] Save persists settings

### 9.3 Budget Settings
- [ ] Monthly budget input
- [ ] Current spend displays
- [ ] Save works

---

## 10. WhatsApp Integration (End-to-End)

### 10.1 Send Test Message
- [ ] Open WhatsApp
- [ ] Send message to sandbox number: `+14155238886`
- [ ] Join code: `join <sandbox-code>`
- [ ] Send: "My tap is dripping"

### 10.2 AI Response
- [ ] AI responds within 30 seconds
- [ ] **AI asks for video**
- [ ] Response is friendly and helpful

### 10.3 Send Media
- [ ] Send a photo of issue
- [ ] AI acknowledges photo
- [ ] **AI asks for video if only photo sent**
- [ ] Send a video
- [ ] AI acknowledges video

### 10.4 Verify in Dashboard
- [ ] Refresh admin issues page
- [ ] New issue appears
- [ ] Click issue → see chat history
- [ ] **Photo/video visible in media section**
- [ ] **Chat log shows full conversation**

---

## 11. Mobile Responsiveness

### 11.1 Landlord Portal (Mobile)
- [ ] Dashboard fits on mobile screen
- [ ] Navigation accessible (hamburger menu?)
- [ ] Properties page scrollable
- [ ] Issue modal scrollable and readable

### 11.2 Admin Issues (Mobile)
- [ ] Table scrolls horizontally or collapses
- [ ] Modal fits screen
- [ ] Chat history readable
- [ ] Media thumbnails appropriate size

---

## Test Results Log

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1.1 Onboarding Load | | | |
| 1.3 Signup Form | | | |
| 2.1 Dashboard Load | | | |
| 5.3 Issue List | | | |
| 6.2 Media Display | | | |
| 6.3 Chat History | | | |
| 7.1 Admin Page Load | | | |
| 8.2 Admin Media | | | |
| 8.3 Admin Chat | | | |
| 10.1 WhatsApp Test | | | |
| 10.4 Verify Dashboard | | | |

---

## Screenshots to Capture

1. [ ] Landlord onboarding slide
2. [ ] Landlord dashboard
3. [ ] Issue detail with chat history
4. [ ] Issue detail with video thumbnail
5. [ ] Admin issues table
6. [ ] Admin issue modal with chat
7. [ ] WhatsApp conversation with AI

---

*Last updated: Feb 2025*
