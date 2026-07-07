# Recent Callers Selector for Quote Generator

## Context
Ben (VA in Da Nang) captures customer name, phone, and address during live calls. When he navigates to the Quote Generator tab to send a quote, he has to re-type all this info. We need a "recent callers" picker at the top of the form that pre-fills fields from recent calls — while still allowing manual edits.

---

## Approach

### 1. New API Endpoint: `GET /api/calls/recent-callers`
**File:** `server/calls.ts`

- Returns last 10 calls with customer data, ordered by `startTime DESC`
- Lightweight — only select needed fields: `id`, `customerName`, `phoneNumber`, `address`, `postcode`, `jobSummary`, `startTime`, `metadataJson`
- Protected by existing `requireAdmin` middleware
- Falls back to `metadataJson` fields if top-level fields are null (metadata often has richer data from voice extraction)

**Response shape:**
```json
[{
  "id": "call-123",
  "customerName": "James Sterling",
  "phone": "+447700900123",
  "address": "12 Elm St, Nottingham",
  "postcode": "NG1 2AB",
  "jobSummary": "Leaking kitchen tap",
  "calledAt": "2026-03-08T14:30:00Z"
}]
```

### 2. Recent Callers UI Component
**File:** `client/src/components/quote/RecentCallers.tsx` (new)

- Horizontal scrolling row of caller "chips" at the top of the quote form
- Each chip shows: **Name** + relative time ("2m ago")
- Tap a chip → fires `onSelect(caller)` callback to pre-fill form fields
- Selected chip gets a highlight ring
- Fetched via `useQuery` with the `adminToken` header
- Compact — single row, doesn't push form content down much

### 3. Wire into GenerateQuoteLinkSimple
**File:** `client/src/pages/GenerateQuoteLinkSimple.tsx`

- Add `RecentCallers` above the `QuoteBuilder` component
- On select: navigate to same page with URL params pre-filled (reuses existing `initialData` parsing from URL params)
- OR: pass `initialData` prop directly by resetting component with new key

**Simpler approach:** Use `window.location.search` to navigate with params (reuses existing URL param pre-fill logic, zero changes to QuoteBuilder):
```
/admin/generate-quote?name=James+Sterling&phone=+447700900123&address=12+Elm+St&postcode=NG1+2AB&jobDescription=Leaking+kitchen+tap
```

---

## Files Changed

| File | Change |
|------|--------|
| `server/calls.ts` | Add `GET /recent-callers` endpoint (~25 lines) |
| `client/src/components/quote/RecentCallers.tsx` | New component — caller chips with fetch (~80 lines) |
| `client/src/pages/GenerateQuoteLinkSimple.tsx` | Add `RecentCallers` above `QuoteBuilder`, handle selection via URL params |

## Build Order
1. Server endpoint (`calls.ts`)
2. Client component (`RecentCallers.tsx`)
3. Wire into quote page (`GenerateQuoteLinkSimple.tsx`)

## Verification
1. Login as Ben → navigate to Quote tab
2. Recent callers row appears at top (may be empty if no calls yet)
3. Tap a caller chip → form pre-fills with their name, phone, address, postcode, job description
4. Fields remain editable after pre-fill
5. Can still use form without selecting a recent caller
