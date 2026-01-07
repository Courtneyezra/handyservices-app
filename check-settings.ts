
import { db } from './server/db';
import { sql, eq } from 'drizzle-orm';
import { appSettings, calls } from './shared/schema';

async function checkSettings() {
    try {
        console.log('Checking App Settings...');

        // Fetch all settings
        const settings = await db.select().from(appSettings);
        console.log(`Found ${settings.length} settings records.`);

        // Also check calls table
        console.log('Checking calls table...');
        try {
            const callsList = await db.select().from(calls).limit(1);
            console.log('Calls table access successful. Row count:', callsList.length);
        } catch (e) {
            console.error('Error accessing calls table:', e);
        }

        // Check for update args: key=value
        const args = process.argv.slice(2);
        if (args.length > 0) {
            console.log('\n--- Processing Updates ---');
            for (const arg of args) {
                const [key, value] = arg.split('=');
                if (key && value) {
                    console.log(`Updating ${key}...`);
                    // Check if exists
                    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));
                    if (existing) {
                        await db.update(appSettings)
                            .set({ value: value, updatedAt: new Date() })
                            .where(eq(appSettings.key, key));
                        console.log(`✅ Updated ${key}`);
                    } else {
                        // naive insert with random UUID
                        const { v4: uuidv4 } = require('uuid');
                        await db.insert(appSettings).values({
                            id: uuidv4(),
                            key: key,
                            value: value,
                            description: 'Manually restored via script'
                        });
                        console.log(`✅ Created ${key}`);
                    }
                }
            }
            console.log('--- Updates Complete ---\n');

            // Re-fetch to show new state
            const newSettings = await db.select().from(appSettings);
            console.log(`Found ${newSettings.length} settings records.`);
            newSettings.forEach(s => {
                console.log(`${s.key}: ${JSON.stringify(s.value)}`);
            });
            process.exit(0);
        }

        settings.forEach(s => {
            console.log(`${s.key}: ${JSON.stringify(s.value)}`);
        });

        process.exit(0);
    } catch (e) {
        console.error('Error checking settings:', e);
        process.exit(1);
    }
}

checkSettings();
