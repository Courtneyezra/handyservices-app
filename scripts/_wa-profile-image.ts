/**
 * Crops a source photo to a square WhatsApp profile picture.
 *
 * WhatsApp renders the profile picture as a CIRCLE, and in a chat list it is roughly 40px across.
 * A naive centre crop of a landscape photo where the subject sits right of centre would slice
 * straight between the two faces, so the crop is weighted horizontally instead.
 *
 *   npx tsx scripts/_wa-profile-image.ts <source> [--focus 0.62] [--size 640] [--out <path>]
 *
 * --focus is the horizontal centre of the crop as a fraction of image width:
 *     0.5  = dead centre
 *     0.62 = right of centre (default) — keeps the tradesman AND some van lettering
 *     0.75 = tight on the tradesman
 *
 * Writes a JPEG (Meta accepts JPEG/PNG) and prints a circle-safety check.
 */
import sharp from 'sharp';
import path from 'path';

async function main() {
    const args = process.argv.slice(2);
    const source = args[0];
    if (!source) {
        console.error('Usage: npx tsx scripts/_wa-profile-image.ts <source> [--focus 0.62] [--size 640] [--out <path>]');
        process.exit(1);
    }

    const getArg = (flag: string, fallback: string) => {
        const i = args.indexOf(flag);
        return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
    };

    const focus = Math.min(Math.max(Number(getArg('--focus', '0.62')), 0), 1);
    const size = Number(getArg('--size', '640'));
    const out = getArg('--out', path.join('client', 'public', 'assets', 'whatsapp-profile.jpg'));

    const img = sharp(source);
    const meta = await img.metadata();
    const W = meta.width!;
    const H = meta.height!;
    console.log(`source : ${source}  ${W}x${H}`);

    // Square side = the shorter dimension, so nothing is upscaled.
    const side = Math.min(W, H);

    // Place the crop window around the focus point, clamped inside the frame.
    let left = Math.round(W * focus - side / 2);
    left = Math.max(0, Math.min(left, W - side));
    const top = Math.max(0, Math.min(Math.round((H - side) / 2), H - side));

    console.log(`crop   : ${side}x${side} at (${left},${top})  focus=${focus}`);

    await img
        .extract({ left, top, width: side, height: side })
        .resize(size, size, { fit: 'cover' })
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(out);

    const written = await sharp(out).metadata();
    const stat = await import('fs').then((fs) => fs.promises.stat(out));
    console.log(`output : ${out}  ${written.width}x${written.height}  ${(stat.size / 1024).toFixed(0)}KB`);

    // Meta rejects anything under 192px; the circle mask also eats the corners, so warn about
    // how much of the square actually survives.
    if ((written.width ?? 0) < 192) console.warn('WARNING: below Meta minimum of 192x192');
    if (stat.size > 5 * 1024 * 1024) console.warn('WARNING: over 5MB');
    console.log(
        '\nNote: WhatsApp masks this to a circle — roughly 21% of the square (the corners) is\n' +
        'never visible. Keep the face inside the middle ~80%.'
    );
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
