# Transcription Speed Configuration Guide

## Overview

You can now adjust the real-time transcription speed by setting the `DEEPGRAM_UTTERANCE_MS` environment variable.

## How It Works

**Setting:** Controls how long Deepgram waits after detecting silence before finalizing a transcript segment.

**Default:** 1000ms (1 second)

## Speed vs Accuracy Trade-offs

### Fast (500ms)
- ✅ Nearly instant transcript updates
- ✅ Feels very responsive
- ❌ May cut off mid-sentence
- ❌ More fragmented segments

### Balanced (1000ms) - **RECOMMENDED**
- ✅ Good responsiveness
- ✅ Complete sentences
- ✅ Industry standard
- ✓ Best overall experience

### Smooth (1500ms)
- ✅ Very smooth, complete thoughts
- ✅ Fewer segment breaks
- ❌ Noticeable delay
- ❌ Feels less "live"

## Configuration

### Option 1: Environment Variable

Add to your `.env` file:
```bash
# For faster transcription (more reactive)
DEEPGRAM_UTTERANCE_MS=500

# For balanced (recommended)
DEEPGRAM_UTTERANCE_MS=1000

# For smoother (less choppy)
DEEPGRAM_UTTERANCE_MS=1500
```

### Option 2: No Configuration

If not set, defaults to 1000ms (balanced).

## Testing Different Speeds

1. **Edit `.env` file:**
   ```bash
   DEEPGRAM_UTTERANCE_MS=500
   ```

2. **Restart server:**
   ```bash
   # Server will auto-reload with new setting
   ```

3. **Make a test call** and observe:
   - How quickly transcripts appear
   - Whether sentences are complete
   - If it feels too fast/slow

4. **Adjust as needed** and restart

## Recommended Settings by Use Case

**For customer support (need speed):**
```bash
DEEPGRAM_UTTERANCE_MS=500
```

**For quality transcription (need accuracy):**
```bash
DEEPGRAM_UTTERANCE_MS=1000
```

**For presentations/demos (need polish):**
```bash
DEEPGRAM_UTTERANCE_MS=1500
```

## Troubleshooting

**Issue:** Transcripts cutting off mid-word

**Solution:** Increase the value (e.g., 1000 → 1500)

---

**Issue:** Transcripts feel delayed/sluggish

**Solution:** Decrease the value (e.g., 1000 → 500)

---

**Issue:** Too many short fragments

**Solution:** Increase the value to allow longer pauses
