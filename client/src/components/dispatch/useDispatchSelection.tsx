import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Shared cross-highlight selection for the dispatch cockpit.
 *
 * Two independent panels (map + schedule/rail) read the same hover/selection
 * state so that pointing at a bundle on one surface lights up the matching
 * jobs on the other.
 *
 * A `groupId` is `${contractorId}|${date}` — it matches the optimiser's
 * ProposalGroup.groupId, so a job's owning contractor is `groupId.split("|")[0]`.
 *
 * Contracts:
 *  - `hoveredGroupId` — the contractor-day bundle currently under the pointer
 *    (transient; cleared on mouse-out).
 *  - `selectedContractorId` — a pinned contractor focus; calling the setter with
 *    the SAME id toggles it back off (null).
 *  - `modalContractorId` — the contractor whose edit modal is open (skills +
 *    availability). Plain set/clear, NO toggle: pass an id to open, null to close.
 *
 * Manual dispatch (drag-and-drop):
 *  - `stagedPlacements` — jobs the dispatcher has manually dragged onto a
 *    contractor-day cell but NOT yet confirmed. Keyed by quoteId so a job can
 *    only be staged in one place at a time (re-dragging moves it). These are
 *    browser-local until confirmed; confirming books them via /confirm-dispatch.
 */
export interface StagedPlacement {
  quoteId: string;
  customerName: string;
  contractorId: string;
  contractorName: string;
  date: string; // YYYY-MM-DD
  slot: "am" | "pm" | "full_day";
}

interface DispatchSelectionValue {
  hoveredGroupId: string | null;
  setHoveredGroupId: (id: string | null) => void;
  selectedContractorId: string | null;
  setSelectedContractorId: (id: string | null) => void; // calling with the same id toggles it off
  modalContractorId: string | null;
  setModalContractorId: (id: string | null) => void;

  // ── Manual drag-and-drop staging ──
  stagedPlacements: Record<string, StagedPlacement>;
  stageJob: (placement: StagedPlacement) => void;
  unstageJob: (quoteId: string) => void;
  setStagedSlot: (quoteId: string, slot: StagedPlacement["slot"]) => void;
  clearStaged: () => void;
}

const DispatchSelectionContext = createContext<DispatchSelectionValue | null>(null);

export function DispatchSelectionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedContractorId, setSelectedContractorIdState] = useState<string | null>(null);
  // Plain set/clear (no toggle): the modal opens on the clicked id, closes on null.
  const [modalContractorId, setModalContractorId] = useState<string | null>(null);
  const [stagedPlacements, setStagedPlacements] = useState<Record<string, StagedPlacement>>({});

  // Toggle semantics: selecting the already-selected contractor clears it.
  const setSelectedContractorId = useCallback((id: string | null) => {
    setSelectedContractorIdState((prev) => (id !== null && prev === id ? null : id));
  }, []);

  // Stage (or move) a job. Keyed by quoteId, so dragging an already-staged job
  // to a new cell simply overwrites its placement.
  const stageJob = useCallback((placement: StagedPlacement) => {
    setStagedPlacements((prev) => ({ ...prev, [placement.quoteId]: placement }));
  }, []);

  const unstageJob = useCallback((quoteId: string) => {
    setStagedPlacements((prev) => {
      if (!(quoteId in prev)) return prev;
      const next = { ...prev };
      delete next[quoteId];
      return next;
    });
  }, []);

  const setStagedSlot = useCallback((quoteId: string, slot: StagedPlacement["slot"]) => {
    setStagedPlacements((prev) => {
      const cur = prev[quoteId];
      if (!cur) return prev;
      return { ...prev, [quoteId]: { ...cur, slot } };
    });
  }, []);

  const clearStaged = useCallback(() => setStagedPlacements({}), []);

  const value = useMemo<DispatchSelectionValue>(
    () => ({
      hoveredGroupId,
      setHoveredGroupId,
      selectedContractorId,
      setSelectedContractorId,
      modalContractorId,
      setModalContractorId,
      stagedPlacements,
      stageJob,
      unstageJob,
      setStagedSlot,
      clearStaged,
    }),
    [
      hoveredGroupId,
      selectedContractorId,
      setSelectedContractorId,
      modalContractorId,
      stagedPlacements,
      stageJob,
      unstageJob,
      setStagedSlot,
      clearStaged,
    ],
  );

  return (
    <DispatchSelectionContext.Provider value={value}>
      {children}
    </DispatchSelectionContext.Provider>
  );
}

export function useDispatchSelection(): DispatchSelectionValue {
  const ctx = useContext(DispatchSelectionContext);
  if (!ctx) {
    throw new Error("useDispatchSelection must be used within a <DispatchSelectionProvider>");
  }
  return ctx;
}
