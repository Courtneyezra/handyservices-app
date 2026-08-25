import crypto from 'crypto';
import 'dotenv/config';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
console.log('Secret length:', WEBHOOK_SECRET.length);

const QUOTE_ID = process.env.QUOTE_ID || 'quote_ZDDF-l3oZe6rKqefZpDSX';
const LOCK_ID = parseInt(process.env.LOCK_ID || '59', 10);
const PI_ID = process.env.PI_ID || 'pi_3TbKFb4p9GekG4mY1Dlr1wK2';
const CONTRACTOR_ID = process.env.CONTRACTOR_ID || 'hp_15b5249f-b433-4f7f-b1d0-a8d462c95aac';
const BASE = process.env.BASE_URL || 'http://localhost:51273';

const event = {
  id: `evt_smoke_${Date.now()}`,
  object: 'event',
  api_version: '2023-10-16',
  created: Math.floor(Date.now() / 1000),
  type: 'payment_intent.succeeded',
  livemode: false,
  data: {
    object: {
      id: PI_ID,
      object: 'payment_intent',
      amount: 2250,
      amount_received: 2250,
      currency: 'gbp',
      status: 'succeeded',
      metadata: {
        quoteId: QUOTE_ID,
        customerName: 'Phase 2 Verify',
        customerEmail: 'verify@phase2.test',
        paymentType: 'deposit',
        totalJobPrice: '7500',
        depositAmount: '2250',
        selectedExtras: '',
        lockId: String(LOCK_ID),
        contractorId: CONTRACTOR_ID,
        scheduledDate: '2026-05-29',
        scheduledSlot: 'am',
      },
    },
  },
};

const payload = JSON.stringify(event);
const ts = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
const stripeSig = `t=${ts},v1=${sig}`;

const res = await fetch(`${BASE}/api/stripe/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': stripeSig },
  body: payload,
});
console.log('Webhook:', res.status, await res.text());
process.exit(0);
