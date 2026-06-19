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
 */
interface DispatchSelectionValue {
  hoveredGroupId: string | null;
  setHoveredGroupId: (id: string | null) => void;
  selectedContractorId: string | null;
  setSelectedContractorId: (id: string | null) => void; // calling with the same id toggles it off
  modalContractorId: string | null;
  setModalContractorId: (id: string | null) => void;
}

const DispatchSelectionContext = createContext<DispatchSelectionValue | null>(null);

export function DispatchSelectionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedContractorId, setSelectedContractorIdState] = useState<string | null>(null);
  // Plain set/clear (no toggle): the modal opens on the clicked id, closes on null.
  const [modalContractorId, setModalContractorId] = useState<string | null>(null);

  // Toggle semantics: selecting the already-selected contractor clears it.
  const setSelectedContractorId = useCallback((id: string | null) => {
    setSelectedContractorIdState((prev) => (id !== null && prev === id ? null : id));
  }, []);

  const value = useMemo<DispatchSelectionValue>(
    () => ({
      hoveredGroupId,
      setHoveredGroupId,
      selectedContractorId,
      setSelectedContractorId,
      modalContractorId,
      setModalContractorId,
    }),
    [hoveredGroupId, selectedContractorId, setSelectedContractorId, modalContractorId],
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
