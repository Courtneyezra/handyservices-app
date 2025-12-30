# API Specification

**Version:** 1.0  
**Date:** 2025-12-28  
**Base URL:** `/api`

---

## Table of Contents
1. [Authentication](#1-authentication)
2. [Contractor APIs](#2-contractor-apis)
3. [Quote APIs](#3-quote-apis)
4. [Booking APIs](#4-booking-apis)
5. [Admin APIs](#5-admin-apis)
6. [Webhook Endpoints](#6-webhook-endpoints)

---

## 1. Authentication

All endpoints require authentication except public quote pages.

### Headers
```
Authorization: Bearer <session_token>
Content-Type: application/json
```

### Roles
- `admin` - Full access
- `va` - Virtual assistant (limited admin)
- `contractor` - Contractor portal only
- `estimator` - Estimator queue access

---

## 2. Contractor APIs

### 2.1 Get Available Tasks
```http
GET /api/contractor/tasks
```

**Response:**
```json
{
  "tasks": [
    {
      "id": "task_plumbing_01",
      "name": "Fix leaking taps/faucets",
      "category": "Plumbing",
      "requiresCertification": false
    },
    {
      "id": "task_electrical_01",
      "name": "Replace light fixtures",
      "category": "Electrical",
      "requiresCertification": false
    }
  ],
  "categories": ["Plumbing", "Electrical", "Carpentry", "Decorating", "General", "Garden"]
}
```

---

### 2.2 Get My Skills
```http
GET /api/contractor/my-skills
```

**Response:**
```json
{
  "skills": [
    {
      "taskId": "task_plumbing_01",
      "taskName": "Fix leaking taps/faucets",
      "category": "Plumbing",
      "confidence": "expert",
      "completedCount": 23
    }
  ],
  "totalSelected": 15
}
```

---

### 2.3 Update Skills
```http
PUT /api/contractor/skills
```

**Request:**
```json
{
  "skills": [
    { "taskId": "task_plumbing_01", "confidence": "expert" },
    { "taskId": "task_plumbing_02", "confidence": "capable" },
    { "taskId": "task_carpentry_01", "confidence": "expert" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "totalSkills": 3
}
```

---

### 2.4 Get My Jobs
```http
GET /api/contractor/jobs
```

**Query Params:**
- `status` - Filter by status (optional)
- `from` - Start date (optional)
- `to` - End date (optional)

**Response:**
```json
{
  "jobs": [
    {
      "id": "booking_123",
      "date": "2025-01-15",
      "timeSlot": "am",
      "customerName": "John D.",
      "postcode": "SW1A 2AA",
      "jobDescription": "Fix leaking tap in kitchen",
      "estimatedDuration": 60,
      "payoutPence": 8500,
      "status": "scheduled"
    }
  ]
}
```

---

### 2.5 Update Availability
```http
PUT /api/contractor/availability/dates
```

**Request:**
```json
{
  "dates": [
    {
      "date": "2025-01-15",
      "isAvailable": true,
      "startTime": "09:00",
      "endTime": "17:00"
    },
    {
      "date": "2025-01-16",
      "isAvailable": false,
      "notes": "Holiday"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "datesUpdated": 2
}
```

---

## 3. Quote APIs

### 3.1 Generate Quote (Internal)
```http
POST /api/quotes/generate
```

**Request:**
```json
{
  "leadId": "lead_123",
  "style": "hhh",
  "lineItems": [
    {
      "skuId": "SKU-TAP-REPLACE",
      "description": "Replace kitchen tap",
      "pricePence": 8500,
      "quantity": 1
    }
  ],
  "customerType": "homeowner",
  "notes": "Customer mentioned urgency"
}
```

**Response:**
```json
{
  "quoteId": "quote_abc123",
  "shortSlug": "xK3mP9",
  "quoteUrl": "https://handyservices.app/quote-link/xK3mP9",
  "total": 8500,
  "depositAmount": 1700,
  "expiresAt": "2025-12-31T15:00:00Z"
}
```

---

### 3.2 Get Quote (Public)
```http
GET /api/quotes/:slug
```

**No auth required** - Public customer-facing endpoint

**Response:**
```json
{
  "quote": {
    "id": "quote_abc123",
    "customerName": "John",
    "jobDescription": "Fix leaking tap",
    "style": "hhh",
    "essentialPrice": 8500,
    "enhancedPrice": 12000,
    "elitePrice": 15000,
    "depositPercent": 20,
    "expiresAt": "2025-12-31T15:00:00Z"
  },
  "availableSlots": [
    { "date": "2025-01-15", "slots": ["am", "pm"] },
    { "date": "2025-01-16", "slots": ["am"] },
    { "date": "2025-01-17", "slots": ["am", "pm"] }
  ]
}
```

---

### 3.3 Get Available Slots
```http
GET /api/quotes/:slug/availability
```

**Query Params:**
- `taskIds` - Comma-separated task IDs (required)
- `postcode` - Customer postcode (required)
- `from` - Start date (default: today)
- `to` - End date (default: +30 days)

**Response:**
```json
{
  "availableSlots": [
    {
      "date": "2025-01-15",
      "slots": [
        { "time": "am", "contractorCount": 3 },
        { "time": "pm", "contractorCount": 2 }
      ]
    },
    {
      "date": "2025-01-16",
      "slots": [
        { "time": "am", "contractorCount": 1 }
      ]
    }
  ]
}
```

---

## 4. Booking APIs

### 4.1 Hold Slot
```http
POST /api/bookings/hold
```

**Request:**
```json
{
  "quoteId": "quote_abc123",
  "date": "2025-01-15",
  "timeSlot": "am",
  "sessionId": "sess_xyz789"
}
```

**Response:**
```json
{
  "holdId": "hold_123",
  "expiresAt": "2025-12-28T16:05:00Z",
  "ttlSeconds": 300
}
```

**Error (slot taken):**
```json
{
  "error": "SLOT_UNAVAILABLE",
  "message": "This slot is no longer available. Please select another."
}
```

---

### 4.2 Create Payment Intent
```http
POST /api/bookings/payment-intent
```

**Request:**
```json
{
  "quoteId": "quote_abc123",
  "holdId": "hold_123",
  "selectedPackage": "enhanced",
  "selectedExtras": []
}
```

**Response:**
```json
{
  "clientSecret": "pi_xxx_secret_yyy",
  "amount": 2400,
  "currency": "gbp"
}
```

---

### 4.3 Confirm Booking
```http
POST /api/bookings/confirm
```

**Request:**
```json
{
  "quoteId": "quote_abc123",
  "holdId": "hold_123",
  "paymentIntentId": "pi_xxx",
  "selectedPackage": "enhanced"
}
```

**Response:**
```json
{
  "bookingId": "booking_456",
  "contractorId": "contractor_789",
  "contractorName": "Mike T.",
  "date": "2025-01-15",
  "timeSlot": "am",
  "confirmationNumber": "HS-2025-0456"
}
```

---

### 4.4 Cancel Booking
```http
POST /api/bookings/:id/cancel
```

**Request:**
```json
{
  "reason": "Customer changed mind"
}
```

**Response:**
```json
{
  "success": true,
  "refundAmount": 1500,
  "retainedAmount": 500,
  "message": "Booking cancelled. Partial refund of £15.00 issued."
}
```

---

## 5. Admin APIs

### 5.1 Get Lead Pipeline
```http
GET /api/admin/leads
```

**Query Params:**
- `state` - Filter by state (optional)
- `from` - Start date (optional)
- `to` - End date (optional)

**Response:**
```json
{
  "leads": [
    {
      "id": "lead_123",
      "customerName": "John Doe",
      "phone": "+447123456789",
      "state": "quote_sent",
      "stateChangedAt": "2025-12-28T10:00:00Z",
      "source": "call",
      "customerType": "homeowner"
    }
  ],
  "counts": {
    "created": 5,
    "quote_sent": 12,
    "quote_viewed": 8,
    "booking_confirmed": 3
  }
}
```

---

### 5.2 Transition Lead State
```http
POST /api/admin/leads/:id/transition
```

**Request:**
```json
{
  "newState": "quote_sent",
  "notes": "Sent via WhatsApp"
}
```

**Response:**
```json
{
  "success": true,
  "previousState": "quote_generated",
  "newState": "quote_sent"
}
```

---

### 5.3 Get Estimator Queue
```http
GET /api/admin/estimator-queue
```

**Response:**
```json
{
  "queue": [
    {
      "id": "eq_123",
      "leadId": "lead_456",
      "customerName": "Sarah J.",
      "videoUrl": "https://...",
      "priority": 2,
      "status": "queued",
      "createdAt": "2025-12-28T09:00:00Z",
      "waitingTime": "2h 30m"
    }
  ],
  "stats": {
    "queued": 5,
    "inProgress": 2,
    "avgWaitTime": "1h 45m"
  }
}
```

---

### 5.4 Claim Estimator Item
```http
POST /api/admin/estimator-queue/:id/claim
```

**Response:**
```json
{
  "success": true,
  "lead": {
    "id": "lead_456",
    "videoUrl": "https://...",
    "transcript": "Customer said: I have a...",
    "conversationId": "conv_789"
  }
}
```

---

### 5.5 Run Contractor Matching
```http
POST /api/admin/bookings/:id/match
```

**Response:**
```json
{
  "matches": [
    {
      "contractorId": "contractor_1",
      "name": "Mike T.",
      "score": 87,
      "distance": 2.3,
      "confidence": "expert",
      "availableSlots": ["am", "pm"]
    },
    {
      "contractorId": "contractor_2",
      "name": "John S.",
      "score": 72,
      "distance": 4.1,
      "confidence": "expert",
      "availableSlots": ["am"]
    }
  ],
  "autoAssigned": {
    "contractorId": "contractor_1",
    "name": "Mike T.",
    "score": 87
  }
}
```

---

### 5.6 Override Contractor Assignment
```http
POST /api/admin/bookings/:id/assign
```

**Request:**
```json
{
  "contractorId": "contractor_2",
  "reason": "Customer preference"
}
```

**Response:**
```json
{
  "success": true,
  "previousContractor": "contractor_1",
  "newContractor": "contractor_2"
}
```

---

## 6. Webhook Endpoints

### 6.1 Stripe Webhook
```http
POST /api/webhooks/stripe
```

**Events handled:**
- `payment_intent.succeeded` → Confirm booking
- `payment_intent.payment_failed` → Update lead state
- `charge.refunded` → Log refund

---

### 6.2 Twilio WhatsApp Webhook
```http
POST /api/webhooks/whatsapp
```

**Events handled:**
- Incoming message → Route to conversation
- Media received → Store video/image
- Status update → Track delivery

---

## Error Responses

All errors follow this format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message",
  "details": {} // Optional additional info
}
```

**Common error codes:**
- `UNAUTHORIZED` - Not authenticated
- `FORBIDDEN` - Not authorized for this action
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid input
- `SLOT_UNAVAILABLE` - Booking slot taken
- `INVALID_TRANSITION` - State machine violation
- `PAYMENT_FAILED` - Stripe payment failed
