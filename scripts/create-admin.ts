
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

async function createAdmin() {
    const email = process.argv[2] || "admin@handyservices.com";
    const password = process.argv[3] || "admin123";

    console.log(`Creating admin user: ${email}`);

    // Check if exists
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
        console.log("User already exists. Updating password and role...");
        const hashedPassword = await bcrypt.hash(password, 12);
        await db.update(users)
            .set({
                password: hashedPassword,
                role: 'admin',
                isActive: true
            })
            .where(eq(users.id, existing[0].id));
        console.log("Admin updated.");
        process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await db.insert(users).values({
        id: uuidv4(),
        email: email,
        password: hashedPassword,
        role: 'admin',
        firstName: 'Admin',
        lastName: 'User',
        isActive: true,
        emailVerified: true
    });

    console.log("Admin user created successfully.");
    process.exit(0);
}

createAdmin().catch((err) => {
    console.error(err);
    process.exit(1);
});
