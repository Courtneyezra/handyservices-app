/**
 * App-adoption audit — is the contractor app actually a shared view, or a view we imagine?
 *
 * The question this answers: when a contractor's availability changes, did the CONTRACTOR
 * tap it in /my-week, or did Ben key it in for them? `lastAvailabilityRefresh` can't tell
 * you — every write path stamps it (contractor app, admin editor, Ben's mobile tool), so
 * the timestamp measures "someone touched it", not "they opened the app".
 *
 * The real discriminator is the marker the app leaves on the row:
 *   contractor_availability_dates.notes = 'contractor-app'  → the contractor tapped it
 *   notes IS NULL                                           → an admin path wrote it
 *
 * KNOWN LIMITS (state them with the numbers, don't launder them):
 *  - "Off" days are asymmetric. The app INSERTS a row for off (is_available=false); the
 *    admin editor DELETES the row and inserts nothing. So admin-set "off" days leave no
 *    trace at all and are uncountable here. Every ratio below is therefore an UPPER bound
 *    on app share.
 *  - The weekly pattern (handyman_availability) carries no marker whatsoever. "Usual week"
 *    saves are unattributable in either direction.
 *  - No page-view tracking exists: GET /api/contractor-app/:token records nothing. We can
 *    only see writes, so a contractor who opens the app and changes nothing is invisible.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const DAYS_BACK = 70; // ten weeks — matches the framework's measurement window

async function main() {
    console.log(`\n=== APP-ADOPTION AUDIT — last ${DAYS_BACK} days ===\n`);

    // 1. Who has an app link at all, and how fresh is their availability?
    const profiles = await db.execute(sql`
        SELECT hp.id,
               COALESCE(NULLIF(TRIM(hp.business_name), ''),
                        TRIM(CONCAT(u.first_name, ' ', u.last_name)),
                        'unnamed')                    AS name,
               hp.delivery_tier                       AS tier,
               (hp.app_token IS NOT NULL)             AS has_app_link,
               (hp.access_code IS NOT NULL)           AS has_login_code,
               hp.last_availability_refresh           AS last_refresh
        FROM handyman_profiles hp
        LEFT JOIN users u ON u.id = hp.user_id
        ORDER BY hp.delivery_priority NULLS LAST, name
    `);

    console.log('--- Contractors, app links, availability freshness ---');
    console.table((profiles.rows as any[]).map((r) => ({
        name: r.name,
        tier: r.tier,
        appLink: r.has_app_link ? 'yes' : 'NO',
        loginCode: r.has_login_code ? 'yes' : 'NO',
        lastRefresh: r.last_refresh ? new Date(r.last_refresh).toISOString().slice(0, 10) : 'NEVER',
    })));

    // 2. The core number: availability day-writes by author, per contractor.
    const byAuthor = await db.execute(sql`
        SELECT COALESCE(NULLIF(TRIM(hp.business_name), ''),
                        TRIM(CONCAT(u.first_name, ' ', u.last_name)),
                        'unnamed')                                          AS name,
               COUNT(*)                                                     AS total_rows,
               COUNT(*) FILTER (WHERE cad.notes = 'contractor-app')         AS by_contractor,
               COUNT(*) FILTER (WHERE cad.notes IS DISTINCT FROM 'contractor-app') AS by_admin,
               MAX(cad.created_at) FILTER (WHERE cad.notes = 'contractor-app') AS last_app_write
        FROM contractor_availability_dates cad
        JOIN handyman_profiles hp ON hp.id = cad.contractor_id
        LEFT JOIN users u ON u.id = hp.user_id
        WHERE cad.created_at >= NOW() - (${DAYS_BACK} || ' days')::interval
        GROUP BY 1
        ORDER BY total_rows DESC
    `);

    console.log(`\n--- Availability day-writes by author (last ${DAYS_BACK}d) ---`);
    if ((byAuthor.rows as any[]).length === 0) {
        console.log('  (no availability rows written in the window at all)');
    } else {
        console.table((byAuthor.rows as any[]).map((r) => ({
            name: r.name,
            total: Number(r.total_rows),
            contractorTapped: Number(r.by_contractor),
            adminKeyed: Number(r.by_admin),
            appSharePct: Number(r.total_rows) > 0
                ? Math.round((Number(r.by_contractor) / Number(r.total_rows)) * 100) + '%'
                : '—',
            lastAppWrite: r.last_app_write ? new Date(r.last_app_write).toISOString().slice(0, 10) : 'NEVER',
        })));
    }

    // 3. Weekly trend — is app use growing, flat, or dead?
    const trend = await db.execute(sql`
        SELECT DATE_TRUNC('week', cad.created_at)::date                      AS week,
               COUNT(*) FILTER (WHERE cad.notes = 'contractor-app')          AS by_contractor,
               COUNT(*) FILTER (WHERE cad.notes IS DISTINCT FROM 'contractor-app') AS by_admin
        FROM contractor_availability_dates cad
        WHERE cad.created_at >= NOW() - (${DAYS_BACK} || ' days')::interval
        GROUP BY 1
        ORDER BY 1
    `);

    console.log(`\n--- Weekly trend ---`);
    if ((trend.rows as any[]).length === 0) {
        console.log('  (nothing in the window)');
    } else {
        console.table((trend.rows as any[]).map((r) => ({
            weekOf: new Date(r.week).toISOString().slice(0, 10),
            contractorTapped: Number(r.by_contractor),
            adminKeyed: Number(r.by_admin),
        })));
    }

    // 4. Headline totals.
    const totals = (byAuthor.rows as any[]).reduce(
        (acc, r) => ({
            contractor: acc.contractor + Number(r.by_contractor),
            admin: acc.admin + Number(r.by_admin),
        }),
        { contractor: 0, admin: 0 },
    );
    const grand = totals.contractor + totals.admin;
    console.log('\n=== HEADLINE ===');
    console.log(`Availability day-writes in ${DAYS_BACK}d: ${grand}`);
    console.log(`  contractor tapped it themselves : ${totals.contractor}` +
        (grand ? ` (${Math.round((totals.contractor / grand) * 100)}%)` : ''));
    console.log(`  admin keyed it in for them      : ${totals.admin}` +
        (grand ? ` (${Math.round((totals.admin / grand) * 100)}%)` : ''));
    console.log('\nUpper bound only — admin-set "off" days delete the row and leave no trace,');
    console.log('and weekly-pattern saves carry no author marker at all.\n');

    process.exit(0);
}

main().catch((e) => {
    console.error('audit failed:', e);
    process.exit(1);
});
