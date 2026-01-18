
import fetch from "node-fetch";

const API_URL = "http://127.0.0.1:5001/leads";

const sampleLeads = [
    {
        customerName: "Alice Smith",
        phone: "07700900001",
        jobDescription: "Leaking tap in the kitchen underneath the sink. It's causing a lot of water damage.",
        postcode: "SW1A 1AA",
        source: "desktop_hero_flow",
        outcome: "new_lead"
    },
    {
        customerName: "Bob Jones",
        phone: "07700900002",
        jobDescription: "Need a TV mounted on a plasterboard wall. 55 inch TV.",
        postcode: "W1A 1AA",
        source: "desktop_hero_flow",
        outcome: "new_lead"
    },
    {
        customerName: "Charlie Brown",
        phone: "07700900003",
        jobDescription: "Garden fence panel blew down in the wind. Need it replaced.",
        postcode: "SE1 7PB",
        source: "desktop_hero_flow",
        outcome: "new_lead"
    },
    {
        customerName: "David Wilson",
        phone: "07700900004",
        jobDescription: "Flat pack furniture assembly. IKEA wardrobe.",
        postcode: "E1 6AN",
        source: "desktop_hero_flow",
        outcome: "new_lead"
    },
    {
        customerName: "Eve Taylor",
        phone: "07700900005",
        jobDescription: "Light switch not working in the hallway.",
        postcode: "N1 9GU",
        source: "desktop_hero_flow",
        outcome: "new_lead"
    }
];

async function seedLeadsApi() {
    console.log(`🌱 Seeding leads via API at ${API_URL}...`);

    let successCount = 0;

    for (const lead of sampleLeads) {
        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Origin": "http://localhost:5173",
                    "Referer": "http://localhost:5173/"
                },
                body: JSON.stringify(lead)
            });

            if (response.ok) {
                console.log(`✅ Created lead for ${lead.customerName}`);
                successCount++;
            } else {
                console.error(`❌ Failed to create lead for ${lead.customerName}: ${response.status} ${response.statusText}`);
                const text = await response.text();
                // console.error(`   Response: ${text}`); // Reduce noise if HTML
            }
        } catch (error) {
            console.error(`❌ Network error for ${lead.customerName}:`, error);
        }
    }

    console.log(`\n✨ Finished. Successfully created ${successCount}/${sampleLeads.length} leads.`);
}

seedLeadsApi();
