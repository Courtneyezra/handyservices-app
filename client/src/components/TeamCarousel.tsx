import { useEffect, useRef } from "react";
import { Star } from "lucide-react";
import { CONTRACTOR_ROSTER } from "@/lib/contractor-roster";

/**
 * "Meet your handymen" carousel — the shared team strip used by every city
 * landing (Nottingham, Derby, …). Horizontal scroll-snap that:
 *   - can be dragged/swiped with a mouse (touch swipes natively),
 *   - auto-rotates one card every ~3.2s and loops at the end,
 *   - pauses auto-rotate only while the visitor is actively dragging/scrolling
 *     it (not on mere hover, so it keeps moving on desktop),
 *   - disables auto-rotate under prefers-reduced-motion (drag still works).
 *
 * `city` only personalises the image alt text.
 */
export function TeamCarousel({ city }: { city: string }) {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    // ── Mouse drag-to-swipe (touch already scrolls natively) ──────────────
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return; // let touch use native momentum scroll
      dragging = true;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      try { el.setPointerCapture(e.pointerId); } catch { /* no-op */ }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      el.scrollLeft = startScroll - (e.clientX - startX);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch { /* no-op */ }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    // ── Auto-rotate — pause only during ACTIVE interaction, not on hover ──
    let paused = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => { paused = true; if (resumeTimer) clearTimeout(resumeTimer); };
    const resumeSoon = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { paused = false; }, 4000);
    };
    const onWheel = () => { pause(); resumeSoon(); };
    el.addEventListener("pointerdown", pause);
    el.addEventListener("pointerup", resumeSoon);
    el.addEventListener("touchstart", pause, { passive: true });
    el.addEventListener("touchend", resumeSoon, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = reduce ? undefined : setInterval(() => {
      if (paused || dragging) return;
      const card = el.firstElementChild as HTMLElement | null;
      if (!card) return;
      const step = card.offsetWidth + 16; // card width + gap-4
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: "smooth" });
    }, 3200);

    return () => {
      if (id) clearInterval(id);
      if (resumeTimer) clearTimeout(resumeTimer);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerdown", pause);
      el.removeEventListener("pointerup", resumeSoon);
      el.removeEventListener("touchstart", pause);
      el.removeEventListener("touchend", resumeSoon);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div
      ref={trackRef}
      className="flex gap-4 overflow-x-auto snap-x snap-proximity pb-4 mb-8 lg:mb-12 -mx-4 px-4 lg:mx-0 lg:px-0 cursor-grab active:cursor-grabbing select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CONTRACTOR_ROSTER.map((m) => (
        <div key={m.key} className="snap-center shrink-0 w-[68%] sm:w-[240px] relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/5]">
          <img src={m.portraitUrl} alt={`${m.name}, your ${city} handyman`} loading="lazy" decoding="async" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/10 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="text-white text-xl font-extrabold leading-none">{m.name}</div>
            <div className="flex items-center gap-1.5 mt-2 text-white/90 text-xs">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span className="text-white/80">{m.meta}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
