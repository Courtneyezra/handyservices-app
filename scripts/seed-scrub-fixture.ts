/**
 * Fill a throwaway database with rows shaped like real ones, so the scrub can be proved.
 *
 *   npx tsx scripts/seed-scrub-fixture.ts          # TARGET_URL names the throwaway
 *
 * This is how server/scrub is verified without ever touching a database that holds real people.
 * Every "real" value below is invented for the fixture, and every one is deliberately OUTSIDE the
 * reserved ranges the scrub writes into: a genuine-looking mobile rather than an Ofcom drama
 * number, a live e-mail domain rather than `.invalid`, a real Nottingham postcode. So a scrub
 * that misses one leaves it visible to the residual scan rather than hiding it.
 *
 * It refuses a production target for the same reason the scrub does, and it truncates the tables
 * it seeds, so point it only at a database you are willing to lose.
 */
import pg from 'pg';
import bcrypt from 'bcrypt';
import { isProductionDatabaseUrl, databaseHostOf } from '../server/worker-gate';

/** The throwaway administrator's password, so the login can be driven after the scrub. */
const ADMIN_PASSWORD = 'throwaway-test-password';

const REAL = {
    people: [
        { first: 'Margaret', last: 'Wilkinson', phone: '07812345678', email: 'm.wilkinson@gmail.com', postcode: 'NG7 2QX', address: '14 Beechdale Road, Aspley, NG8 3EY' },
        { first: 'Anthony', last: 'Radcliffe', phone: '+447934567123', email: 'tony.radcliffe@btinternet.com', postcode: 'DE22 3HL', address: '7 Kedleston Old Road, Derby, DE22 1FP' },
        { first: 'Priya', last: 'Chandrasekhar', phone: '07700112233', email: 'priya.chandra@outlook.com', postcode: 'NG9 5FN', address: '221 Queens Road, Beeston, NG9 2FD' },
        { first: 'Desmond', last: 'Okonkwo', phone: '01159472811', email: 'd.okonkwo@hotmail.co.uk', postcode: 'NG3 6AA', address: '3 Porchester Road, Mapperley, NG3 6JJ' },
    ],
};

async function main() {
    const target = process.env.TARGET_URL;
    if (!target) {
        console.error('[fixture] TARGET_URL is not set; nothing to seed.');
        process.exit(2);
    }
    // This truncates tables. The one database it must never reach is production.
    if (isProductionDatabaseUrl(target)) {
        console.error('[fixture] refusing: the target is the production database'
            + ` (host ${databaseHostOf(target)}).`);
        process.exit(3);
    }
    const c = new pg.Client(target);
    await c.connect();
    const q = (sql: string, params: unknown[] = []) => c.query(sql, params);

    await q(`truncate users, leads, conversations, messages, calls, personalized_quotes, handyman_profiles,
             contractor_diary_items, invoices, contractor_jobs, message_drafts, comms_events, tenants,
             properties, service_clients, service_properties, sessions, kb_entries, app_settings,
             contractor_reviews, content_testimonials, v2_bookings, job_dispatches, agent_runs,
             first_contact_ack_log, push_subscriptions, partner_enquiries, disputes, quick_replies,
             productized_services, whatsapp_templates cascade`);

    // The administrator the pipeline logs in as: must survive the scrub.
    await q(`insert into users (id, email, first_name, last_name, phone, password, role)
             values ('u-admin', $1, 'Ben', 'Hardcastle', '07811223344', $2, 'admin')`,
        [process.env.PIPELINE_ADMIN_EMAIL ?? 'ben@handyservices.test',
            bcrypt.hashSync(ADMIN_PASSWORD, 10)]);

    for (let i = 0; i < REAL.people.length; i += 1) {
        const p = REAL.people[i];
        await q(`insert into users (id, email, first_name, last_name, phone, password, role)
                 values ($1, $2, $3, $4, $5, '$2b$10$zzzzzzzzzzzzzzzzzzzzzzRealCustomerHashXXXXXXXXXXXXXXXXXX', 'contractor')`,
            [`u-${i}`, p.email, p.first, p.last, p.phone]);

        await q(`insert into leads (id, customer_name, phone, email, postcode, address, address_raw, address_canonical,
                                    job_description, job_summary, eleven_labs_summary, transcript_json, coordinates,
                                    source, status, eleven_labs_recording_url, place_id)
                 values ($1,$2,$3,$4,$5,$6,$6,$6,$7,$8,$9,$10,$11,'whatsapp','new',$12,'ChIJreal123')`,
            [`lead-${i}`, `${p.first} ${p.last}`, p.phone, p.email, p.postcode, p.address,
                `${p.first} says the extractor fan at ${p.address} has packed in. Ring ${p.phone}.`,
                `Extractor fan replacement for ${p.first} ${p.last}, ${p.postcode}`,
                `Caller ${p.first} ${p.last} on ${p.phone} wants a quote at ${p.address}.`,
                JSON.stringify([{ role: 'caller', text: `Hi it's ${p.first} ${p.last} from ${p.address}, my number is ${p.phone}` },
                    { role: 'agent', text: `Thanks ${p.first}, I will email you at ${p.email}` }]),
                JSON.stringify({ lat: 52.9548, lng: -1.1581 }),
                `https://storage.example.com/recordings/${p.last.toLowerCase()}-call.mp3`]);

        await q(`insert into conversations (id, phone_number, contact_name, client_id, last_message_preview, notes, status, stage, tags, metadata)
                 values ($1,$2,$3,$4,$5,$6,'open','enquiry',$7,$8)`,
            [`conv-${i}`, p.phone, `${p.first} ${p.last}`, `phone:${p.phone}`,
                `Hi, it's ${p.first} at ${p.address} - when can you come?`,
                `Customer ${p.first} ${p.last}, mobile ${p.phone}, email ${p.email}`,
                ['repeat'],
                JSON.stringify({ customerName: `${p.first} ${p.last}`, phone: p.phone, postcode: p.postcode })]);

        for (let m = 0; m < 3; m += 1) {
            await q(`insert into messages (id, conversation_id, content, direction, channel, sender_name, media_url, media_type, twilio_sid, status, type)
                     values ($1,$2,$3,$4,'whatsapp',$5,$6,'image',$7,'delivered','text')`,
                [`msg-${i}-${m}`, `conv-${i}`,
                    m === 0 ? `Hello, I'm ${p.first} ${p.last} at ${p.address}. My mobile is ${p.phone}.`
                        : m === 1 ? `Thanks ${p.first}, I'll send the quote to ${p.email} today.`
                            : `That's great. The postcode is ${p.postcode} if you need it for parking.`,
                    m === 1 ? 'outbound' : 'inbound',
                    m === 1 ? 'Ben Hardcastle' : `${p.first} ${p.last}`,
                    `https://media.twilio.com/${p.last}-${m}.jpg`,
                    `SM${'0'.repeat(20)}${i}${m}`]);
        }

        await q(`insert into calls (id, phone_number, customer_name, email, address, postcode, transcription,
                                    job_summary, notes, recording_url, inbound_recording_url, local_recording_path,
                                    metadata_json, live_analysis_json, direction, status, call_id, eleven_labs_conversation_id)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,'inbound','completed',$14,$15)`,
            [`call-${i}`, p.phone, `${p.first} ${p.last}`, p.email, p.address, p.postcode,
                `Agent: Good morning, Handy Services.\nCaller: Hi, it's ${p.first} ${p.last} from ${p.address}.\nAgent: Can I take a number?\nCaller: ${p.phone}.`,
                `${p.first} wants the fan doing at ${p.postcode}`,
                `Rang back on ${p.phone}, no answer`,
                `https://api.twilio.com/recordings/${p.last}.wav`,
                `/var/recordings/${p.last.toLowerCase()}.wav`,
                JSON.stringify({ caller: `${p.first} ${p.last}`, from: p.phone, notes: `lives at ${p.address}` }),
                JSON.stringify({ summary: `Call with ${p.first} ${p.last} about ${p.address}`, sentiment: 'positive' }),
                `CA${'f'.repeat(30)}${i}`, `elc_${p.last.toLowerCase()}_001`]);

        await q(`insert into personalized_quotes (id, customer_name, phone, email, address, postcode, job_description,
                                                  proposal_summary, additional_notes, job_top_line, jobs, pricing_line_items,
                                                  customer_photo_urls, coordinates, created_by_name, short_slug,
                                                  stripe_payment_intent_id, stripe_customer_id, quote_assumptions)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Ben Hardcastle',$15,$16,$17,$18)`,
            [`quote-${i}`, `${p.first} ${p.last}`, p.phone, p.email, p.address, p.postcode,
                `Replace extractor fan at ${p.address} for ${p.first} ${p.last}`,
                `We will attend ${p.address} and replace the unit. Contact ${p.first} on ${p.phone}.`,
                `${p.first} prefers afternoons. Email ${p.email}.`,
                `Extractor fan for ${p.first}`,
                JSON.stringify([{ title: 'Extractor fan', description: `Fit new fan at ${p.address}`, customerName: `${p.first} ${p.last}` }]),
                JSON.stringify([{ label: 'Labour', amount: 12000, note: `for ${p.first} ${p.last}` }]),
                JSON.stringify([`https://uploads.example.com/${p.last}/photo1.jpg`, `https://uploads.example.com/${p.last}/photo2.jpg`]),
                JSON.stringify({ lat: 52.9231, lng: -1.4761 }),
                `q${i}abc`, `pi_realPaymentIntent${i}`, `cus_realCustomer${i}`,
                JSON.stringify({ access: `Side gate at ${p.address}, code 4417` })]);

        await q(`insert into contractor_diary_items (id, contractor_id, customer_name, customer_phone, address, postcode, notes, kind, status, start_time, date)
                 values ($1,'u-admin',$2,$3,$4,$5,$6,'job','booked','09:00', current_date)`,
            [`diary-${i}`, `${p.first} ${p.last}`, p.phone, p.address, p.postcode, `Park on ${p.address}, ring ${p.phone} on arrival`]);

        await q(`insert into message_drafts (id, conversation_id, phone, body, original_body, status, channel, source)
                 values ($1,$2,$3,$4,$5,'pending','whatsapp','agent')`,
            [`draft-${i}`, `conv-${i}`, p.phone,
                `Hi ${p.first}, we can be at ${p.address} on Thursday. Ben.`,
                `Hi ${p.first}, we can be at ${p.address} on Thursday.`]);

        await q(`insert into comms_events (id, conversation_id, phone, body, actor, event_type, meta, occurred_at, channel, ref_table, ref_id)
                 values ($1,$2,$3,$4,'human:u-admin','send',$5, now(), 'whatsapp', 'messages', $6)`,
            [`ce-${i}`, `conv-${i}`, p.phone, `Sent to ${p.first} ${p.last} on ${p.phone}`,
                JSON.stringify({ to: p.phone, name: `${p.first} ${p.last}`, email: p.email }),
                `msg-${i}-0`]);

        await q(`insert into invoices (id, customer_name, customer_email, customer_phone, customer_address,
                                       customer_notes, notes, line_items, invoice_number, stripe_payment_intent_id,
                                       status, total_amount, balance_due)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sent',14000,14000)`,
            [`inv-${i}`, `${p.first} ${p.last}`, p.email, p.phone, p.address,
                `Invoice for ${p.first} at ${p.address}`, `Chase ${p.phone} if unpaid`,
                JSON.stringify([{ description: `Fan replacement for ${p.first} ${p.last}`, amount: 14000 }]),
                `INV-100${i}`, `pi_invoiceIntent${i}`]);

        await q(`insert into contractor_reviews (id, contractor_id, customer_name, customer_email, review_text, review_token, overall_rating)
                 values ($1,'u-admin',$2,$3,$4,$5,5)`,
            [`rev-${i}`, `${p.first} ${p.last}`, p.email,
                `${p.first} here - brilliant job at ${p.address}, would use again.`, `revtok_${p.last}_${i}`]);

        await q(`insert into v2_bookings (id, customer_first_name, customer_last_name, customer_email, customer_phone,
                                           address_line_1, address_line_2, town, postcode, notes, reference, services, status, slot_date, slot_label, subtotal, total)
                 values ($1,$2,$3,$4,$5,$6,'Aspley','Nottingham',$7,$8,$9,$10,'confirmed','2026-09-20','Morning',12000,14400)`,
            [`bk-${i}`, p.first, p.last, p.email, p.phone, p.address.split(',')[0], p.postcode,
                `${p.first} will be in from 2pm, mobile ${p.phone}`, `REF-${i}`,
                JSON.stringify([{ name: 'Extractor fan', notes: `at ${p.address}` }])]);
    }

    // Rows without a person on them, to prove the scrub leaves catalogue content alone.
    await q(`insert into productized_services (id, sku_code, name, description, keywords, price_pence, time_estimate_minutes, category)
             values ('sku-1','FAN-01','Extractor fan replacement','Remove the old unit and fit a new one.', array['fan','extractor'], 12000, 90, 'electrical')`);
    await q(`insert into whatsapp_templates (content_sid, name, body, category, language, status)
             values ('HXrealContentSid001','post_call_followup','Thanks for your call. Reply YES to book.','UTILITY','en_GB','approved')`);
    await q(`insert into quick_replies (id, label, body, category)
             values ('qr-1','On the way','We are on our way, about 20 minutes.','dispatch')`);
    await q(`insert into kb_entries (id, kind, topic, approved_words, ben_note, source_note, status, reviewed_by, reviewed_at)
             values ('kb-1','answer','vat','We are not VAT registered.','Ben confirmed this','Ben confirmed 3 Sep','reviewed','u-admin', now())`);
    await q(`insert into app_settings (id, key, value, description)
             values ('as-1','spine', '{"desk":"v4","senders":{"comms_v2":{"enabled":false}}}', 'comms desk switches')`);

    // A live session and a push subscription: bearer credentials for a real person.
    await q(`insert into sessions (sid, sess, expire)
             values ('realSessionCookie12345', '{"cookie":{"originalMaxAge":86400000},"userId":"u-0","email":"m.wilkinson@gmail.com"}', now() + interval '1 day')`);
    await q(`insert into push_subscriptions (user_id, endpoint, p256dh, auth, role)
             values ('u-0','https://fcm.googleapis.com/fcm/send/realEndpointToken','realP256dhKey','realAuthKey','admin')`);

    await q(`insert into content_testimonials (author, location, text, source)
             values ('Margaret Wilkinson','Aspley, Nottingham','Margaret here - they fixed my fan same day.','google')`);

    await q(`insert into handyman_profiles (id, user_id, business_name, bio, address, city, postcode, whatsapp_number,
                                             latitude, longitude, slug, stripe_account_id, app_token, access_code,
                                             profile_image_url, dbs_certificate_url, social_links, reviews)
             values ('hp-1','u-1','Radcliffe & Sons Handyman','Anthony Radcliffe has been fixing homes in Derby for 20 years.',
                     '7 Kedleston Old Road, Derby','Derby','DE22 1FP','+447934567123', 52.9225, -1.4746,
                     'anthony-radcliffe','acct_realStripeAccount','apptok_realToken','4417',
                     'https://cdn.example.com/anthony-radcliffe.jpg','https://cdn.example.com/dbs/radcliffe.pdf',
                     '{"facebook":"https://facebook.com/anthony.radcliffe"}',
                     '[{"author":"Margaret Wilkinson","text":"Anthony was excellent at 14 Beechdale Road."}]')`);

    const counts = await q(`select
        (select count(*) from users) users,
        (select count(*) from leads) leads,
        (select count(*) from messages) messages,
        (select count(*) from calls) calls,
        (select count(*) from personalized_quotes) quotes`);
    console.log('seeded:', JSON.stringify(counts.rows[0]));
    await c.end();
}

main().catch((e) => { console.error('SEED FAILED', e.message); process.exit(1); });
