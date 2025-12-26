# Multi-SKU List View & UI Rethink - Implementation Plan

## Objective
Update the UI to display detected SKUs in a clean, structured List/Table view, and ensure the `LiveCallContext` correctly passes multi-SKU data from the backend.

---

## 1. Update Live Call Context
**File:** `client/src/contexts/LiveCallContext.tsx`

### C1: Update SkuDetectionResult Interface
Add `matchedServices`, `unmatchedTasks`, `totalMatchedPrice`, `hasMultiple` to the interface to match the backend broadcast.

### C2: Update Simulation Data
Modify `startSimulation` to populate `matchedServices` with dummy data (e.g., 2 distinct services) so the list view can be tested without a real call.

---

## 2. UI Redesign: "Services List" Table
**File:** `client/src/pages/AudioUploadPage.tsx`

### F8: Replace Stacked Cards with Table Component
Replace the stacked card div with a clean table structure:

| Service | Confidence | Quantity | Est. Price | Action |
| :--- | :--- | :--- | :--- | :--- |
| **TV Mounting**<br>_Standard 55 inch_ | 🟢 **95%** | 1 | £75.00 | [Confirm] |
| **Fence Repair**<br>_Replace panel_ | 🟡 **82%** | 2 | £120.00 | [Review] |

**Footer:** Total Est. Price: **£195.00**

### F9: Add "Unmatched Tasks" Section
Below the table, show a "Attention Needed" list for unmatched items:
- ⚠️ "Fix the wobbling door handle" (No SKU found)

### F10: Clean Up Layout
- Move "Live Transcript" to the left column (scrollable).
- Move "Detected Services" (Table) to the right column (fixed).
- Ensure "Video Request" / "Instant Price" buttons act on the *Combined* result.

---

## 3. Testing
- Run "Simulate Call" to verify the Table View renders multiple rows.
- Verify "Total Price" calculation.
- Verify "Unmatched" section appears when relevant.
