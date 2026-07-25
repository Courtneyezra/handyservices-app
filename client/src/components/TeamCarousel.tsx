import { useEffect, useRef } from "react";
import { Star } from "lucide-react";
import { CONTRACTOR_ROSTER } from "@/lib/contractor-roster";

/**
 * "Meet your handymen" carousel — the shared team strip used by every city
 * landing (Nottingham, Derby, …). Horizontal scroll-snap with a gentle
 * auto-advance that:
 *   - pauses while the visitor is hovering/touching/scrolling it,
 *   - loops back to the start at the end,
 *   - is fully disabled under prefers-reduced-motion.
 *
 * `city` only personalises the image alt text.
 */
export function TeamCarousel({ city }: { city: string }) {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let paused = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      paused = true;
      if (resumeTimer) clearTimeout(resumeTimer);
    };
    // Resume a few seconds after the visitor stops interacting.
    const resumeSoon = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { paused = false; }, 4000);
    };

    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerdown", pause);
    el.addEventListener("pointerleave", resumeSoon);
    el.addEventListener("touchstart", pause, { passive: true });
    el.addEventListener("touchend", resumeSoon, { passive: true });

    const id = setInterval(() => {
      if (paused) return;
      const card = el.firstElementChild as HTMLElement | null;
      if (!card) return;
      const step = card.offsetWidth + 16; // card width + gap-4
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: "smooth" });
    }, 3200);

    return () => {
      clearInterval(id);
      if (resumeTimer) clearTimeout(resumeTimer);
      el.removeEventListener("pointerenter", pause);
      el.removeEventListener("pointerdown", pause);
      el.removeEventListener("pointerleave", resumeSoon);
      el.removeEventListener("touchstart", pause);
      el.removeEventListener("touchend", resumeSoon);
    };
  }, []);

  return (
    <div
      ref={trackRef}
      className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 mb-8 lg:mb-12 -mx-4 px-4 lg:mx-0 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CONTRACTOR_ROSTER.map((m) => (
        <div key={m.key} className="snap-center shrink-0 w-[68%] sm:w-[240px] relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/5]">
          <img src={m.portraitUrl} alt={`${m.name}, your ${city} handyman`} loading="lazy" decoding="async" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/10 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="text-white text-xl font-extrabold leading-none">{m.name}</div>
            <div className="text-amber-400 font-semibold text-xs mt-1">{m.role} · HandyServices</div>
            <div className="flex items-center gap-1.5 mt-1.5 text-white/90 text-xs">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span className="text-white/80">{m.meta}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
