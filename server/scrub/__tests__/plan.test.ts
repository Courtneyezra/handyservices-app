/**
 * The plan's job is to leave nothing undecided. These tests hold that line from both ends: the
 * columns that obviously carry a person must reach a treatment, and the ones that obviously do
 * not must reach 'keep' rather than being rewritten into nonsense.
 */
import { describe, it, expect } from 'vitest';
import { classify, TEXTUAL_TYPES, REGENERATING_TREATMENTS } from '../plan';
import { needsClassification, type ColumnInfo } from '../introspect';

const column = (over: Partial<ColumnInfo>): ColumnInfo => ({
    table: 't', column: 'c', dataType: 'text', elementType: null,
    isEnum: false, isPrimaryKey: false, isForeignKey: false, maxLength: null, ...over,
});

describe('columns that carry a person', () => {
    it.each([
        ['leads', 'customer_name', 'person_name'],
        ['conversations', 'contact_name', 'person_name'],
        ['messages', 'sender_name', 'person_name'],
        ['tenants', 'name', 'person_name'],
        ['users', 'first_name', 'first_name'],
        ['v2_bookings', 'customer_last_name', 'last_name'],
        ['leads', 'phone', 'phone'],
        ['conversations', 'phone_number', 'phone'],
        ['handyman_profiles', 'whatsapp_number', 'phone'],
        ['comms_opt_outs', 'e164', 'phone_e164'],
        ['agent_outcomes', 'phone_key', 'phone_key'],
        ['leads', 'email', 'email'],
        ['invoices', 'customer_email', 'email'],
        ['leads', 'postcode', 'postcode'],
        ['leads', 'address', 'address'],
        ['leads', 'address_raw', 'address'],
        ['invoices', 'customer_address', 'address'],
        ['v2_bookings', 'address_line_1', 'address_line'],
        ['v2_bookings', 'town', 'town'],
        ['handyman_profiles', 'city', 'town'],
        ['leads', 'coordinates', 'coords_json'],
        ['handyman_profiles', 'latitude', 'latitude'],
        ['messages', 'content', 'message_body'],
        ['message_drafts', 'body', 'message_body'],
        ['comms_events', 'body', 'message_body'],
        ['calls', 'transcription', 'transcript'],
        ['leads', 'transcript_json', 'transcript'],
        ['conversations', 'last_message_preview', 'preview'],
        ['leads', 'job_description', 'narrative'],
        ['calls', 'job_summary', 'narrative'],
        ['conversations', 'notes', 'note'],
        ['job_sheets', 'access_instructions', 'note'],
        ['calls', 'recording_url', 'url'],
        ['messages', 'media_url', 'url'],
        ['personalized_quotes', 'customer_photo_urls', 'url_list'],
        ['handyman_profiles', 'public_liability_insurance_url', 'url'],
        ['dispatch_completions', 'customer_signature_url', 'data_url'],
        ['users', 'password', 'password'],
        ['users', 'widget_token', 'token'],
        ['sessions', 'sess', 'session_blob'],
        ['handyman_profiles', 'stripe_account_id', 'external_id'],
        ['messages', 'twilio_sid', 'external_id'],
        ['calls', 'eleven_labs_conversation_id', 'external_id'],
    ])('%s.%s is treated as %s', (table, col, treatment) => {
        expect(classify(table, col)).toBe(treatment);
    });
});

describe('columns that carry no person', () => {
    it.each([
        // The catalogue and the site content are about the business.
        ['productized_services', 'name'],
        ['productized_services', 'description'],
        ['service_catalog', 'customer_description'],
        ['materials_catalog', 'supplier'],
        ['quick_replies', 'body'],
        // Meta fixes the wording of an approved template; rewriting it would break sending.
        ['whatsapp_templates', 'body'],
        // Ben's reviewed answers, which the comms-v2 scenarios read by exact wording.
        ['kb_entries', 'ben_note'],
        // Enumerations and identifiers.
        ['leads', 'status'],
        ['messages', 'direction'],
        ['personalized_quotes', 'segment'],
        ['conversations', 'lead_id'],
        ['invoices', 'quote_id'],
        ['agent_runs', 'run_id'],
    ])('%s.%s is kept', (table, col) => {
        expect(classify(table, col)).toBe('keep');
    });
});

describe('the fail-closed rule', () => {
    it('returns null for a column nothing in the plan covers, so the scrub refuses to run', () => {
        expect(classify('leads', 'some_column_added_next_week')).toBeNull();
    });

    it('an enum column needs no classification: it can only hold its declared labels', () => {
        expect(needsClassification(column({ dataType: 'USER-DEFINED', isEnum: true }))).toBe(false);
        expect(needsClassification(column({ dataType: 'USER-DEFINED', isEnum: false }))).toBe(true);
    });

    it('an array of text needs classifying; an array of numbers cannot hold a name', () => {
        expect(needsClassification(column({ dataType: 'ARRAY', elementType: 'text' }))).toBe(true);
        expect(needsClassification(column({ dataType: 'ARRAY', elementType: 'integer' }))).toBe(false);
    });

    it('covers every textual storage type', () => {
        for (const type of ['text', 'character varying', 'json', 'jsonb']) {
            expect(TEXTUAL_TYPES.has(type)).toBe(true);
            expect(needsClassification(column({ dataType: type }))).toBe(true);
        }
        expect(needsClassification(column({ dataType: 'integer' }))).toBe(false);
        expect(needsClassification(column({ dataType: 'timestamp without time zone' }))).toBe(false);
    });
});

describe('actor columns', () => {
    it.each(['by', 'actor', 'approved_by', 'decided_by', 'assigned_to', 'reviewed_by'])(
        '%s is decided per value, because it holds either a user id or a typed name',
        (col) => { expect(classify('agent_runs', col)).toBe('actor'); },
    );
});

describe('regenerating treatments', () => {
    it('replace the whole value, so the later sweep has nothing left to find there', () => {
        expect(REGENERATING_TREATMENTS.has('message_body')).toBe(true);
        expect(REGENERATING_TREATMENTS.has('person_name')).toBe(true);
        expect(REGENERATING_TREATMENTS.has('keep')).toBe(false);
        expect(REGENERATING_TREATMENTS.has('json_deep')).toBe(false);
        expect(REGENERATING_TREATMENTS.has('actor')).toBe(false);
    });
});
