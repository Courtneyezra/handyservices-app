/**
 * Quote image URL normalization.
 *
 * Legacy quotes (and the content-library DB rows they reference) store
 * uncompressed local image URLs like `/assets/quote-images/door-greeting.jpg`
 * (489 KB) even though optimized `.webp` twins already ship in
 * `client/public/assets/quote-images/`. This helper rewrites those local URLs
 * to their `.webp` twin at read time so no data migration is required.
 *
 * IMPORTANT — only the known set whose `.webp` twin is confirmed present on
 * disk is rewritten. Anything else (unknown local names, AWS S3 content-library
 * URLs, absolute http(s) URLs, data URIs) is returned untouched.
 */

/**
 * Base names (without extension) under `/assets/quote-images/` that have a
 * confirmed `.webp` twin in `client/public/assets/quote-images/`.
 */
const WEBP_TWIN_BASENAMES = new Set<string>([
  'door-greeting',
  'plumber-smile',
  'painting',
  'bathroom-repair',
  'tap-repair',
  'older-person-door',
  'ben-estimator',
]);

const QUOTE_IMAGE_DIR = '/assets/quote-images/';

/**
 * Rewrite a single image URL to its `.webp` twin when it is a local
 * `/assets/quote-images/NAME.(jpg|jpeg|png)` reference whose twin exists.
 * Returns the original value unchanged for anything else (S3 URLs, unknown
 * names, already-webp, non-strings).
 */
export function normalizeQuoteImageUrl<T>(url: T): T {
  if (typeof url !== 'string') return url;

  // Only touch our local quote-images directory; never S3/absolute/data URLs.
  const dirIdx = url.indexOf(QUOTE_IMAGE_DIR);
  if (dirIdx === -1) return url;
  // Guard against absolute URLs that merely contain the path as a substring
  // (e.g. an S3 URL would not start the path at the host root). Accept only
  // root-relative ("/assets/...") or values where the dir is at the start.
  if (dirIdx !== 0) return url;

  const match = url.match(/^\/assets\/quote-images\/([^/?#]+?)\.(jpe?g|png)(\?[^#]*)?(#.*)?$/i);
  if (!match) return url;

  const [, basename, , query, hash] = match;
  if (!WEBP_TWIN_BASENAMES.has(basename.toLowerCase())) return url;

  const rebuilt = `${QUOTE_IMAGE_DIR}${basename}.webp${query ?? ''}${hash ?? ''}`;
  return rebuilt as unknown as T;
}

/**
 * Normalize the `images` array (and any other URL-bearing field) on a quote's
 * `selectedContent`-shaped object. Defensive against:
 *   - `images` as `string[]`
 *   - `images` as `{ url: string, ... }[]`
 *   - a top-level `heroImage` / `image` string field
 * Returns a shallow-cloned object; never mutates the input. Non-object input is
 * returned as-is.
 */
export function normalizeQuoteImageUrls<T>(content: T): T {
  if (!content || typeof content !== 'object') return content;

  const src = content as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  // images: array of strings OR array of { url } objects
  if (Array.isArray(src.images)) {
    out.images = src.images.map((img) => {
      if (typeof img === 'string') return normalizeQuoteImageUrl(img);
      if (img && typeof img === 'object' && 'url' in (img as Record<string, unknown>)) {
        const obj = img as Record<string, unknown>;
        return { ...obj, url: normalizeQuoteImageUrl(obj.url) };
      }
      return img;
    });
  }

  // Common single-image string fields some payloads carry.
  for (const key of ['heroImage', 'image', 'imageUrl', 'heroImageUrl'] as const) {
    if (typeof src[key] === 'string') {
      out[key] = normalizeQuoteImageUrl(src[key]);
    }
  }

  return out as unknown as T;
}
