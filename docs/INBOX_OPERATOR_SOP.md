# Standard Operating Procedure (SOP): Inbox Dispatcher ("The Human in the Loop")

## Role Overview
As the **Dispatcher (D)**, your role is to supervise the AI Agent. You do not need to hunt for information. The Agent has already listened to the call, read the message, and prepared the work. Your job is to **Verify & Click**.

---

## 1. The Workflow

### Step 1: Notifications
- You will hear a "Ping" or see a badge count increase in the **Inbox**.
- **Rule**: Prioritize threads with the **Red (Urgent)** or **Blue (Draft Ready)** indicators.

### Step 2: Review the Thread
- Click the thread. You will see:
  1.  **The Call/Lead**: A single summary line (e.g., "Boiler leaking, user sounded stressed").
  2.  *Optional*: Click "Expand" to read the full transcript if the summary is unclear.
  3.  **The Proposed Action**: A distinct card **inside the thread**.

### Step 3: Verify the Action
- The Agent will propose one of three paths:
    - **A. Reply**: A pre-written WhatsApp message.
        - *Check*: Is the tone right? Is the name correct?
    - **B. Create Quote**: A pre-filled quote form.
        - *Check*: Are the line items (SKUs) correct? (e.g., did it catch "2 radiators"?).
    - **C. Book Visit**: A calendar scheduling request.
        - *Check*: Is the urgency (Emergency vs. Standard) correct?

### Step 4: Execute (One-Click)
- **If Correct**: Click the Green **"Send Message"** or **"Send Quote"** button.
    - *Result*: The system sends the WhatsApp/Email instantly. The thread is marked "Done".
- **If Incorrect**:
    - Click **"Edit"** (Pencil Icon) to tweak the text or quote items.
    - *Then* Click Send.

---

## 2. Handling Exceptions

### Scenario A: "AI Incomplete"
- **Indicator**: A yellow warning tag saying "AI Incomplete" or "No Lead Found".
- **Action**: This means the caller hung up or didn't speak clearly.
- **SOP**: Listen to the recording (Play button). Call them back manually using the "Call" button in the header.

### Scenario B: "Double Bubbles"
- **Indicator**: You see a "Call" vs a "WhatsApp" timestamp conflict.
- **Action**: Trust the **Call** record. It contains the audio truth. The WhatsApp timestamp is likely just the system logging the start of the chat.

### Scenario C: Complex Queries
- **Indicator**: The Agent proposes "Reply" with a vague draft like "I'm checking on this."
- **Action**: This means the AI didn't find a specific SKU.
- **SOP**: Use your judgment. If it's a known job, hit "Create Quote" manually from the bottom bar. If unknown, send the draft to open a dialogue.

---

## 3. Daily Checklist
- [ ] **Pending**: Clear all items in the "Pending" tab by 10 AM.
- [ ] **Missed Calls**: Check the "Missed" filter. These are P0 (Top Priority).
- [ ] **Stuck Threads**: If a thread has no reply for >4 hours, send a "Nudge" template.

---

## 4. The "Golden Rule" / Philosophy
> *"The AI is the junior clerk who prepares the file. You are the Senior Partner who signs it."*
> Don't do the work from scratch. Critique the draft.
