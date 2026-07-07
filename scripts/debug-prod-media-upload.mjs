/**
 * Debug helper: POST a tiny test image to prod's /api/admin/dispatch/:id/media
 * and inspect the response. Tells us whether the S3 fix is actually live.
 */
const PROD = 'https://www.handyservices.app';
const TOKEN = 'Mbi2TQMql7DP1QuyYeKoQH5EOJg';

// 1. Find the dispatch ID via the public link
const r0 = await fetch(`${PROD}/api/dispatch-link/${TOKEN}`);
const j0 = await r0.json();
const dispatchId = j0?.dispatch?.id;
console.log('Dispatch:', dispatchId, 'status:', j0?.dispatch?.status);
console.log('Task count:', j0?.dispatch?.tasks?.length, '| Top-level mediaUrls:', (j0?.dispatch?.mediaUrls || []).length);

if (!dispatchId) { console.log('No dispatch ID — abort'); process.exit(1); }

// 2. POST a tiny 1×1 red JPEG data URL
const tinyJpeg = '/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBxdWFsaXR5ID0gOTAK/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A/wA/ev8AP3r/2Q==';
const dataUrl = `data:image/jpeg;base64,${tinyJpeg}`;

console.log('\nPOST', `${PROD}/api/admin/dispatch/${dispatchId}/media`);
const r = await fetch(`${PROD}/api/admin/dispatch/${dispatchId}/media`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dispatchPhotos: [dataUrl] }),
});
console.log('Status:', r.status, r.statusText);
const text = await r.text();
console.log('Body (first 600 chars):', text.slice(0, 600));

// 3. If we got URLs back, try to fetch them publicly
try {
  const j = JSON.parse(text);
  if (j.dispatchMediaUrls?.length) {
    const u = j.dispatchMediaUrls[j.dispatchMediaUrls.length - 1];
    console.log('\nProbing public URL:', u);
    const headRes = await fetch(u, { method: 'HEAD' });
    console.log(`HEAD ${u} → ${headRes.status} ${headRes.statusText}`);
    console.log('Content-Type:', headRes.headers.get('content-type'));
    console.log('Cache-Control:', headRes.headers.get('cache-control'));
  }
} catch {}
