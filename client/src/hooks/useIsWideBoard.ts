/**
 * Kanban + docked conversation panel (hsa-comms-v2-ben-board-layouts-s33, option 01): at this width
 * and up the comms board and the Handy Desk sit the open case file beside the list, permanent rather
 * than an overlay sheet. Below it, a bottom sheet (`ThreadSheet`), chat-first, with a way back.
 * jsdom has no matchMedia: defaults to narrow, which is the sheet behaviour every current test
 * exercises. A leaf module, so the desk never pulls in the board page for it.
 */
import { useEffect, useState } from 'react';

const WIDE_BOARD_QUERY = '(min-width: 1024px)';

export function useIsWideBoard(): boolean {
    const [wide, setWide] = useState<boolean>(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_BOARD_QUERY).matches : false);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(WIDE_BOARD_QUERY);
        const on = () => setWide(mq.matches);
        on();
        if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }
        mq.addListener?.(on);
        return () => mq.removeListener?.(on);
    }, []);
    return wide;
}
