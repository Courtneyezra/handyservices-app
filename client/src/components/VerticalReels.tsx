import { useEffect, useRef, useState } from "react";
import { Play, Volume2 } from "lucide-react";

/**
 * Instagram/Reels-style vertical video row — self-hosted, no third-party player.
 *
 * Each clip is a native <video> that:
 *   • autoplays MUTED + looping + playsInline (the combo iOS requires for inline
 *     autoplay), so the row visibly moves and reads as social content;
 *   • is LAZY: the file is only fetched once the card nears the viewport, so a
 *     visitor who never scrolls to it pays zero bytes;
 *   • plays only while it is on screen and pauses when it scrolls away, to save
 *     battery/data and stop off-screen clips fighting for bandwidth;
 *   • has a per-card sound toggle. Unmuting one clip mutes every other (only one
 *     voice at a time). Unmute is driven by a real tap, satisfying autoplay
 *     policy for sound.
 *
 * Respects prefers-reduced-motion: those visitors get the poster + a play button
 * and nothing autoplays until they tap.
 *
 * Files live in client/public/assets/reels/ and are referenced by absolute path
 * (e.g. "/assets/reels/kitchen.mp4"). Encode as H.264 MP4, ~1080x1920, muted-safe,
 * ideally < 2–3 MB per 6–12s loop. Supply a matching poster (first-frame WebP/JPG)
 * so the card paints instantly before the video loads.
 */

export type Reel = {
  /** Absolute path to the MP4, e.g. "/assets/reels/kitchen-fit.mp4". */
  src: string;
  /** First-frame still shown before/while the video loads, e.g. "/assets/reels/kitchen-fit.webp". */
  poster: string;
  /** Optional caption shown over the bottom of the card. */
  caption?: string;
  /** Optional area/label chip, e.g. "NG7". */
  tag?: string;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function ReelCard({
  reel,
  index,
  activeSoundIndex,
  onSound,
}: {
  reel: Reel;
  index: number;
  activeSoundIndex: number | null;
  onSound: (index: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const reduce = prefersReducedMotion();
  const soundOn = activeSoundIndex === index;

  // Two observers: a wide one to decide when to START loading the file, and a
  // tighter one (majority of the card visible) to play/pause as it enters/leaves.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearViewport(true);
          near.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    const vis = new IntersectionObserver(
      (entries) => setOnScreen(entries[0]?.isIntersecting ?? false),
      { threshold: 0.25 },
    );
    near.observe(el);
    vis.observe(el);
    return () => {
      near.disconnect();
      vis.disconnect();
    };
  }, []);

  // Play/pause driven by on-screen state. Reduced-motion visitors never autoplay.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !nearViewport || reduce) return;
    if (onScreen) {
      v.muted = !soundOn;
      const play = () => v.play().catch(() => {});
      if (v.readyState >= 2) play();
      else v.addEventListener("canplay", play, { once: true });
      return () => v.removeEventListener("canplay", play);
    }
    v.pause();
  }, [onScreen, nearViewport, reduce, soundOn]);

  // Reflect the mute toggle to the DOM property (React doesn't always mirror it).
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = !soundOn;
  }, [soundOn]);

  // Tap the play button: engage this clip with sound. A user gesture is a valid
  // reason to both unmute and (re)start playback, so this also recovers a clip
  // whose muted autoplay was blocked.
  const playWithSound = () => {
    onSound(index);
    const v = videoRef.current;
    if (v) {
      v.muted = false;
      v.play().catch(() => {});
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative aspect-[9/16] w-[72vw] max-w-[300px] flex-shrink-0 snap-center overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10 sm:w-[240px] md:w-[260px]"
    >
      <video
        ref={videoRef}
        src={nearViewport ? reel.src : undefined}
        poster={reel.poster}
        muted
        loop
        playsInline
        autoPlay={!reduce}
        preload={nearViewport ? "auto" : "none"}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label={reel.caption ?? "Handy Services video"}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Prominent play button — the Wistia-style white circle + triangle. It's
          shown whenever the clip is muted (i.e. before the visitor engages), so
          there's always a clear "play" affordance over the moving thumbnail.
          Tapping it plays WITH SOUND. It also doubles as the manual-start fallback
          when a browser blocks muted autoplay (iOS Low Power Mode etc.) — in that
          case the poster is frozen and this is the only way to start the clip. */}
      {!soundOn && (
        <button
          type="button"
          onClick={playWithSound}
          aria-label="Play with sound"
          className="group absolute inset-0 flex items-center justify-center"
        >
          {/* Only dim when the video isn't moving, so a playing thumbnail stays bright. */}
          <span
            className={`absolute inset-0 transition-colors ${playing ? "bg-transparent" : "bg-slate-900/25"}`}
          />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-xl ring-1 ring-black/5 transition-transform duration-200 group-hover:scale-110 md:h-[72px] md:w-[72px]">
            <Play className="ml-1 h-7 w-7 fill-[#1D2D3D] text-[#1D2D3D] md:h-8 md:w-8" />
          </span>
        </button>
      )}

      {/* Bottom gradient + caption. */}
      {(reel.caption || reel.tag) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          {reel.tag && (
            <span className="mb-1 inline-block rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-slate-900">
              {reel.tag}
            </span>
          )}
          {reel.caption && (
            <p className="text-sm font-semibold leading-snug text-white">{reel.caption}</p>
          )}
        </div>
      )}

      {/* Mute control — only once sound is engaged (the play button handles
          unmuting). While muted, the play button above is the affordance. */}
      {soundOn && (
        <button
          type="button"
          onClick={() => onSound(null)}
          aria-label="Mute video"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
        >
          <Volume2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function VerticalReels({ reels }: { reels: Reel[] }) {
  // Only one clip plays sound at a time.
  const [activeSoundIndex, setActiveSoundIndex] = useState<number | null>(null);

  if (!reels.length) return null;

  return (
    <div
      className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:justify-center sm:snap-none sm:overflow-visible [&::-webkit-scrollbar]:hidden"
      role="list"
      aria-label="Recent jobs, on video"
    >
      {reels.map((reel, i) => (
        <div role="listitem" key={reel.src}>
          <ReelCard
            reel={reel}
            index={i}
            activeSoundIndex={activeSoundIndex}
            onSound={setActiveSoundIndex}
          />
        </div>
      ))}
    </div>
  );
}
