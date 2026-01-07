
// Using native fetch

async function run() {
    const payload = {
        contractorId: 'af25cab1-61b1-47f6-ac67-bb3fab0b610a',
        customerName: 'Debug User',
        jobDescription: 'Fixing the debug log',
        baseJobPrice: 5000,
        urgencyReason: 'low',
        ownershipContext: 'homeowner',
        desiredTimeframe: 'week',
        postcode: 'SW1A 1AA',
        phone: '07700900000',
        quoteMode: 'simple',
        clientType: 'homeowner',
        jobComplexity: 'low'
    };

    try {
        console.log('Sending payload:', JSON.stringify(payload, null, 2));
        const res = await fetch('http://localhost:5001/api/personalized-quotes/value', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            console.error('Error status:', res.status);
            const text = await res.text();
            console.error('Error body:', text);
            return;
        }

        const data = await res.json();
        console.log('Response data:', data);
    } catch (e) {
        console.error('Fetch error:', e);
    }
}
run();
