import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

/**
 * Click-to-play facade for a Wistia video.
 *
 * Renders a lightweight preview with a play-button overlay. The heavy Wistia
 * player JS (~1 MB: publicApi.js, hls_video.js, player.js, captions, fonts, HLS
 * segments) is NOT loaded until the visitor actually clicks play.
 *
 * The preview is EITHER a static poster image or — when `previewVideoUrl` is
 * supplied — a muted, looping, autoplaying clip so the thumbnail visibly MOVES,
 * which draws the eye and lifts play-through. The clip is a small (~300p) MP4 and
 * only starts loading once the box scrolls near the viewport, so a visitor who
 * never scrolls to it pays nothing. The full-res interactive player (sound +
 * controls) still only loads on click.
 *
 * Layout shift (CLS) is preserved at zero: the preview and the eventual player
 * both sit inside the same aspect-ratio box supplied by the parent wrapper, so
 * the swap never changes the box's dimensions.
 */
export const WistiaFacade = ({
  mediaId,
  aspect = '1.3333333333333333',
  posterUrl,
  previewVideoUrl,
}: {
  mediaId: string;
  /** Wistia aspect attribute (width / height). */
  aspect?: string;
  /** Optional explicit poster URL; falls back to Wistia's swatch thumbnail. */
  posterUrl?: string;
  /** Optional muted/looping clip shown (and autoplayed) in place of the static
   *  poster, to make the thumbnail move and encourage plays. */
  previewVideoUrl?: string;
}) => {
  const [activated, setActivated] = useState(false);
  // Gate the preview clip on viewport entry so we never pull the MP4 for a
  // visitor who doesn't scroll down to it.
  const [previewInView, setPreviewInView] = useState(false);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reliable Wistia thumbnail. The `swatch` endpoint always resolves for a
  // public media; `posterUrl` lets callers pass the exact high-res still.
  const poster = posterUrl ?? `https://fast.wistia.com/embed/medias/${mediaId}/swatch`;

  // Lazy-load the moving preview only as it nears the viewport.
  useEffect(() => {
    if (!previewVideoUrl || activated) return;
    const el = wrapRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setPreviewInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPreviewInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [previewVideoUrl, activated]);

  // Start the moving preview once it scrolls into view. Two gotchas handled:
  //  1) Setting `src` via React state can leave the element stuck — it never
  //     fetches (networkState=LOADING, nothing buffered) — so we call load() to
  //     force the fetch.
  //  2) Calling play() *immediately* after load() aborts (AbortError): load()
  //     asynchronously resets the element, so the play is cancelled and the clip
  //     stays paused. So we start playback on the first `canplay` instead.
  // We also force `muted` (React doesn't always reflect it to the DOM property,
  // which autoplay policies require for a muted autoplay).
  useEffect(() => {
    const v = videoRef.current;
    if (!previewInView || !v) return;
    v.muted = true;
    const play = () => { v.play().catch(() => {}); };
    v.addEventListener('canplay', play, { once: true });
    v.load();
    return () => v.removeEventListener('canplay', play);
  }, [previewInView]);

  const activate = () => {
    if (activated) return;
    setActivated(true);
    // Inject the Wistia loader scripts on demand (same pair the page used
    // before, just gated behind the click instead of an IntersectionObserver).
    if (!document.querySelector('script[src*="wistia.com/player.js"]')) {
      const script1 = document.createElement('script');
      script1.src = 'https://fast.wistia.com/player.js';
      script1.async = true;
      document.body.appendChild(script1);
    }
    if (!document.querySelector(`script[src*="wistia.com/embed/${mediaId}.js"]`)) {
      const script2 = document.createElement('script');
      script2.src = `https://fast.wistia.com/embed/${mediaId}.js`;
      script2.async = true;
      script2.type = 'module';
      document.body.appendChild(script2);
    }
  };

  if (activated) {
    return (
      <>
        {/* Blurred swatch placeholder while the player web component upgrades —
            keeps the box filled with no flash of empty space, no reflow. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `wistia-player[media-id='${mediaId}']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/${mediaId}/swatch'); display: block; filter: blur(5px); padding-top:75.0%; }`,
          }}
        />
        {/* @ts-ignore — Wistia custom element */}
        <wistia-player media-id={mediaId} aspect={aspect} autoplay="true"></wistia-player>
      </>
    );
  }

  return (
    <button
      ref={wrapRef}
      type="button"
      onClick={activate}
      aria-label="Play video"
      className="group absolute inset-0 h-full w-full cursor-pointer overflow-hidden"
      data-testid="wistia-facade-play"
    >
      {/* Preview: a muted looping clip when provided (moving thumbnail), else the
          static poster. Both use object-cover so a 4:3 still/clip fills the 16:9
          box with no bars and no intrinsic-size dependency that could shift
          layout. The poster doubles as the <video>'s instant first paint. */}
      {previewVideoUrl ? (
        <video
          ref={videoRef}
          src={previewInView ? previewVideoUrl : undefined}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay
          preload={previewInView ? 'auto' : 'none'}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <img
          src={poster}
          alt="Watch our customer story"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      )}
      {/* Subtle scrim for contrast behind the play button. */}
      <div className="absolute inset-0 bg-slate-900/25 transition-colors duration-200 group-hover:bg-slate-900/15" />
      {/* Play button overlay. */}
      <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-xl ring-1 ring-black/5 transition-transform duration-200 group-hover:scale-110 md:h-20 md:w-20">
        <Play className="ml-1 h-7 w-7 fill-[#1D2D3D] text-[#1D2D3D] md:h-9 md:w-9" />
      </span>
    </button>
  );
};
