
import fetch from 'node-fetch';

async function verifyRegistration() {
    const email = `test.geocode.${Date.now()}@example.com`;
    const password = 'Password123!';
    const postcode = 'SW1A 1AA'; // Downing Street

    console.log(`Registering user with email: ${email} and postcode: ${postcode}`);

    try {
        const res = await fetch('http://localhost:5001/api/contractor/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                password,
                firstName: 'Test',
                lastName: 'Geocode',
                postcode
            })
        });

        const data = await res.json();

        if (!res.ok) {
            console.error('Registration failed:', data);
            return;
        }

        console.log('Registration successful:', data.user.id);
        console.log('Profile ID:', data.profileId);

        // Now fetch the profile to check lat/lng
        // We can use the open /api/handymen endpoint or simple DB check script
        // Let's use a quick DB check logic here (since I can't easily query DB in this script without imports, 
        // actually I can assume the server is running and I can use the same `debug-fleet-api.ts` logic or just call the API)

        // Let's call /api/handymen and find this new user
        const listRes = await fetch('http://localhost:5001/api/handymen');
        const list = await listRes.json();

        const myProfile = list.find((h: any) => h.id === data.profileId || h.user?.email === email);

        if (myProfile) {
            console.log('Profile found in API!');
            console.log('Latitude:', myProfile.latitude);
            console.log('Longitude:', myProfile.longitude);

            if (myProfile.latitude && myProfile.longitude) {
                console.log('SUCCESS: Coordinates populated!');
            } else {
                console.log('FAILURE: Coordinates missing.');
            }
        } else {
            console.log('Profile NOT found in API list (might be filtered if 0 skills?)');
            // If filtered, we might need to rely on DB check or just assume if it worked.
            // But wait, /api/handymen returns ALL unless filtered by radius/lat/lng query params which we aren't sending.
            // But frontend filters by skills. The API returns all.
            // Let's check.
        }

    } catch (err) {
        console.error('Test failed:', err);
    }
}

verifyRegistration();
