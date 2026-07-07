async function main() {
  const BASE = process.env.BASE_URL || 'http://localhost:62502';
  const r = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Phase 12 Test',
      phone: '07700900111',
      email: 'phase12@test.com',
      address: '14 Lenton', postcode: 'NG7 2BY',
      coordinates: { lat: 52.9389, lng: -1.1789 },
      vaContext: 'Auto-assign test, no dates required.',
      lines: [
        { id: 'l1', description: 'Mount TV', category: 'tv_mounting', estimatedMinutes: 60, requiresMaterialCollection: false },
      ],
      signals: {},
      // No availableDates, no selectedContractor
      createdByName: 'Phase 12',
    }),
  });
  console.log('Status:', r.status);
  const j = await r.json();
  console.log('Quote:', j.shortSlug, '· £' + ((j.pricing?.totalPence || 0) / 100).toFixed(0));
  console.log('Candidate pool size:', j.candidatePoolSize ?? 'n/a in response');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
