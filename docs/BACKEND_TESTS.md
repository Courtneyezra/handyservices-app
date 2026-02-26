# Backend Manual Tests

Run these tests via terminal/API calls to verify backend functionality.

---

## Prerequisites

```bash
# Ensure dev server running
npm run dev

# Set your test phone (replace with real number)
export TEST_PHONE="+447508744402"
export TEST_LANDLORD_TOKEN="your-landlord-id"
```

---

## 1. Landlord Signup API

### 1.1 Create Landlord Account
```bash
curl -X POST http://localhost:5000/api/landlord/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Landlord",
    "email": "test@example.com",
    "phone": "07508744402",
    "propertyCount": "1-3"
  }'
```
**Expected:** `{ "token": "uuid-here", "message": "Account created successfully!" }`

### 1.2 Duplicate Phone Rejection
```bash
# Run same request again
curl -X POST http://localhost:5000/api/landlord/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Landlord 2",
    "email": "test2@example.com",
    "phone": "07508744402"
  }'
```
**Expected:** Error about existing account

### 1.3 Missing Fields Validation
```bash
curl -X POST http://localhost:5000/api/landlord/signup \
  -H "Content-Type: application/json" \
  -d '{ "name": "Test" }'
```
**Expected:** `400` error with validation message

---

## 2. Landlord Portal API

### 2.1 Get Landlord Dashboard
```bash
curl http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN
```
**Expected:** Landlord details with properties count

### 2.2 Invalid Token
```bash
curl http://localhost:5000/api/landlord/invalid-token-123
```
**Expected:** `404` error

---

## 3. Property Management API

### 3.1 Create Property
```bash
curl -X POST http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/properties \
  -H "Content-Type: application/json" \
  -d '{
    "address": "123 Test Street, London",
    "postcode": "SW1A 1AA",
    "nickname": "Test Flat",
    "propertyType": "flat"
  }'
```
**Expected:** Property created with ID

### 3.2 List Properties
```bash
curl http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/properties
```
**Expected:** Array of properties

### 3.3 Get Single Property
```bash
curl http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/properties/PROPERTY_ID
```
**Expected:** Property details with tenants

---

## 4. Tenant Management API

### 4.1 Add Tenant to Property
```bash
curl -X POST http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/properties/PROPERTY_ID/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Tenant",
    "phone": "07123456789",
    "email": "tenant@example.com"
  }'
```
**Expected:** Tenant created with ID

### 4.2 List Tenants
```bash
curl http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/properties/PROPERTY_ID/tenants
```
**Expected:** Array of tenants

### 4.3 Phone Normalization
```bash
# Test with 07 format
curl -X POST http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/properties/PROPERTY_ID/tenants \
  -H "Content-Type: application/json" \
  -d '{ "name": "Test", "phone": "07999888777" }'
```
**Expected:** Phone stored as `+447999888777`

---

## 5. Tenant Issues API

### 5.1 List Landlord Issues
```bash
curl http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/issues
```
**Expected:** `{ issues: [], stats: { total, open, resolved, diyResolved } }`

### 5.2 Get Issue Messages (Chat Log)
```bash
curl http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/issues/ISSUE_ID/messages
```
**Expected:** `{ messages: [...], conversationId: "..." }`

### 5.3 Approve Issue
```bash
curl -X POST http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/issues/ISSUE_ID/approve
```
**Expected:** `{ success: true }`

### 5.4 Reject Issue
```bash
curl -X POST http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/issues/ISSUE_ID/reject \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Not urgent, can wait" }'
```
**Expected:** `{ success: true }`

---

## 6. Admin Issues API

### 6.1 List All Issues
```bash
curl http://localhost:5000/api/admin/tenant-issues
```
**Expected:** All issues with stats and landlords list

### 6.2 Get Issue Detail
```bash
curl http://localhost:5000/api/admin/tenant-issues/ISSUE_ID
```
**Expected:** Full issue with tenant, property, landlord

### 6.3 Get Issue Messages
```bash
curl http://localhost:5000/api/admin/tenant-issues/ISSUE_ID/messages
```
**Expected:** `{ messages: [...] }`

### 6.4 Update Issue Status
```bash
curl -X PATCH http://localhost:5000/api/admin/tenant-issues/ISSUE_ID/status \
  -H "Content-Type: application/json" \
  -d '{ "status": "completed" }'
```
**Expected:** `{ success: true }`

### 6.5 Convert Issue to Quote
```bash
curl -X POST http://localhost:5000/api/admin/tenant-issues/ISSUE_ID/convert
```
**Expected:** `{ success: true, quoteId: "...", quoteSlug: "..." }`

---

## 7. WhatsApp Webhook (Simulated)

### 7.1 Simulate Incoming Text Message
```bash
curl -X POST http://localhost:5000/api/whatsapp/incoming \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:$TEST_PHONE&Body=My tap is dripping&MessageSid=SM123&ProfileName=Test Tenant"
```
**Expected:** Empty TwiML response, AI processes message

### 7.2 Check Conversation Created
```bash
# Query database directly or check logs
npx tsx -e "
import { db } from './server/db';
import { conversations } from './shared/schema';
import { like } from 'drizzle-orm';
const convs = await db.query.conversations.findMany({
  where: like(conversations.phoneNumber, '%7508744402%')
});
console.log(convs);
"
```

---

## 8. AI Orchestrator Tests

### 8.1 Clear Conversation for Fresh Test
```bash
npx tsx scripts/clear-tenant-conversation.ts $TEST_PHONE
```
**Expected:** Conversation cleared

### 8.2 Verify Tenant Lookup
```bash
npx tsx -e "
import { db } from './server/db';
import { tenants } from './shared/schema';
import { eq } from 'drizzle-orm';
const t = await db.query.tenants.findFirst({
  where: eq(tenants.phone, '+447508744402'),
  with: { property: { with: { landlord: true } } }
});
console.log('Tenant:', t?.name);
console.log('Property:', t?.property?.address);
console.log('Landlord:', t?.property?.landlord?.customerName);
"
```

---

## 9. Database Integrity Tests

### 9.1 Check Foreign Keys
```bash
npx tsx -e "
import { db } from './server/db';
import { tenantIssues } from './shared/schema';
const issues = await db.query.tenantIssues.findMany({
  with: { tenant: true, property: true, landlord: true, conversation: true }
});
issues.forEach(i => {
  console.log('Issue:', i.id);
  console.log('  Tenant:', i.tenant?.name || 'MISSING');
  console.log('  Property:', i.property?.address || 'MISSING');
  console.log('  Landlord:', i.landlord?.customerName || 'MISSING');
  console.log('  Conversation:', i.conversationId || 'NONE');
});
"
```

### 9.2 Check Messages Have Conversations
```bash
npx tsx -e "
import { db } from './server/db';
import { messages } from './shared/schema';
const msgs = await db.query.messages.findMany({ limit: 10 });
msgs.forEach(m => {
  console.log(m.direction, m.type, m.content?.substring(0, 50));
});
"
```

---

## 10. Landlord Settings API

### 10.1 Get Settings
```bash
curl http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/settings
```

### 10.2 Update Auto-Approval
```bash
curl -X PUT http://localhost:5000/api/landlord/$TEST_LANDLORD_TOKEN/settings \
  -H "Content-Type: application/json" \
  -d '{
    "autoApproveEnabled": true,
    "autoApproveThresholdPence": 15000
  }'
```

---

## Test Results Log

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| 1.1 Create Landlord | | |
| 1.2 Duplicate Rejection | | |
| 1.3 Validation | | |
| 2.1 Get Dashboard | | |
| 3.1 Create Property | | |
| 4.1 Add Tenant | | |
| 5.1 List Issues | | |
| 5.2 Get Messages | | |
| 6.1 Admin List | | |
| 6.3 Admin Messages | | |
| 7.1 WhatsApp Webhook | | |
| 8.1 Clear Conversation | | |

---

*Last updated: Feb 2025*
