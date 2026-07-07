x Landlord Platform Architecture & Agent Flow

## High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           WHATSAPP (Meta Cloud API)                             │
│                                                                                 │
│    Tenant sends message              Landlord sends message                     │
│         📱 ──────────────────┐  ┌──────────────────── 📱                        │
└─────────────────────────────┼──┼────────────────────────────────────────────────┘
                              │  │
                              ▼  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        WEBHOOK LAYER (server/meta-whatsapp.ts)                  │
│                                                                                 │
│    POST /api/whatsapp/webhook                                                   │
│         │                                                                       │
│         ├─ Extract message (text / image / video / audio / document)            │
│         ├─ Download media via Meta Graph API                                    │
│         ├─ Store in DB (conversations + messages tables)                        │
│         ├─ Broadcast to WebSocket (live admin dashboard)                        │
│         │                                                                       │
│         ▼                                                                       │
│    getPhoneType(from) ─────────────────────────────────┐                        │
│         │                                              │                        │
│    ┌────┴────┐    ┌─────────┐    ┌──────────┐          │                        │
│    │ TENANT  │    │LANDLORD │    │ UNKNOWN  │          │                        │
│    └────┬────┘    └────┬────┘    └────┬─────┘          │                        │
│         │              │              │                 │                        │
│         ▼              ▼              ▼                 │                        │
│  handleTenant    handleLandlord   ConversationEngine   │                        │
│   Message()       Message()        (legacy flow)       │                        │
└─────────┼──────────────┼──────────────┼─────────────────────────────────────────┘
          │              │              │
          ▼              ▼              │
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      TENANT CHAT LAYER (server/tenant-chat.ts)                  │
│                                                                                 │
│  ┌─────────────────────────┐     ┌──────────────────────────────┐               │
│  │  handleTenantMessage()  │     │  handleLandlordMessage()     │               │
│  │                         │     │                              │               │
│  │  1. Transcribe audio    │     │  1. Check if YES/NO reply    │               │
│  │     (OpenAI Whisper)    │     │     (L4 approval handler)    │               │
│  │  2. Upload media        │     │     ├─ YES → approve issue   │               │
│  │  3. Route to AI ────────┼─┐   │     ├─ NO  → reject issue    │               │
│  │  4. Attach photos       │ │   │     └─ Other → AI worker     │               │
│  │  5. L2: Notify landlord │ │   │  2. Route to AI ─────────────┼─┐             │
│  │  6. Send WA response    │ │   │  3. Send WA response         │ │             │
│  └─────────────────────────┘ │   └──────────────────────────────┘ │             │
│                              │                                    │             │
└──────────────────────────────┼────────────────────────────────────┼─────────────┘
                               │                                    │
                               ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     AI ORCHESTRATOR (server/ai/orchestrator.ts)                  │
│                                                                                 │
│  route(message) ───────────────────────────────────────────────────┐             │
│       │                                                            │             │
│       ├─ 1. identifySender(phone)                                  │             │
│       │      └─ Query tenants + leads tables                       │             │
│       │      └─ Return { type, tenant?, landlord?, property? }     │             │
│       │                                                            │             │
│       ├─ 2. buildContext(sender, message)                          │             │
│       │      ├─ Fetch last 20 conversation messages                │             │
│       │      ├─ Get/create TenantIssue                             │             │
│       │      └─ Fetch LandlordSettings                             │             │
│       │                                                            │             │
│       ├─ 3. determineWorker(sender, context) ─────────┐            │             │
│       │                                               ▼            │             │
│       │      ┌──────────────────────────────────────────┐          │             │
│       │      │         WORKER ROUTING LOGIC              │          │             │
│       │      │                                          │          │             │
│       │      │  Landlord? ──────────► LANDLORD_WORKER   │          │             │
│       │      │                                          │          │             │
│       │      │  Tenant + new issue? ► TENANT_WORKER     │          │             │
│       │      │                                          │          │             │
│       │      │  Tenant + awaiting                       │          │             │
│       │      │  details complete? ──► TRIAGE_WORKER     │          │             │
│       │      │                                          │          │             │
│       │      │  Tenant + reported? ─► DISPATCH_WORKER   │          │             │
│       │      └──────────────────────────────────────────┘          │             │
│       │                                                            │             │
│       ├─ 4. Execute selected worker                                │             │
│       ├─ 5. handleHandoff() (max 3 deep)                           │             │
│       ├─ 6. updateIssueState()                                     │             │
│       └─ 7. saveConversation()                                     │             │
│                                                                    │             │
└────────────────────────────────────────────────────────────────────┘             │
                               │                                                   │
                               ▼                                                   │
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│                          4 AI WORKERS (OpenAI GPT)                               │
│                                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐                             │
│  │    TENANT WORKER     │  │    TRIAGE WORKER      │                             │
│  │    (temp: 0.7)       │  │    (temp: 0.3)        │                             │
│  │                      │  │                       │                             │
│  │  "Friendly helper"   │  │  "Categorise & price" │                             │
│  │                      │  │                       │                             │
│  │  Tools:              │  │  Tools:               │                             │
│  │  • assess_issue      │  │  • categorize_and_    │                             │
│  │  • start_trouble-    │  │    price              │                             │
│  │    shooting          │  │  • search_similar_    │                             │
│  │  • get_diy_advice    │  │    skus               │                             │
│  │  • request_photos    │  │  • calculate_         │                             │
│  │  • request_          │  │    complexity          │                             │
│  │    availability      │  │  • ready_for_         │                             │
│  │  • mark_resolved_diy │  │    dispatch ──────┐   │                             │
│  │  • ready_for_        │  │                   │   │                             │
│  │    triage ───────┐   │  └───────────────────┼───┘                             │
│  │                  │   │                      │                                 │
│  └──────────────────┼───┘                      │                                 │
│                     │         ┌─────────────────┘                                │
│                     │  HANDOFF│                                                   │
│                     ▼         ▼                                                   │
│  ┌──────────────────────┐  ┌──────────────────────┐                             │
│  │   DISPATCH WORKER    │  │   LANDLORD WORKER    │                             │
│  │   (temp: 0.2)        │  │   (temp: 0.5)        │                             │
│  │                      │  │                       │                             │
│  │  "Decision maker"    │  │  "Landlord assistant" │                             │
│  │                      │  │                       │                             │
│  │  Tools:              │  │  Tools:               │                             │
│  │  • get_landlord_     │  │  • get_pending_       │                             │
│  │    rules             │  │    approvals           │                             │
│  │  • evaluate_dispatch │  │  • approve_issue      │                             │
│  │  • check_availability│  │  • reject_issue       │                             │
│  │  • book_job          │  │  • get_spending_      │                             │
│  │  • request_landlord_ │  │    summary             │                             │
│  │    approval ─────────┼──│  • get_property_      │                             │
│  │  • notify_landlord   │  │    issues              │                             │
│  │  • update_budget     │  │  • update_settings    │                             │
│  │                      │  │  • list_properties    │                             │
│  └──────────┬───────────┘  └──────────────────────┘                             │
│             │                                                                    │
└─────────────┼────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     RULES ENGINE (server/rules-engine.ts)                        │
│                                                                                 │
│  evaluateDispatchRules(issue, estimate, landlordSettings)                        │
│       │                                                                         │
│       ├─ 1. Emergency urgency?     ──────────► AUTO_DISPATCH 🚨                 │
│       ├─ 2. Emergency category?    ──────────► AUTO_DISPATCH 🚨                 │
│       ├─ 3. Always require approval category? ► REQUEST_APPROVAL 🔔             │
│       ├─ 4. Price > approval threshold?  ────► REQUEST_APPROVAL 🔔             │
│       ├─ 5. Budget exceeded?       ──────────► REQUEST_APPROVAL 🔔             │
│       ├─ 6. Price ≤ auto-approve + category? ► AUTO_DISPATCH ✅                 │
│       ├─ 7. Safe category + high confidence? ► AUTO_DISPATCH ✅                 │
│       └─ 8. Default                ──────────► REQUEST_APPROVAL 🔔             │
│                                                                                 │
│  Default Landlord Rules:                                                        │
│  ├─ Auto-approve under: £150                                                    │
│  ├─ Require approval above: £500                                                │
│  ├─ Auto categories: plumbing_emergency, heating, security, water_leak          │
│  └─ Always require: cosmetic, upgrade                                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘


## Issue Lifecycle (State Machine)

```
  ┌───────────┐
  │    NEW     │  Tenant starts chat
  └─────┬─────┘
        │
        ▼
  ┌───────────┐
  │ AI_HELPING │  TENANT_WORKER: reassure, assess, DIY check
  └─────┬─────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
┌──────┐ ┌──────────────┐
│RESOLVD│ │AWAITING_     │  Gathering: photos, availability, details
│ _DIY  │ │DETAILS       │
└──────┘ └──────┬───────┘
                │
                ▼
          ┌───────────┐
          │ REPORTED   │  TRIAGE_WORKER categorised + priced
          └─────┬─────┘  DISPATCH_WORKER evaluates rules
                │
       ┌────────┼────────┐
       │        │        │
       ▼        ▼        ▼
  ┌────────┐ ┌────────┐ ┌──────────┐
  │AUTO    │ │REQUEST │ │CANCELLED │  Landlord rejected
  │DISPATCH│ │APPROVAL│ └──────────┘
  └───┬────┘ └───┬────┘
      │          │
      │     Landlord replies
      │     YES / NO via WhatsApp
      │          │
      │     ┌────┴────┐
      │     │         │
      │     ▼         ▼
      │  ┌────────┐ ┌──────────┐
      │  │APPROVED│ │CANCELLED │
      │  └───┬────┘ └──────────┘
      │      │
      ▼      ▼
  ┌───────────┐
  │ SCHEDULED  │  Time slot booked
  └─────┬─────┘
        │
        ▼
  ┌───────────┐
  │IN_PROGRESS │  Contractor on site
  └─────┬─────┘
        │
        ▼
  ┌───────────┐
  │ COMPLETED  │  Job done → invoice → payment
  └───────────┘
```


## WhatsApp Notification Flows

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         OUTBOUND NOTIFICATIONS                                  │
│                                                                                 │
│  TENANT NOTIFICATIONS (server/services/tenant-notifications.ts)                 │
│  ─────────────────────────────────────────────────────────────                  │
│                                                                                 │
│  WELCOME  │ Tenant added to property    │ "Welcome to Handy Services at..."    │
│  T4       │ Issue status changes        │ "Your repair has been approved..."   │
│  T5       │ Contractor assigned         │ "Dave's Plumbing scheduled for..."   │
│  T6       │ ⏰ Appointment reminder     │ "Reminder: repair tomorrow at..."    │
│  T7       │ Job completed               │ "Your repair is done! Any issues..." │
│  T8       │ ⏰ Satisfaction survey      │ "Rate 1-5: how was the work?"        │
│                                                                                 │
│  LANDLORD NOTIFICATIONS (server/services/landlord-notifications.ts)             │
│  ──────────────────────────────────────────────────────────────                 │
│                                                                                 │
│  L2       │ New issue reported          │ "🔔 New issue at [property]..."      │
│  L3       │ Approval request            │ "Reply YES to approve or NO..."      │
│  L4       │ Approval/rejection confirm  │ "✅ Approved" / "❌ Noted"           │
│  L6       │ Job completion report       │ "✅ Job Complete + cost + photos"    │
│  L7       │ Payment received            │ "Payment of £X received..."          │
│  L8       │ ⏰ Balance reminder         │ "Outstanding balance of £X..."       │
│  L9       │ ⏰ Emergency escalation     │ "⚠️ URGENT: Auto-dispatch in 30m"   │
│  L10      │ ⏰ Quarterly maintenance    │ "Time for seasonal check..."         │
│  L11      │ ⏰ Monthly spend summary    │ "3 jobs, £450 total this month"      │
│                                                                                 │
│  ⏰ = Cron/scheduled job                                                       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```


## Landlord Portal API (server/landlord-portal.ts)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         LANDLORD PORTAL (REST API)                              │
│                                                                                 │
│  PUBLIC                                                                         │
│  ──────                                                                         │
│  POST /api/landlord/signup          Create account + default settings           │
│                                                                                 │
│  AUTHENTICATED (/:token)                                                        │
│  ───────────────────────                                                        │
│                                                                                 │
│  Profile                                                                        │
│  ├─ GET  /profile                   Landlord info + property/issue stats        │
│  ├─ GET  /settings                  Auto-approve rules, budget, preferences     │
│  └─ PATCH /settings                 Update rules                                │
│                                                                                 │
│  Properties                                                                     │
│  ├─ GET   /properties               List all properties                         │
│  ├─ POST  /properties               Add property                                │
│  ├─ PATCH /properties/:id           Update property                             │
│  └─ DELETE /properties/:id          Soft-delete                                 │
│                                                                                 │
│  Tenants                                                                        │
│  ├─ POST /properties/:pid/tenants   Add tenant (+ sends WhatsApp welcome)       │
│  └─ PATCH /tenants/:id              Update tenant                               │
│                                                                                 │
│  Issues                                                                         │
│  ├─ GET  /issues                    List (filter by status)                     │
│  ├─ GET  /issues/:id                Detail view                                 │
│  ├─ POST /issues/:id/approve        Approve → triggers scheduling               │
│  ├─ POST /issues/:id/reject         Reject (requires reason)                    │
│  └─ GET  /issues/:id/messages       Conversation history                        │
│                                                                                 │
│  Spending                                                                       │
│  └─ GET  /spending                  Monthly summary                             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```


## Complete End-to-End Flow Example

```
TENANT: "Hi, my kitchen tap is leaking badly"
    │
    ▼
┌─ META WEBHOOK ──────────────────────────────────────────────────────────────┐
│  meta-whatsapp.ts → getPhoneType() → TENANT → tenant-chat.ts              │
└────────────────────────────────────────────────┬────────────────────────────┘
                                                 │
    ▼                                            │
┌─ TENANT WORKER ─────────────────────────────────────────────────────────────┐
│  "Don't worry! Can you send a quick 10-15 second video of the leak?"       │
│  Tools: assess_issue() → { category: plumbing, urgency: medium }           │
│  State: NEW → AI_HELPING                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
    │
TENANT: [sends video + "I'm free tomorrow afternoon"]
    │
    ▼
┌─ TENANT WORKER ─────────────────────────────────────────────────────────────┐
│  Tools: request_photos() ✓, request_availability() ✓                       │
│  → ready_for_triage()  ═══ HANDOFF ═══►                                    │
│  State: AI_HELPING → AWAITING_DETAILS                                       │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │
    ▼                                    │
┌─ TRIAGE WORKER ─────────────────────────────────────────────────────────────┐
│  Tools: categorize_and_price()                                              │
│  → { category: plumbing, urgency: medium, estimate: £50-£80 }              │
│  → ready_for_dispatch()  ═══ HANDOFF ═══►                                  │
│  State: AWAITING_DETAILS → REPORTED                                         │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │
    ▼                                    │
┌─ DISPATCH WORKER ───────────────────────────────────────────────────────────┐
│  Tools: get_landlord_rules() → { autoApproveUnder: £150 }                  │
│         evaluate_dispatch()                                                 │
│                                                                             │
│  £65 estimate < £150 threshold   ──────► AUTO_DISPATCH ✅                   │
│  plumbing ∈ autoApproveCategories ─────► CONFIRMED                          │
│                                                                             │
│  Tools: book_job(tomorrow, 13:00-17:00)                                     │
│         notify_landlord() → WhatsApp to landlord                            │
│  State: REPORTED → APPROVED → SCHEDULED                                     │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ├──► TENANT gets: "Great news! We've booked a plumber for tomorrow 1-5pm"
    │
    └──► LANDLORD gets: "✅ Job Auto-Dispatched
                         📍 42 Oak Lane
                         📋 Leaking kitchen tap
                         💰 £50-£80
                         📅 Tomorrow 1-5pm
                         (Auto-approved per your rules)"
    │
    ▼
┌─ POST-JOB NOTIFICATIONS ───────────────────────────────────────────────────┐
│                                                                             │
│  T5: "Dave's Plumbing assigned, arriving 1-5pm tomorrow"                   │
│  T6: ⏰ Next morning: "Reminder: repair today 1-5pm"                       │
│  T7: After completion: "Your tap is fixed! Message us if any issues"       │
│  T8: ⏰ 24h later: "How was the work? Rate 1-5"                           │
│                                                                             │
│  L6: "✅ Job Complete | Cost: £65 | Photos: [link]"                        │
│  L7: After payment: "Payment of £65.00 received"                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```


## Database Relationships

```
┌─────────────┐       ┌──────────────┐       ┌───────────────┐
│   leads      │◄──────│  properties   │◄──────│   tenants      │
│  (landlords) │  1:N  │              │  1:N  │               │
│              │       │  address     │       │  phone        │
│  phone       │       │  postcode    │       │  name         │
│  segment     │       │  isActive    │       │  isPrimary    │
│  customerName│       │              │       │               │
└──────┬───────┘       └──────┬───────┘       └───────┬───────┘
       │                      │                       │
       │               ┌──────┴───────┐               │
       │               │              │               │
       └──────────────►│ tenantIssues  │◄──────────────┘
                       │              │
                       │  status      │
                       │  urgency     │
                       │  category    │
                       │  description │
                       │  photos[]    │
                       │  estimate    │
                       │  dispatch    │
                       │  timestamps  │
                       └──────┬───────┘
                              │
       ┌──────────────┐       │       ┌───────────────┐
       │ landlord     │       │       │ conversations  │
       │ Settings     │◄──────┘       │               │
       │              │               │  messages[]    │
       │ autoApprove  │               │  lastMessage   │
       │ budget       │               │  unreadCount   │
       │ categories   │               └───────────────┘
       │ notifications│
       └──────────────┘
```


## File Map

```
server/
├── index.ts                          # Express app + route mounting
├── meta-whatsapp.ts                  # Meta webhook + sendWhatsAppMessage()
├── whatsapp-api.ts                   # Legacy Twilio webhook
├── tenant-chat.ts                    # Tenant/landlord message routing + L2/L4
├── landlord-portal.ts                # REST API for landlord dashboard
├── rules-engine.ts                   # Dispatch decision logic
├── conversation-engine.ts            # Legacy conversation state machine
├── cron.ts                           # Scheduled jobs
│
├── ai/
│   ├── orchestrator.ts               # Central AI coordinator
│   ├── provider.ts                   # OpenAI/Anthropic adapter
│   └── workers/
│       ├── base-worker.ts            # Shared tools + base class
│       ├── tenant-worker.ts          # Issue gathering + DIY
│       ├── triage-worker.ts          # Categorisation + pricing
│       ├── dispatch-worker.ts        # Rules evaluation + booking
│       └── landlord-worker.ts        # Approvals + settings
│
├── services/
│   ├── tenant-notifications.ts       # T4-T8, L7-L8 WhatsApp flows
│   └── landlord-notifications.ts     # L3-L11 WhatsApp flows
│
shared/
└── schema.ts                         # Drizzle ORM (all tables)

scripts/
├── test-all-notifications.ts         # Test 20 notification flows
└── test-check-delivery.ts            # Verify delivery status
```
