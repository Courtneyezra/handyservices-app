/**
 * Seed Availability Slots
 *
 * Creates test availability slots for the next 14 days.
 * Mix of morning (09:00-12:00), afternoon (13:00-17:00), and full_day slots.
 *
 * Usage: npx tsx scripts/seed-availability-slots.ts
 */

import { db } from "../server/db";
import { availabilitySlots } from "../shared/schema";
import { v4 as uuidv4 } from "uuid";

async function seedAvailabilitySlots() {
    console.log("Seeding availability slots for the next 14 days...");

    const slots: Array<{
        id: string;
        date: string;
        startTime: string;
        endTime: string;
        slotType: string;
        isBooked: boolean;
        bookedByLeadId: null;
    }> = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Slot configurations
    const slotConfigs = {
        morning: { startTime: "09:00", endTime: "12:00" },
        afternoon: { startTime: "13:00", endTime: "17:00" },
        full_day: { startTime: "09:00", endTime: "17:00" },
    };

    // Generate slots for 14 days
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
        const date = new Date(today);
        date.setDate(date.getDate() + dayOffset);

        // Skip Sundays (day 0)
        if (date.getDay() === 0) {
            continue;
        }

        const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD

        // Saturdays: only morning slots
        if (date.getDay() === 6) {
            slots.push({
                id: uuidv4(),
                date: dateStr,
                startTime: slotConfigs.morning.startTime,
                endTime: slotConfigs.morning.endTime,
                slotType: "morning",
                isBooked: false,
                bookedByLeadId: null,
            });
            continue;
        }

        // Weekdays: alternate between morning+afternoon and full_day slots
        // Use day of month to create variety
        const dayOfMonth = date.getDate();

        if (dayOfMonth % 3 === 0) {
            // Every 3rd day: full_day slot only
            slots.push({
                id: uuidv4(),
                date: dateStr,
                startTime: slotConfigs.full_day.startTime,
                endTime: slotConfigs.full_day.endTime,
                slotType: "full_day",
                isBooked: false,
                bookedByLeadId: null,
            });
        } else if (dayOfMonth % 3 === 1) {
            // Morning only
            slots.push({
                id: uuidv4(),
                date: dateStr,
                startTime: slotConfigs.morning.startTime,
                endTime: slotConfigs.morning.endTime,
                slotType: "morning",
                isBooked: false,
                bookedByLeadId: null,
            });
        } else {
            // Both morning and afternoon slots
            slots.push({
                id: uuidv4(),
                date: dateStr,
                startTime: slotConfigs.morning.startTime,
                endTime: slotConfigs.morning.endTime,
                slotType: "morning",
                isBooked: false,
                bookedByLeadId: null,
            });
            slots.push({
                id: uuidv4(),
                date: dateStr,
                startTime: slotConfigs.afternoon.startTime,
                endTime: slotConfigs.afternoon.endTime,
                slotType: "afternoon",
                isBooked: false,
                bookedByLeadId: null,
            });
        }
    }

    console.log(`Generated ${slots.length} slots to insert.`);

    // Insert slots in batches
    if (slots.length > 0) {
        await db.insert(availabilitySlots).values(slots);
        console.log(`Successfully inserted ${slots.length} availability slots.`);
    }

    // Print summary
    const morningCount = slots.filter((s) => s.slotType === "morning").length;
    const afternoonCount = slots.filter((s) => s.slotType === "afternoon").length;
    const fullDayCount = slots.filter((s) => s.slotType === "full_day").length;

    console.log("\nSlot breakdown:");
    console.log(`  - Morning slots: ${morningCount}`);
    console.log(`  - Afternoon slots: ${afternoonCount}`);
    console.log(`  - Full day slots: ${fullDayCount}`);

    // Print sample of created slots
    console.log("\nSample slots created:");
    slots.slice(0, 5).forEach((slot) => {
        console.log(
            `  ${slot.date}: ${slot.startTime}-${slot.endTime} (${slot.slotType})`
        );
    });
    if (slots.length > 5) {
        console.log(`  ... and ${slots.length - 5} more`);
    }

    process.exit(0);
}

seedAvailabilitySlots().catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
});
