
import fetch from 'node-fetch';

async function verifyBooking() {
    const baseUrl = 'http://localhost:5001';

    console.log('--- 1. Checking Initial Stats ---');
    let initialLeadsCount = 0;
    try {
        const res = await fetch(`${baseUrl}/api/dashboard/stats`);
        if (res.ok) {
            const stats = await res.json();
            console.log('Initial Stats:', stats);
            initialLeadsCount = stats.leadsToday || 0;
        } else {
            console.log('Failed to fetch stats:', res.status);
        }
    } catch (err) {
        console.error('Error fetching stats:', err);
    }

    console.log('\n--- 2. Creating New Booking ---');
    const newBooking = {
        customerName: "Verify User",
        phone: "07999888777",
        email: "verify@test.com",
        jobDescription: "Diagnostic Visit - Standard Visit. Booked for Jan 20 Morning (8am - 12pm).",
        source: "diagnostic_visit",
        transcriptJson: {
            visitTier: "standard",
            bookingDate: new Date().toISOString(), // Use current date for simplicity
            bookingSlot: "morning",
            stripePaymentIntentId: "pi_mock_verify"
        }
    };

    try {
        // Note: server/leads.ts defines path as '/leads' (line 14) mounted on leadsRouter
        // Usually routers are mounted with /api prefix in index.ts. Let's try /api/leads first.
        // If router is mounted at root, it might be /leads. But convention is /api.
        // Looking at other routes in leads.ts, some iterate /api explicitly (line 65).
        // The first one is just '/leads'. If the router is mounted at /api, then it's /api/leads.
        const res = await fetch(`${baseUrl}/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newBooking)
        });

        if (res.ok) {
            const data = await res.json();
            console.log('Booking Created:', data);
        } else {
            console.log('Booking Creation Failed:', res.status, await res.text());
            return;
        }
    } catch (err) {
        console.error('Error creating booking:', err);
        return;
    }

    console.log('\n--- 3. Verifying Stats Increment ---');
    try {
        const res = await fetch(`${baseUrl}/api/dashboard/stats`);
        if (res.ok) {
            const stats = await res.json();
            console.log('Updated Stats:', stats);
            if (stats.leadsToday > initialLeadsCount) {
                console.log('SUCCESS: Leads Today count incremented!');
            } else {
                console.log('WARNING: Leads Today count did not increment. (Maybe cached?)');
            }
        }
    } catch (err) {
        console.error('Error fetching updated stats:', err);
    }

    console.log('\n--- 4. Verifying Lead in List ---');
    try {
        const res = await fetch(`${baseUrl}/leads`);
        if (res.ok) {
            const leads = await res.json();
            const found = leads.find((l: any) => l.customerName === "Verify User");
            if (found) {
                console.log('SUCCESS: Found new lead in list:', found.id);
            } else {
                console.log('FAILURE: Could not find new lead in list.');
            }
        }
    } catch (err) {
        console.error('Error fetching lead list:', err);
    }
}

verifyBooking();
