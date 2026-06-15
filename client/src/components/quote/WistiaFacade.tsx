import { useState } from 'react';
import { Play } from 'lucide-react';

/**
 * Click-to-play facade for a Wistia video.
 *
 * Renders a lightweight poster image with a play-button overlay. The heavy
 * Wistia player JS (~1 MB: publicApi.js, hls_video.js, player.js, captions,
 * fonts, HLS segments) is NOT loaded until the visitor actually clicks play.
 * Most visitors never play the video, so this saves ~1 MB on the common path.
 *
 * Layout shift (CLS) is preserved at zero: the poster and the eventual player
 * both sit inside the same aspect-ratio box supplied by the parent wrapper, so
 * the swap never changes the box's dimensions.
 */
export const WistiaFacade = ({
  mediaId,
  aspect = '1.3333333333333333',
  posterUrl,
}: {
  mediaId: string;
  /** Wistia aspect attribute (width / height). */
  aspect?: string;
  /** Optional explicit poster URL; falls back to Wistia's swatch thumbnail. */
  posterUrl?: string;
}) => {
  const [activated, setActivated] = useState(false);

  // Reliable Wistia thumbnail. The `swatch` endpoint always resolves for a
  // public media; `posterUrl` lets callers pass the exact high-res still.
  const poster = posterUrl ?? `https://fast.wistia.com/embed/medias/${mediaId}/swatch`;

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
      type="button"
      onClick={activate}
      aria-label="Play video"
      className="group absolute inset-0 h-full w-full cursor-pointer overflow-hidden"
      data-testid="wistia-facade-play"
    >
      {/* Poster: object-cover so a 4:3 still fills the 16:9 box with no bars,
          and no intrinsic-size dependency that could shift layout. */}
      <img
        src={poster}
        alt="Watch our customer story"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* Subtle scrim for contrast behind the play button. */}
      <div className="absolute inset-0 bg-slate-900/25 transition-colors duration-200 group-hover:bg-slate-900/15" />
      {/* Play button overlay. */}
      <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-xl ring-1 ring-black/5 transition-transform duration-200 group-hover:scale-110 md:h-20 md:w-20">
        <Play className="ml-1 h-7 w-7 fill-[#1D2D3D] text-[#1D2D3D] md:h-9 md:w-9" />
      </span>
    </button>
  );
};
