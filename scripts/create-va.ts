
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

async function createVA() {
    const email = process.argv[2] || "va@handyservices.com";
    const password = process.argv[3] || "changeme123";
    const firstName = process.argv[4] || "VA";
    const lastName = process.argv[5] || "";

    console.log(`Creating VA user: ${email} (${firstName} ${lastName})`);

    // Check if exists
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
        console.log("User already exists. Updating password and role...");
        const hashedPassword = await bcrypt.hash(password, 12);
        await db.update(users)
            .set({
                password: hashedPassword,
                role: 'va',
                firstName,
                lastName,
                isActive: true,
            })
            .where(eq(users.id, existing[0].id));
        console.log("VA user updated.");
        process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await db.insert(users).values({
        id: uuidv4(),
        email,
        password: hashedPassword,
        role: 'va',
        firstName,
        lastName,
        isActive: true,
        emailVerified: true,
    });

    console.log(`VA user '${firstName}' created successfully.`);
    console.log(`Login at: /admin/login with email: ${email}`);
    process.exit(0);
}

createVA().catch((err) => {
    console.error(err);
    process.exit(1);
});
