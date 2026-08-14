import { Router } from "express";
import Stripe from "stripe";
import { computePlan, type Selection } from "../shared/plan-pricing";

// Public customer plan page (/plan/:slug) — additional-works deposit checkout.
// The deposit is ALWAYS recomputed server-side from the selected item ids
// (never trust a client-sent amount), then charged via Stripe Checkout.

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
    if (plan.deposit <= 0) return res.status(400).json({ error: "No items selected" });

    const host = req.get("host") || "handyservices.app";
    const proto = /localhost|127\.0\.0\.1/.test(host) ? "http" : "https"; // Cloudflare terminates TLS; force https in prod
    const origin = `${proto}://${host}`;
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: {
            name: "Additional works deposit — 30 Sidney Road",
            description: `Deposit for ${plan.lines.length} item(s) · works total £${plan.total.toLocaleString("en-GB")}`,
          },
          unit_amount: plan.deposit * 100, // pounds -> pence
        },
        quantity: 1,
      }],
      success_url: `${origin}/plan/${slug}?paid=1`,
      cancel_url: `${origin}/plan/${slug}`,
      metadata: {
        slug,
        kind: "plan_additional_deposit",
        items: JSON.stringify(selection).slice(0, 480),
        worksTotalPence: String(plan.total * 100),
        depositPence: String(plan.deposit * 100),
      },
    });

    res.json({ url: session.url });
  } catch (e: any) {
    console.error("[plan] deposit-checkout failed:", e?.message);
    res.status(500).json({ error: "Could not start payment" });
  }
});

export default router;
