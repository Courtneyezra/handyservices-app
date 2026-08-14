import { useEffect, useState } from 'react';

/**
 * True once the page is actually being DISPLAYED to the user.
 *
 * Why this exists (Aug 2026 "quotes freeze mid-theatre"): the quote-open
 * theatre is a chain of setTimeout beats whose content enters via CSS rise
 * animations (`animation-fill-mode: both` — elements hold at opacity 0 until
 * the animation's first rendered frame). In a document that gets no rendering
 * frames — background tab, in-app browser view not yet presented, prerender —
 * timers still fire, so the show "plays" invisibly while every animated
 * element stays blank. The customer then switches to the tab mid-flow and
 * finds a half-blank page frozen mid-theatre. Gating the beat timers on this
 * hook holds the show at its opening beat until someone can actually see it.
 *
 * Shown is latched by ANY of (first signal wins, never un-latches):
 *  - document.visibilityState === 'visible' (at mount or via visibilitychange)
 *  - a requestAnimationFrame tick — a rendered frame is PROOF the page is
 *    displayed, covering webviews that misreport visibilityState as hidden
 *  - first user input — a hidden page can't receive input; final failsafe so
 *    a buggy environment can never hold the flow hostage
 */
export function usePageShown(): boolean {
  const [shown, setShown] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );

  useEffect(() => {
    if (shown) return;
    const show = () => setShown(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') show();
    };
    const raf = requestAnimationFrame(show);
    document.addEventListener('visibilitychange', onVisibility);
    const opts: AddEventListenerOptions = { once: true, passive: true };
    window.addEventListener('pointerdown', show, opts);
    window.addEventListener('keydown', show, opts);
    window.addEventListener('wheel', show, opts);
    window.addEventListener('touchstart', show, opts);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', show);
      window.removeEventListener('keydown', show);
      window.removeEventListener('wheel', show);
      window.removeEventListener('touchstart', show);
    };
  }, [shown]);

  return shown;
}
