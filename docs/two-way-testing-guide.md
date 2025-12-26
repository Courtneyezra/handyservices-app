# Two-Way Conversation Testing Guide

## Setup for Solo Testing

Since you don't have someone to test with, here are two methods to test the two-way conversation transcription:

---

## Method 1: Call Yourself (Two Phones) ✅ EASIEST

**What you need:**
- Two phones (or one phone + computer/tablet with calling app)

**Setup:**

1. **Add test callback number to `.env`:**
   ```bash
   TEST_CALLBACK_NUMBER=+447XXXXXXXXX  # Your second phone number
   ```

2. **Update Twilio webhook temporarily:**
   - Go to Twilio Console → Phone Numbers
   - Change webhook URL to:
   ```
   https://YOUR_NGROK_URL/api/twilio/voice-test
   ```

3. **Test:**
   - Call your Twilio number from Phone A
   - System will call Phone B automatically
   - Answer Phone B
   - Have a conversation with yourself!
   - Watch the transcript capture both sides

4. **Restore normal webhook when done:**
   ```
   https://YOUR_NGROK_URL/api/twilio/voice
   ```

---

## Method 2: Use Voice Recording (Simulate Conversation)

**Create a test with pre-recorded dialogue:**

1. **Record yourself saying both sides:**
   - "Hi, I need some help with TV mounting"
   - *pause 2 seconds*
   - "Sure, I can help with that. What size is your TV?"
   - *pause 2 seconds*
   - "It's a 55-inch Samsung"
   - *pause 2 seconds*
   - "Got it. Where would you like it mounted?"

2. **Play this during call:**
   - Call Twilio number
   - Hold phone to speaker playing recording
   - System will transcribe with speaker diarization

---

## Method 3: Use Twilio Simulator (Online)

**Simulate both sides without actual calls:**

1. **Go to:** https://www.twilio.com/console/voice/twiml/simulator

2. **Paste TwiML:**
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <Response>
       <Start>
           <Stream url="wss://YOUR_NGROK_URL/api/twilio/realtime"/>
       </Start>
       <Say>Customer: I need TV mounting</Say>
       <Pause length="2"/>
       <Say>Agent: What size TV?</Say>
       <Pause length="2"/>
       <Say>Customer: 55 inch Samsung</Say>
   </Response>
   ```

3. **Click "Make Request"** and watch transcription

---

## What You Should See

### In Live Call UI:

```
┌─────────────────────────────────────┐
│ Speaker 0 (VA):                     │
│ "Hello, what can I help you with?"  │
│                                     │
│ Speaker 1 (Customer):               │
│ "I need TV mounting"                │
│                                     │
│ Speaker 0 (VA):                     │
│ "What size is the TV?"              │
│                                     │
│ Speaker 1 (Customer):               │
│ "55 inch Samsung"                   │
└─────────────────────────────────────┘
```

### In WhatsApp Message:

```
Hi there! We just spoke about the TV mounting. 
Please send us a video so we can take a look 
and get a price back to you! 📹
```

---

## Quick Test Script

**For Method 1 (Two Phones):**

1. Phone A calls Twilio number
2. System connects to Phone B
3. Answer Phone B
4. Phone A: "Hi, I need fence panel replacement"
5. Phone B: "Ok, how many panels?"
6. Phone A: "Two panels in the back garden"
7. Phone B: "Got it, anything else?"
8. Phone A: "No, that's it"
9. Hang up
10. Check transcript - should show all 5 exchanges
11. Click "Request Video" - message should mention fence panels

---

## Troubleshooting

**Issue:** Only hearing one side

**Fix:** Make sure webhook includes `<Start><Stream>` before `<Dial>`

---

**Issue:** No second phone number

**Alternative:** 
- Use Google Voice (free US number)
- Use Skype number
- Use WhatsApp calling
- Use Discord/any VoIP app on computer

---

## After Testing

**Remember to:**
1. Switch webhook back to `/api/twilio/voice`
2. Remove `TEST_CALLBACK_NUMBER` from `.env`
3. You're ready for production!

---

## Expected Results

✅ **Both sides transcribed**  
✅ **Speaker labels (0 and 1)**  
✅ **SKU detection from full conversation**  
✅ **WhatsApp message with correct context**  
✅ **Database saves complete transcript**

---

**Ready to test?** Use Method 1 if you have two phones/devices!
