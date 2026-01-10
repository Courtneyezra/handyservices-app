
import fetch from 'node-fetch';

async function testFleetApi() {
    try {
        console.log("Fetching /api/handymen...");
        const response = await fetch('http://localhost:5001/api/handymen');
        const data = await response.json();

        console.log(`Total Handymen Count: ${data.length}`);

        const paul = data.find((h: any) => h.user?.firstName === 'Paul');

        if (paul) {
            console.log("PAUL FOUND IN API: YES");
            console.log(JSON.stringify({
                id: paul.id,
                name: paul.user?.firstName,
                lat: paul.latitude,
                lng: paul.longitude,
                skills: paul.skills?.length || 0,
                postcode: paul.postcode
            }, null, 2));
        } else {
            console.log("PAUL FOUND IN API: NO");
            console.log("First 3 Names:", data.slice(0, 3).map((h: any) => h.user?.firstName).join(', '));
        }

    } catch (error) {
        console.error("Test failed:", error);
    }
}

testFleetApi();
