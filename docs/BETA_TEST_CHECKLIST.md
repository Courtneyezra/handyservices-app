# Beta Test Checklist - Landlord Property Maintenance Platform

## Overview
This checklist covers all features for beta testing with select landlords.

---

## 1. Landlord Onboarding

### 1.1 Signup Flow
- [ ] Navigate to `/landlord` onboarding page
- [ ] Slides display correctly with icons and messaging
- [ ] Can navigate between slides (Next/Back)
- [ ] Signup form validates required fields (name, email, phone)
- [ ] Phone number normalizes correctly (07xxx → +447xxx)
- [ ] Successful signup creates landlord record
- [ ] Redirects to landlord portal after signup

### 1.2 Portal Access
- [ ] Landlord can access portal via token URL `/landlord/:token`
- [ ] Dashboard loads with correct landlord name
- [ ] Navigation works (Properties, Issues, Settings)

---

## 2. Property Management

### 2.1 Add Property
- [ ] Can add new property from portal
- [ ] Address and postcode fields work
- [ ] Property nickname is optional
- [ ] Property type selection works
- [ ] Property appears in list after creation

### 2.2 View Properties
- [ ] Properties list displays all landlord's properties
- [ ] Property cards show address, postcode, tenant count
- [ ] Can click into property detail view

### 2.3 Edit/Delete Property
- [ ] Can edit property details
- [ ] Can delete property (with confirmation)

---

## 3. Tenant Management

### 3.1 Add Tenant
- [ ] Can add tenant to a property
- [ ] Name and phone required
- [ ] Email optional
- [ ] Phone normalizes correctly
- [ ] Tenant appears linked to property

### 3.2 View Tenants
- [ ] Tenant list shows on property detail
- [ ] Tenant cards show name, phone, email

### 3.3 Remove Tenant
- [ ] Can remove tenant from property
- [ ] Confirmation required

---

## 4. Tenant WhatsApp Chat (AI)

### 4.1 Initial Contact
- [ ] Tenant sends first message via WhatsApp
- [ ] AI responds with greeting and asks about issue
- [ ] **AI asks for video early in conversation**
- [ ] Conversation is logged in database

### 4.2 Video/Photo Handling
- [ ] Tenant can send photo - AI acknowledges
- [ ] Tenant can send video - AI acknowledges
- [ ] AI asks for video if only photo sent
- [ ] AI asks for video if only text sent
- [ ] Media is stored and accessible

### 4.3 Issue Assessment
- [ ] AI categorizes issue type (plumbing, electrical, etc.)
- [ ] AI assesses urgency level
- [ ] Safety warnings given for dangerous issues (gas, electrical)

### 4.4 DIY Suggestions
- [ ] AI suggests DIY fix for simple, safe issues
- [ ] AI does NOT suggest DIY for unsafe issues
- [ ] Tenant can accept or decline DIY suggestion

### 4.5 Issue Creation
- [ ] Issue is created in database with correct details
- [ ] Issue linked to correct tenant, property, landlord
- [ ] Photos/videos attached to issue
- [ ] Chat history saved to conversation

---

## 5. Landlord Issue Management

### 5.1 View Issues
- [ ] Issues page shows all landlord's issues
- [ ] Filter by status works (All, Open, Quoted, etc.)
- [ ] Issue cards show property, description, status, urgency
- [ ] Stats cards show correct counts

### 5.2 Issue Detail Modal
- [ ] Click issue opens detail modal
- [ ] Shows property info correctly
- [ ] Shows tenant info correctly
- [ ] Shows issue description
- [ ] Shows status and urgency badges
- [ ] **Shows media (photos/videos)**
- [ ] **Shows chat history with AI**
- [ ] Videos display with play icon (distinguishable from photos)
- [ ] Can click media to view full size

### 5.3 Issue Actions
- [ ] Can approve issue (changes status)
- [ ] Can reject issue with reason
- [ ] WhatsApp link to tenant works

---

## 6. Admin Issue Management

### 6.1 Admin Issues Dashboard
- [ ] Navigate to `/admin/tenant-issues`
- [ ] Shows all issues across all landlords
- [ ] Stats cards show correct counts
- [ ] Emergency issues highlighted
- [ ] Filters work (status, landlord, urgency, search)

### 6.2 Admin Issue Detail
- [ ] Click issue opens detail modal
- [ ] Shows property, tenant, landlord info
- [ ] Shows issue description and category
- [ ] **Shows media (photos/videos)**
- [ ] **Shows full chat history**
- [ ] Shows AI resolution attempts
- [ ] Shows quote info if generated

### 6.3 Admin Actions
- [ ] Convert to Quote button works
- [ ] Chase Landlord button works
- [ ] Mark Resolved button works
- [ ] WhatsApp links work

---

## 7. Landlord Settings

### 7.1 Auto-Approval Rules
- [ ] Can set auto-approval threshold (e.g., £150)
- [ ] Can enable/disable auto-approval
- [ ] Rules apply to new issues correctly

### 7.2 Notification Preferences
- [ ] Can set WhatsApp notification preference
- [ ] Can set email notification preference

### 7.3 Budget Settings
- [ ] Can set monthly budget
- [ ] Budget tracking displays correctly

---

## 8. End-to-End Scenarios

### 8.1 Happy Path - DIY Resolution
1. [ ] Tenant messages about dripping tap
2. [ ] AI asks for video
3. [ ] Tenant sends video
4. [ ] AI suggests DIY fix (tighten washer)
5. [ ] Tenant confirms fixed
6. [ ] Issue marked as DIY resolved
7. [ ] Landlord sees in dashboard as "DIY Fixed"

### 8.2 Happy Path - Professional Required
1. [ ] Tenant messages about boiler not working
2. [ ] AI asks for video
3. [ ] Tenant sends video
4. [ ] AI assesses as needs professional
5. [ ] AI gathers availability
6. [ ] Issue created and reported to landlord
7. [ ] Landlord receives notification
8. [ ] Landlord approves in portal
9. [ ] Quote generated
10. [ ] Job scheduled

### 8.3 Emergency Path
1. [ ] Tenant messages about gas smell
2. [ ] AI gives immediate safety instructions
3. [ ] Issue marked as emergency
4. [ ] Landlord notified urgently
5. [ ] Admin sees in emergency section

### 8.4 Auto-Approval Path
1. [ ] Landlord sets auto-approve under £150
2. [ ] Tenant reports issue
3. [ ] Quote generated at £120
4. [ ] Issue auto-approved without landlord action
5. [ ] Landlord notified of auto-approval

---

## 9. Clear Test Data (Between Tests)

### Clear Conversation History
```bash
# Clear specific tenant conversation for fresh test
npx tsx scripts/clear-tenant-conversation.ts +447508744402
```

### Add Test Tenant
```bash
# Add a new test tenant to a property
npx tsx scripts/add-test-tenant.ts
```

---

## 10. Known Limitations (Beta)

- [ ] WhatsApp sandbox requires 24hr session refresh
- [ ] Video transcoding not implemented (raw upload only)
- [ ] No push notifications yet (WhatsApp only)
- [ ] Payment integration pending
- [ ] Contractor dispatch manual for now

---

## Beta Feedback Questions

After testing, ask landlords:
1. Was the onboarding clear?
2. Did the AI responses feel helpful?
3. Was asking for video annoying or helpful?
4. Could you see enough detail in the issue view?
5. Was the chat history useful?
6. What's missing that you'd need?
7. Would you pay for this service?

---

## Test Accounts

| Role | Phone | Portal URL |
|------|-------|------------|
| Test Landlord | +44... | `/landlord/TOKEN` |
| Test Tenant | +44... | WhatsApp to sandbox |
| Admin | - | `/admin/tenant-issues` |

---

*Last updated: Feb 2025*
