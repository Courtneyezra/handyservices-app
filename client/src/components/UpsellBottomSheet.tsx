import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check } from 'lucide-react';

interface UpsellSku {
  skuCode: string;
  name: string;
  pricePence: number;
  customerDescription: string;
  shape: string;
}

interface UpsellBottomSheetProps {
  open: boolean;
  upsells: UpsellSku[];
  selected: Set<string>;
  onToggle: (skuCode: string) => void;
  onConfirm: () => void;
  onSkip: () => void;
}

export function UpsellBottomSheet({
  open,
  upsells,
  selected,
  onToggle,
  onConfirm,
  onSkip,
}: UpsellBottomSheetProps) {
  const addOnTotal = upsells
    .filter((u) => selected.has(u.skuCode))
    .reduce((s, u) => s + u.pricePence, 0);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
            onClick={onConfirm}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 120) onConfirm();
            }}
            className="fixed bottom-0 left-0 right-0 z-[110] bg-slate-900 rounded-t-2xl shadow-2xl flex flex-col"
            style={{ maxHeight: '80vh' }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="px-5 pt-3 pb-5 shrink-0 border-b border-white/10">
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-block bg-[#7DB00E]/20 text-[#7DB00E] text-xs font-semibold px-2.5 py-0.5 rounded-full mb-2">
                    While We're There…
                  </span>
                  <h2 className="text-white text-lg font-bold leading-snug">
                    Add anything else while we're there?
                  </h2>
                  <p className="text-slate-400 text-sm mt-0.5">
                    No extra call-out charge — priced as add-ons.
                  </p>
                </div>
                <button
                  onClick={onConfirm}
                  className="text-slate-400 hover:text-white transition-colors ml-4 shrink-0 mt-1"
                  aria-label="Skip"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {upsells.map((u) => {
                const checked = selected.has(u.skuCode);
                return (
                  <div
                    key={u.skuCode}
                    onClick={() => onToggle(u.skuCode)}
                    className={`flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-all select-none ${
                      checked
                        ? 'border-[#7DB00E] bg-[#7DB00E]/10'
                        : 'border-white/10 bg-white/5 hover:border-white/25'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                        checked ? 'bg-[#7DB00E] border-[#7DB00E]' : 'border-slate-500'
                      }`}
                    >
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-white">{u.name}</span>
                        <span className="font-bold text-sm whitespace-nowrap text-[#7DB00E]">
                          + £{(u.pricePence / 100).toFixed(0)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                        {u.customerDescription}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-4 pb-6 pt-3 border-t border-white/10 shrink-0 space-y-3 safe-area-bottom">
              {addOnTotal > 0 && (
                <div className="flex justify-between text-sm font-semibold px-1">
                  <span className="text-slate-300">Add-ons total</span>
                  <span className="text-[#7DB00E]">+ £{(addOnTotal / 100).toFixed(0)}</span>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={onSkip}
                  className="flex-1 border border-white/15 rounded-xl py-3 text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors"
                >
                  No thanks
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 rounded-xl py-3 text-sm font-bold text-slate-900 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#e8b323' }}
                >
                  {selected.size > 0 ? 'Add & continue' : 'Continue'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
