/**
 * Post-call lead upsert — Switchboard Atlas step 5+6, 24-25 Aug 2026.
 *
 * Replaces the live pipeline's lead machinery (gpt-4o-mini metadata extraction, gpt-4o lead
 * scoring, fuzzy duplicate detection — all on the dead OpenAI account) with one Claude pass
 * over the CLEAN batch transcript after the call ends.
 *
 * Rules (owner-agreed):
 *   - Inbound customer calls only. Outbound calls and contractor/internal numbers never
 *     become leads.
 *   - One thread per number, forever: creating a lead NEVER creates a second thread — it
 *     looks the thread up by number and repoints conversations.leadId.
 *   - Match an existing lead by E.164 phone before creating, so a repeat caller attaches
 *     to their lead instead of spawning duplicates.
 *
 * Atlas step 6 addition: resolve client FIRST, then attach thread, then create/merge lead.
 * Client = the account. Repeat customer = 1 client, 1 thread, N leads, N properties.
 */
import { db } from "./db";
import { calls, leads, conversations, serviceClients } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { normalizePhoneNumber } from "./phone-utils";
import { claudeJson } from "./llm";

interface CallLeadExtract {
    customerName: string | null;
    address: string | null;
    postcode: string | null;
    jobDescription: string | null;
    /** 'Homeowner' | 'Landlord' | 'Business' | 'Property Manager' | 'Unknown' */
    leadType: string | null;
}

/**
 * Look up a service_client by phone number (digit-match).
 * Returns the client id or null if not found.
 */
async function resolveClientByPhone(e164: string): Promise<string | null> {
    const digits = e164.replace(/\D/g, '');
    if (digits.length < 7) return null;
    const [client] = await db.select({ id: serviceClients.id })
        .from(serviceClients)
        .where(sql`regexp_replace(${serviceClients.primaryPhone}, '[^0-9]', '', 'g') = ${digits}`)
        .limit(1);
    return client?.id ?? null;
}

export async function upsertLeadFromCall(callRecordId: string): Promise<void> {
    const [call] = await db.select().from(calls).where(eq(calls.id, callRecordId));
    if (!call) return;
    if ((call.direction ?? "").startsWith("out")) return;

    const transcript = (call.transcription ?? "").trim();
    if (transcript.length < 50) return;

    const e164 = normalizePhoneNumber(call.phoneNumber);
    if (!e164) return;

    // Customer lane only — same fork as the message webhooks.
    const { resolveInboundRole } = await import("./whatsapp-ingest");
    const role = await resolveInboundRole(call.phoneNumber);
    if (role !== "customer") {
        console.log(`[CallLead] ${callRecordId}: ${role} number, no lead`);
        return;
    }

    // Atlas step 6: resolve client FIRST by phone. Client = the account; a repeat caller belongs
    // to their existing client record. If no client exists, proceed without one — we don't auto-
    // create clients from calls (that's a manual CRM action).
    const clientId = call.clientId ?? await resolveClientByPhone(e164);

    let extract: CallLeadExtract;
    try {
        extract = await claudeJson<CallLeadExtract>({
            system: "You extract structured facts from a phone call transcript between a customer ([Caller]) and our handyman company ([Agent]). Return ONLY facts actually stated in the transcript — never guess or infer. Use null for anything not clearly stated.",
            user: `Extract from this transcript as JSON: {"customerName": first and/or last name the caller gives for themselves or null, "address": street address of the JOB if stated or null, "postcode": UK postcode if stated or null, "jobDescription": one plain sentence describing the work the caller wants or null, "leadType": one of "Homeowner"|"Landlord"|"Business"|"Property Manager"|"Unknown"}\n\nTranscript:\n${transcript.slice(0, 8000)}`,
        });
    } catch (e: any) {
        console.warn(`[CallLead] ${callRecordId}: extraction failed:`, e?.message ?? e);
        return;
    }

    // Patch the call row with anything we learned (never overwrite a real value with null).
    const callPatch: Record<string, any> = {};
    if (extract.customerName && !(call.customerName ?? "").trim()) callPatch.customerName = extract.customerName;
    if (extract.address && !call.address) callPatch.address = extract.address;
    if (extract.postcode && !call.postcode) callPatch.postcode = extract.postcode;
    if (extract.jobDescription && !call.jobSummary) callPatch.jobSummary = extract.jobDescription;
    if (clientId && !call.clientId) callPatch.clientId = clientId;

    // Find-or-create the lead by phone.
    let leadId = call.leadId ?? null;
    let created = false;
    if (!leadId) {
        const existing = await db.query.leads.findFirst({
            where: eq(leads.phone, e164),
            columns: { id: true },
        });
        if (existing) {
            leadId = existing.id;
        } else {
            leadId = uuidv4();
            await db.insert(leads).values({
                id: leadId,
                customerName: extract.customerName || call.customerName || "Voice caller",
                phone: e164,
                address: extract.address,
                postcode: extract.postcode,
                jobDescription: extract.jobDescription,
                leadType: extract.leadType && extract.leadType !== "Unknown" ? extract.leadType : null,
                status: "new",
                source: "voice_call",
                stage: "new",
                stageUpdatedAt: new Date(),
            } as any);
            created = true;
            console.log(`[CallLead] ${callRecordId}: created lead ${leadId} for ${e164}`);
        }
        callPatch.leadId = leadId;
    }

    if (Object.keys(callPatch).length) {
        await db.update(calls).set(callPatch).where(eq(calls.id, call.id));
    }

    // Repoint the thread (never create one here — the call ingest owns thread creation).
    // Atlas step 6: also attach clientId to the thread.
    const digits = e164.replace("+", "");
    const [conv] = await db.select({ id: conversations.id, leadId: conversations.leadId, clientId: conversations.clientId })
        .from(conversations)
        .where(eq(conversations.phoneNumber, `${digits}@c.us`))
        .limit(1);
    if (conv) {
        const convPatch: Record<string, any> = {};
        if (leadId && !conv.leadId) convPatch.leadId = leadId;
        if (clientId && !conv.clientId) convPatch.clientId = clientId;
        if (Object.keys(convPatch).length) {
            await db.update(conversations).set(convPatch).where(eq(conversations.id, conv.id));
        }
    }

    console.log(`[CallLead] ${callRecordId}: done (client ${clientId ?? "none"}, lead ${leadId ?? "none"}${created ? ", created" : ""})`);
}
