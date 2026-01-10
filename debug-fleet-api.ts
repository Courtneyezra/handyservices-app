
import fetch from 'node-fetch';

async function testFleetApi() {
    try {
        console.log("Fetching /api/handymen...");
        const response = await fetch('http://localhost:5001/api/handymen');

        if (!response.ok) {
            console.error(`Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(text);
            return;
        }

        const data = await response.json();
        console.log(`Received ${data.length} handymen.`);

        // Check for the recent user "Paul pop"
        const paul = data.find((h: any) => h.user?.firstName === 'Paul');

        if (paul) {
            console.log("Found Paul!");
            console.log(JSON.stringify(paul, null, 2));
        } else {
            console.log("Paul NOT found in API response.");
            // Print first 2 entries to see structure
            console.log("Sample Data:", JSON.stringify(data.slice(0, 2), null, 2));
        }

    } catch (error) {
        console.error("Test failed:", error);
    }
}

testFleetApi();
