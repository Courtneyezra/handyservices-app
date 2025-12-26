# Adaptive WhatsApp Message Examples

## How It Works

The system now intelligently adapts WhatsApp messages based on the number and clarity of jobs mentioned in the call.

---

## Scenario 1: Single Clear Job ✅

**Call transcript:**
> "Hi, I need someone to mount my TV on the wall. It's a 55-inch Samsung."

**Generated message (Casual):**
```
Hi John! We just spoke about the TV mounting. Please send us a video so we can take a look and get a price back to you! 📹
```

**Generated message (Professional):**
```
Hi John. We just spoke about the TV mounting. Please send us a video so we can take a look and get a price back to you. 🔧
```

---

## Scenario 2: Two Jobs ✅

**Call transcript:**
> "Hi, my name is Sarah. I need help with mounting a TV and also fixing a fence panel that's broken."

**Generated message:**
```
Hi Sarah! We just spoke about the TV mounting and fence repair. Please send us a video so we can take a look and get a price back to you! 📹
```

---

## Scenario 3: Three Jobs ✅

**Call transcript:**
> "Hello, I'm Mike. I need three things done - a fence panel replacement, shower resealing, and a window that won't close properly."

**Generated message:**
```
Hi Mike! We just spoke about the fence panel, shower resealing, and window repair. Please send us a video so we can take a look and get a price back to you! 📹
```

---

## Scenario 4: Multiple Jobs (4+) ✅

**Call transcript:**
> "Hi, I have quite a lot - TV mounting, two fence panels, bathroom tiles, kitchen tap, and some electrical sockets to check."

**Generated message:**
```
Hi there! We just spoke about the multiple repairs. Please send us a video so we can take a look and get a price back to you! 📹
```

---

## Scenario 5: Vague/Unclear ✅

**Call transcript:**
> "Yeah, hi. I have some general handyman stuff that needs doing around the house. Can you help?"

**Generated message:**
```
Hi there! We just spoke about the work you need. Please send us a video so we can take a look and get a price back to you! 😊
```

---

## Scenario 6: No Name Detected ✅

**Call transcript:**
> "Hello, I need someone for TV mounting."

**Generated message:**
```
Hi there! We just spoke about the TV mounting. Please send us a video so we can take a look and get a price back to you! 📹
```

---

## Scenario 7: SKU Match ✅

**Call transcript:**
> "Hi, I'm David. I need help installing a Ring doorbell on my front door."

**SKU Detected:** Ring doorbell installation

**Generated message:**
```
Hi David! We just spoke about the ring doorbell installation. Please send us a video so we can take a look and get a price back to you! 📹
```

---

## Scenario 8: Property Manager with Multiple Units ✅

**Call transcript:**
> "Hi, this is Lisa from ABC Properties. We have several units that need work - basically general maintenance across the building."

**Generated message:**
```
Hi Lisa! We just spoke about the repairs you mentioned. Please send us a video so we can take a look and get a price back to you! 🔧
```

---

## How the AI Decides

The `extractAdaptiveJobPhrase()` function uses GPT-4o-mini to:

1. **Count jobs** mentioned in the transcript
2. **Assess clarity** - are they specific or vague?
3. **Choose format:**
   - 1 job → "the [specific job]"
   - 2 jobs → "the [job1] and [job2]"
   - 3 jobs → "the [job1], [job2], and [job3]"
   - 4+ jobs → "the multiple repairs" or "the several jobs"
   - Vague → "the work you need" or "the repairs you mentioned"

4. **Add context** when appropriate:
   - "at your property"
   - "you mentioned"
   - "we discussed"

---

## Fallback Strategy

If anything goes wrong (API error, no transcript, etc.):

**Generic fallback:**
```
Hi there! We just spoke about the work you need. Please send us a video so we can take a look and get a price back to you! 🛠️
```

This ensures messages are ALWAYS coherent and professional, regardless of edge cases.

---

## Testing

To test this system:

1. **Make a call** to your Twilio number
2. **Mention different job types:**
   - Try single job: "I need TV mounting"
   - Try multiple jobs: "I need TV mounting and fence repair"
   - Try vague: "I have some general work"
3. **Click "Request Video"**
4. **Check the generated message**

The message should intelligently adapt to what you said!
