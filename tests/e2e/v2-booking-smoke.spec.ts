import { test, expect } from "@playwright/test";

/**
 * End-to-end smoke test for the /v2 booking flow.
 *
 * Walks the happy path from the Nottingham service grid all the way to the
 * Stripe-confirmed confirmation screen using the well-known `4242 4242 4242
 * 4242` Stripe test card. Verifies:
 *   - service cards on /v2 add items into the cart
 *   - the basket → date → address → review chain navigates correctly
 *   - the in-page Stripe Elements form mounts and accepts a test card
 *   - the BookingConfirmation screen renders with a HS-YYYY-XXXXX reference
 *
 * Selectors deliberately use `getByRole` / `getByText` rather than CSS
 * classnames so the test survives Tailwind churn. The mobile viewport set in
 * `playwright.config.ts` (390×844) ensures we exercise the mobile sticky
 * "View basket" CTA + sticky "Continue" CTAs through the flow.
 */
test("v2 booking happy path: /v2 → confirmation with Stripe test card", async ({
    page,
}) => {
    // -----------------------------------------------------------------------
    // 1. Land on /v2 with a clean slate.
    // -----------------------------------------------------------------------
    // Clear any prior cart/booking state from localStorage to make the test
    // deterministic regardless of how the underlying browser context starts.
    await page.goto("/v2");
    await page.evaluate(() => {
        localStorage.removeItem("handy-v2-cart");
        localStorage.removeItem("handy-v2-booking");
    });
    await page.reload();
    await expect(page).toHaveURL(/\/v2$/);

    // -----------------------------------------------------------------------
    // 2. Add two items to the cart.
    // -----------------------------------------------------------------------
    // Pick two flat (non-tiered) services so ADD directly mutates the cart
    // rather than forcing the detail modal open. Tiered services like
    // "Smart lock installation" or "Drill & hang" route through the modal.
    //
    // First add: "Book handyman for 30 mins" (top of the page, no scrolling
    // needed). Second add: "TV uninstallation" (lower in the page, exercises
    // scrollIntoViewIfNeeded).
    const firstCard = page.locator("article", {
        hasText: "Book handyman for 30 mins",
    });
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.getByRole("button", { name: /^Add$/ }).click();

    const tvUninstallCard = page.locator("article", {
        hasText: "TV uninstallation",
    });
    await tvUninstallCard.scrollIntoViewIfNeeded();
    await tvUninstallCard.getByRole("button", { name: /^Add$/ }).click();

    // -----------------------------------------------------------------------
    // 3. Continue to basket → date → address → review.
    // -----------------------------------------------------------------------
    // Mobile viewport renders the sticky "View basket" bar after the first
    // add. The desktop "Continue" lives inside the right-column sticky card.
    await page.getByRole("button", { name: /View basket/i }).click();
    await expect(page).toHaveURL(/\/basket/);

    // Basket → date. Mobile renders just "Continue"; desktop "Continue to
    // date & time". A `/Continue/i` pattern covers both.
    await page.getByRole("button", { name: /Continue/i }).first().click();
    await expect(page).toHaveURL(/\/booking\/date/);

    // Date strip: pick the 3rd date card — far enough out to avoid edge
    // cases on today / short-notice slots but well within the rendered
    // 14-day window. The date strip is the first `aria-pressed` button
    // group on the page (slots also use aria-pressed but only render once
    // a date is selected, so the strip's buttons appear first in DOM order).
    const dateStrip = page.locator(
        "section:has(h2:has-text('Pick a date')) button[aria-pressed]",
    );
    await dateStrip.first().scrollIntoViewIfNeeded();
    await dateStrip.nth(2).click();

    // Slot: prefer a mid-day window so it isn't blacked-out by demand.
    await page.getByText("10am – 12pm").click();
    await page
        .getByRole("button", { name: /Continue to address/i })
        .click();
    await expect(page).toHaveURL(/\/booking\/address/);

    // Address form. `getByLabel` matches the <label for=…> wiring inside
    // <Field>. Order matches the page layout: address block first, then
    // contact block.
    await page.getByLabel(/^Address line 1$/).fill("12 Test Street");
    await page.getByLabel(/^Town$/).fill("Nottingham");
    await page.getByLabel(/^Postcode$/).fill("NG1 1AA");
    await page.getByLabel(/^Your name$/).fill("Test Buyer");
    await page.getByLabel(/^Phone$/).fill("07123456789");
    await page.getByLabel(/^Email$/).fill("test@example.com");
    await page
        .getByRole("button", { name: /Continue to review/i })
        .click();
    await expect(page).toHaveURL(/\/booking\/review/);

    // -----------------------------------------------------------------------
    // 4. Confirm booking → mount Stripe Elements → submit a test card.
    // -----------------------------------------------------------------------
    // First "Confirm booking" creates the v2_bookings row + PaymentIntent and
    // swaps the CTA into "Pay £…". Wait for the Stripe iframe to mount.
    await page.getByRole("button", { name: /Confirm booking/i }).click();

    // Stripe's PaymentElement mounts its inputs inside an iframe. Filling them
    // requires `frameLocator` because Playwright's auto-waiting doesn't drill
    // into cross-origin frames automatically.
    const stripeFrame = page
        .frameLocator("iframe[name^='__privateStripeFrame']")
        .first();
    await stripeFrame
        .getByPlaceholder(/1234 1234 1234 1234/)
        .fill("4242 4242 4242 4242");
    await stripeFrame
        .getByPlaceholder(/MM ?\/ ?YY/)
        .fill("12 34");
    await stripeFrame.getByPlaceholder(/CVC/).fill("123");

    // UK + a few other regions: Stripe asks for a postal code inline. If
    // visible, fill it; otherwise skip.
    const postcodeField = stripeFrame.getByPlaceholder(
        /Postal code|Postcode|ZIP/i,
    );
    if (await postcodeField.count()) {
        await postcodeField.fill("NG11AA");
    }

    await page.getByRole("button", { name: /Pay £/i }).click();

    // -----------------------------------------------------------------------
    // 5. Verify confirmation screen.
    // -----------------------------------------------------------------------
    await expect(
        page.getByRole("heading", { name: /Booking confirmed/i }),
    ).toBeVisible({ timeout: 30_000 });
    // Reference format: HS-2026-ABCDE → match the leading HS- + 4-digit year.
    await expect(page.getByText(/HS-\d{4}-/)).toBeVisible();
});
