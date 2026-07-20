import { useEffect } from "react";

/**
 * Wistia embed helpers for customer-supplied problem videos.
 *
 * Two modes:
 *  - <WistiaPopover mediaId="abc123">{trigger}</WistiaPopover>
 *      wraps your own thumbnail/card; clicking opens the video in a lightbox.
 *      Best for the pain-points grid — keeps our card design, Wistia plays on tap.
 *  - <WistiaInline mediaId="abc123" /> renders the player inline (16:9), for a
 *      dedicated feature slot.
 *
 * The Wistia runtime (E-v1.js) is injected once, lazily, and shared. Nothing
 * loads until a Wistia component actually mounts, so the landing page stays fast.
 *
 * To wire a real video: upload to Wistia, copy the media's hashed ID (the code
 * in the embed URL, e.g. fast.wistia.com/embed/medias/<THIS>.jsonp) and pass it
 * as `mediaId`. A fake/empty id renders the fallback (children / poster) only.
 */

let wistiaLoading = false;
function ensureWistiaScript() {
  if (wistiaLoading || typeof document === "undefined") return;
  if (document.querySelector('script[data-wistia="e-v1"]')) { wistiaLoading = true; return; }
  const s = document.createElement("script");
  s.src = "https://fast.wistia.com/assets/external/E-v1.js";
  s.async = true;
  s.dataset.wistia = "e-v1";
  document.head.appendChild(s);
  wistiaLoading = true;
}

const isRealId = (id?: string) => !!id && !/^(placeholder|todo|xxxx)/i.test(id);

/** Click-to-play popover: your children are the trigger (e.g. a thumbnail card). */
export function WistiaPopover({ mediaId, children, className }: { mediaId?: string; children: React.ReactNode; className?: string }) {
  useEffect(() => { if (isRealId(mediaId)) ensureWistiaScript(); }, [mediaId]);
  if (!isRealId(mediaId)) return <>{children}</>;
  return (
    <span
      className={`wistia_embed wistia_async_${mediaId} popover=true popoverContent=html popoverAnimateThumbnail=true ${className ?? ""}`}
      style={{ display: "block", cursor: "pointer" }}
    >
      {children}
    </span>
  );
}

/** Inline responsive 16:9 player. */
export function WistiaInline({ mediaId, className }: { mediaId?: string; className?: string }) {
  useEffect(() => { if (isRealId(mediaId)) ensureWistiaScript(); }, [mediaId]);
  if (!isRealId(mediaId)) return null;
  return (
    <div className={`wistia_responsive_padding ${className ?? ""}`} style={{ padding: "56.25% 0 0 0", position: "relative" }}>
      <div className="wistia_responsive_wrapper" style={{ height: "100%", left: 0, position: "absolute", top: 0, width: "100%" }}>
        <div className={`wistia_embed wistia_async_${mediaId} videoFoam=true`} style={{ height: "100%", width: "100%" }}>&nbsp;</div>
      </div>
    </div>
  );
}
