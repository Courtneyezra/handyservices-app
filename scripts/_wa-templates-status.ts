/**
 * Where every WhatsApp template stands with Meta.
 *
 * Twilio has no push webhook for template approval, so status is polled. This is the manual
 * check; server/whatsapp-template-sync.ts does the same poll on a schedule and notifies when
 * something flips to approved.
 *
 *   npx tsx scripts/_wa-templates-status.ts
 */
import 'dotenv/config';

const SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH = 'Basic ' + Buffer.from(`${SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

async function main() {
    const listRes = await fetch('https://content.twilio.com/v1/Content?PageSize=100', { headers: { Authorization: AUTH } });
    const contents: any[] = ((await listRes.json()) as any).contents ?? [];

    const rows = await Promise.all(contents.map(async (c) => {
        const r = await fetch(`https://content.twilio.com/v1/Content/${c.sid}/ApprovalRequests`, { headers: { Authorization: AUTH } });
        const w = ((await r.json()) as any).whatsapp ?? {};
        return {
            sid: c.sid,
            name: c.friendly_name,
            status: w.status ?? 'not submitted',
            category: w.category ?? '',
            reason: w.rejection_reason ?? '',
        };
    }));

    const order: Record<string, number> = { approved: 0, received: 1, pending: 1, rejected: 2, 'not submitted': 3 };
    rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));

    for (const r of rows) {
        const mark = r.status === 'approved' ? '✓' : r.status === 'rejected' ? '✗' : '·';
        console.log(`${mark} ${r.status.padEnd(13)} ${(r.category || '-').padEnd(9)} ${r.name.padEnd(26)} ${r.sid}${r.reason ? `  (${r.reason})` : ''}`);
    }
    const approved = rows.filter((r) => r.status === 'approved').length;
    console.log(`\n${approved} approved of ${rows.length}. Approved templates are usable outside the 24h window.`);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
