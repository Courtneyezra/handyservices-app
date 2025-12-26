# Multiple SKU Stack Display - Implementation Plan

## Objective
Enable live call UI to detect and display multiple SKUs mentioned in a conversation as a vertical stacked list, with each SKU showing its confidence percentage.

---

## Backend Changes

### B1: Update Live Call SKU Detection Method
**File:** `server/twilio-realtime.ts`  
**Line:** 150

**Change:**
```typescript
// FROM:
const routing = await detectSku(finalText);

// TO:
const multiTaskResult = await detectMultipleTasks(finalText);
```

**Impact:** Changes from single SKU detection to multi-SKU detection

---

### B2: Add Import for detectMultipleTasks
**File:** `server/twilio-realtime.ts`  
**Line:** ~1-10 (imports section)

**Change:**
```typescript
// Add to existing imports:
import { detectSku, detectMultipleTasks } from './skuDetector';
```

**Impact:** Makes `detectMultipleTasks` available in the file

---

### B3: Update Broadcast Data Structure
**File:** `server/twilio-realtime.ts`  
**Line:** ~140-175 (in `close()` method)

**Current structure:**
```typescript
detection: {
    matched: boolean,
    sku: ProductizedService | null,
    confidence: number,
    nextRoute: string
}
```

**New structure:**
```typescript
detection: {
    // Keep original for backward compatibility
    matched: boolean,
    sku: ProductizedService | null,  // Best match (first in array)
    confidence: number,
    nextRoute: string,
    
    // NEW: Multi-SKU data
    matchedServices: [
        { sku: ProductizedService, confidence: number, task: TaskItem },
        { sku: ProductizedService, confidence: number, task: TaskItem }
    ],
    unmatchedTasks: TaskItem[],
    totalMatchedPrice: number
}
```

**Impact:** Provides full multi-SKU data to frontend while maintaining backward compatibility

---

### B4: Map Multi-Task Result to Broadcast Format
**File:** `server/twilio-realtime.ts`  
**Line:** ~150-170

**Logic to add:**
```typescript
const multiTaskResult = await detectMultipleTasks(finalText);

// Create backward-compatible detection object
const routing = {
    matched: multiTaskResult.hasMatches,
    sku: multiTaskResult.matchedServices[0]?.sku || null,
    confidence: multiTaskResult.matchedServices[0]?.confidence || 0,
    nextRoute: multiTaskResult.nextRoute,
    rationale: `Detected ${multiTaskResult.matchedServices.length} service(s)`,
    
    // Multi-SKU data
    matchedServices: multiTaskResult.matchedServices,
    unmatchedTasks: multiTaskResult.unmatchedTasks,
    totalMatchedPrice: multiTaskResult.totalMatchedPrice
};
```

**Impact:** Transforms multi-task result into format compatible with broadcasts

---

### B5: Update Database Schema (Optional)
**File:** `shared/schema.ts`  
**Line:** ~calls table definition

**Current:** `transcriptJson` stores single SKU detection  
**Consider:** Whether to store full multi-task result

**Decision needed:** Do we want historical multi-SKU data in database?

**Impact:** Would allow querying past multi-SKU detections

---

## Frontend Changes

### F1: Update State Interface
**File:** `client/src/pages/AudioUploadPage.tsx`  
**Line:** ~30-60 (interface definitions)

**Add to SkuDetectionResult interface:**
```typescript
interface SkuDetectionResult {
    matched: boolean;
    sku: ProductizedService | null;
    confidence: number;
    nextRoute: string;
    rationale: string;
    
    // NEW: Multi-SKU fields
    matchedServices?: Array<{
        sku: ProductizedService;
        confidence: number;
        task: { description: string; quantity: number };
    }>;
    unmatchedTasks?: Array<{ description: string; quantity: number }>;
    totalMatchedPrice?: number;
}
```

**Impact:** TypeScript will recognize new multi-SKU fields

---

### F2: Replace Single SKU Card with Stacked Display
**File:** `client/src/pages/AudioUploadPage.tsx`  
**Line:** 495-515 (current single SKU display)

**Current:**
```tsx
{result.detection.matched && result.detection.sku ? (
    <div>Single SKU card</div>
) : (
    <div>No service detected</div>
)}
```

**Replace with:**
```tsx
{result.detection.matchedServices && result.detection.matchedServices.length > 0 ? (
    <div className="space-y-2">
        {result.detection.matchedServices.map((service, idx) => (
            <div key={idx} className="bg-white border rounded-lg p-4 shadow-sm">
                {/* SKU card content */}
            </div>
        ))}
    </div>
) : (
    <div>No services detected</div>
)}
```

**Impact:** Shows all detected SKUs instead of just one

---

### F3: Design SKU Stack Card Component
**File:** `client/src/pages/AudioUploadPage.tsx`  
**Line:** ~495-515

**Card structure for each SKU:**
```tsx
<div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
    {/* Header: Name + Confidence */}
    <div className="flex justify-between items-start mb-2">
        <div className="font-semibold text-slate-900">{service.sku.name}</div>
        <div className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">
            {service.confidence}% Match
        </div>
    </div>
    
    {/* Description */}
    <p className="text-xs text-slate-500 line-clamp-2">
        {service.sku.description}
    </p>
    
    {/* Task Context (if available) */}
    {service.task && (
        <div className="mt-2 text-xs text-slate-400 italic">
            Task: {service.task.description}
            {service.task.quantity > 1 && ` (×${service.task.quantity})`}
        </div>
    )}
    
    {/* Price */}
    <div className="mt-3 pt-3 border-t border-slate-50 flex items-center justify-between">
        <span className="text-xs text-slate-400">Est. Price</span>
        <span className="text-sm font-bold text-slate-900">
            £{(service.sku.pricePence / 100 * service.task.quantity).toFixed(2)}
        </span>
    </div>
</div>
```

**Impact:** Each SKU gets its own visually distinct card

---

### F4: Add Total Price Summary (If Multiple SKUs)
**File:** `client/src/pages/AudioUploadPage.tsx`  
**Line:** After the stacked SKU cards

**Add below the stack:**
```tsx
{result.detection.matchedServices.length > 1 && (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2">
        <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-slate-700">Total Estimate</span>
            <span className="text-lg font-bold text-slate-900">
                £{(result.detection.totalMatchedPrice / 100).toFixed(2)}
            </span>
        </div>
    </div>
)}
```

**Impact:** Shows combined price when multiple services detected

---

### F5: Handle Unmatched Tasks Display
**File:** `client/src/pages/AudioUploadPage.tsx`  
**Line:** After matched services stack

**Add section for unmatched tasks:**
```tsx
{result.detection.unmatchedTasks && result.detection.unmatchedTasks.length > 0 && (
    <div className="mt-3">
        <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">
            Needs Review
        </h4>
        {result.detection.unmatchedTasks.map((task, idx) => (
            <div key={idx} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <span className="text-amber-800">{task.description}</span>
                </div>
            </div>
        ))}
    </div>
)}
```

**Impact:** Shows tasks that couldn't be matched to SKUs, requiring VA attention

---

### F6: Update Detection Section Header
**File:** `client/src/pages/AudioUploadPage.tsx`  
**Line:** 497

**Current:**
```tsx
<h3>Detected Intent</h3>
```

**Change to:**
```tsx
<h3>Detected Services ({result.detection.matchedServices?.length || 0})</h3>
```

**Impact:** Shows count of detected services in header

---

### F7: Add Visual Stack Indicators
**File:** `client/src/pages/AudioUploadPage.tsx`  
**Line:** In the SKU card mapping

**Enhancement for each card:**
```tsx
<div className={`
    relative 
    ${idx > 0 ? 'mt-2' : ''}  // Spacing between cards
    ${idx === 0 ? 'ring-2 ring-blue-200' : ''}  // Highlight primary match
`}>
    {/* Card content */}
    
    {/* Badge for primary match */}
    {idx === 0 && (
        <div className="absolute top-2 right-2">
            <span className="text-[9px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">
                PRIMARY
            </span>
        </div>
    )}
</div>
```

**Impact:** Visual hierarchy showing which SKU is the top match

---

## Testing Plan

### T1: Backend Testing
1. Make a call saying: "I need TV mounting and fence panel replacement"
2. Check server logs for `detectMultipleTasks` call
3. Verify broadcast contains `matchedServices` array with 2 items
4. Confirm each service has correct confidence score

### T2: Frontend Testing
1. Open `/live-call` page BEFORE calling
2. Make test call with multiple jobs mentioned
3. Verify:
   - Multiple SKU cards appear stacked vertically
   - Each shows correct name, description, price
   - Confidence badges display correctly
   - Total price summary appears (if 2+ SKUs)
   - Primary match is visually highlighted

### T3: Edge Cases
1. **Single SKU:** Should still work (backward compatible)
2. **No matches:** Should show "No services detected"
3. **Mix of matched/unmatched:** Both sections should appear
4. **High quantity:** "2 fence panels" should calculate price correctly

---

## Rollback Plan

If multi-SKU display causes issues:

**Quick rollback:**
1. Revert B1: Change `detectMultipleTasks` back to `detectSku`
2. System returns to single SKU detection
3. Frontend gracefully degrades (uses `detection.sku`)

**No database migration required** since we're maintaining backward compatibility.

---

## Estimated Effort

- **Backend changes:** 30-45 minutes
- **Frontend changes:** 45-60 minutes
- **Testing:** 30 minutes
- **Total:** ~2 hours

---

## Benefits

✅ **VA sees all services** mentioned in conversation  
✅ **Better price accuracy** with total estimate  
✅ **Improved job capture** - no missed services  
✅ **Visual clarity** with stacked cards  
✅ **Maintains single-SKU compatibility**  

---

## Dependencies

- ✅ `detectMultipleTasks()` already implemented  
- ✅ Backend API endpoint exists (`/api/detect-multiple`)  
- ✅ TypeScript interfaces defined  
- ⚠️ Need to verify broadcast can handle larger payloads (shouldn't be an issue with 10mb limit)

---

## Next Steps

1. Review this plan
2. Approve changes
3. Implement B1-B4
4. Test backend with curl/Postman
5. Implement F1-F7
6. Test end-to-end with live call
7. Update documentation
