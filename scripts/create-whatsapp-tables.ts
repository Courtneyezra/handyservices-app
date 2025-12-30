
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
    console.log("Creating WhatsApp tables...");
    try {
        // Create Conversations Table
        await sql`
        CREATE TABLE IF NOT EXISTS "conversations" (
            "id" varchar PRIMARY KEY NOT NULL,
            "phone_number" varchar NOT NULL UNIQUE,
            "contact_name" varchar,
            "lead_id" varchar,
            "status" varchar(20) DEFAULT 'active' NOT NULL,
            "unread_count" integer DEFAULT 0,
            "last_message_at" timestamp DEFAULT now(),
            "last_message_preview" text,
            "tags" text[],
            "notes" text,
            "created_at" timestamp DEFAULT now(),
            "updated_at" timestamp DEFAULT now()
        );
        `;
        console.log("Created conversations table");

        // Create Messages Table
        await sql`
        CREATE TABLE IF NOT EXISTS "messages" (
            "id" varchar PRIMARY KEY NOT NULL,
            "conversation_id" varchar NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
            "direction" varchar(10) NOT NULL,
            "content" text,
            "type" varchar(20) DEFAULT 'text',
            "media_url" text,
            "media_type" varchar,
            "status" varchar(20) DEFAULT 'sent',
            "error_code" varchar,
            "error_message" text,
            "sender_name" varchar,
            "twilio_sid" varchar UNIQUE,
            "created_at" timestamp DEFAULT now()
        );
        `;
        console.log("Created messages table");

        // Indexes
        await sql`CREATE INDEX IF NOT EXISTS "idx_conversations_phone" ON "conversations" ("phone_number")`;
        await sql`CREATE INDEX IF NOT EXISTS "idx_conversations_last_message" ON "conversations" ("last_message_at")`;
        await sql`CREATE INDEX IF NOT EXISTS "idx_messages_conversation" ON "messages" ("conversation_id")`;
        await sql`CREATE INDEX IF NOT EXISTS "idx_messages_created" ON "messages" ("created_at")`;
        console.log("Created indexes");

        console.log("WhatsApp tables setup complete.");
    } catch (error) {
        console.error("Error creating tables:", error);
    }
}

main();
