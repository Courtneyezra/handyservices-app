import { Router } from "express";
import Stripe from "stripe";
import { computePlan, completedBookedRemaining, SIGNED_OFF_BALANCE, type Selection } from "../shared/plan-pricing";

// Public customer plan page (/plan/:slug) — settle checkout.
// Charges (a) the signed-off original-works balance (fixed, server-side) and/or
// (b) a deposit for any NEW works the customer selected — recomputed server-side
// from the item ids (never trust a client-sent amount) — in one Stripe session.

function getStripe(): Stripe {
  const key = (process.env.STRIPE_SECRET_KEY || "").replace(/^["']|["']$/g, "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  return new Stripe(key, { apiVersion: "2024-06-20" as any });
}

const router = Router();

router.post("/:slug/deposit-checkout", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").slice(0, 64);
    const selection: Selection[] = Array.isArray(req.body?.selection)
      ? req.body.selection.filter((s: any) => s && typeof s.id === "string").map((s: any) => ({ id: s.id, opt: typeof s.opt === "number" ? s.opt : undefined }))
      : [];

    const plan = computePlan(selection);
    // Settle the signed-off works unless the client explicitly opts out.
    const settle = req.body?.settleBalance !== false;
    const balance = settle ? SIGNED_OFF_BALANCE : 0;
    const completed = settle ? completedBookedRemaining().remaining : 0;

    const payNow = balance + completed + plan.deposit;
    if (payNow <= 0) return res.status(400).json({ error: "Nothing to pay" });

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    if (balance > 0) {
      line_items.push({
        price_data: {
          currency: "gbp",
          product_data: {
            name: "Completed works — final balance (30 Sidney Road)",
            description: "Signed off by the customer · original agreed works",
          },
          unit_amount: balance * 100,
        },
        quantity: 1,
      });
    }
    if (completed > 0) {
      line_items.push({
        price_data: {
          currency: "gbp",
          product_data: {
            name: "Upstairs bathroom + hallway ceiling — balance (30 Sidney Road)",
            description: "Now complete · remaining balance after deposit",
          },
          unit_amount: completed * 100,
        },
        quantity: 1,
      });
    }
    if (plan.deposit > 0) {
      line_items.push({
        price_data: {
          currency: "gbp",
          product_data: {
            name: "New works — deposit (30 Sidney Road)",
            description: `Deposit for ${plan.lines.length} item(s) · new works total £${plan.total.toLocaleString("en-GB")}`,
          },
          unit_amount: plan.deposit * 100, // pounds -> pence
        },
        quantity: 1,
      });
    }

    const host = req.get("host") || "handyservices.app";
    const proto = /localhost|127\.0\.0\.1/.test(host) ? "http" : "https"; // Cloudflare terminates TLS; force https in prod
    const origin = `${proto}://${host}`;
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${origin}/plan/${slug}?paid=1`,
      cancel_url: `${origin}/plan/${slug}`,
      metadata: {
        slug,
        kind: "plan_settlement",
        items: JSON.stringify(selection).slice(0, 480),
        worksTotalPence: String(plan.total * 100),
        depositPence: String(plan.deposit * 100),
        balancePence: String(balance * 100),
        completedPence: String(completed * 100),
        payNowPence: String(payNow * 100),
      },
    });

    res.json({ url: session.url });
  } catch (e: any) {
    console.error("[plan] deposit-checkout failed:", e?.message);
    res.status(500).json({ error: "Could not start payment" });
  }
});

export default router;
