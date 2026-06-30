import { SiVisa, SiAmericanexpress, SiApplepay } from 'react-icons/si';

/**
 * Real payment-brand marks for the checkout trust row.
 *
 * The Simple Icons glyphs used before were monochrome — fine for Visa / Amex /
 * Apple Pay (those marks ARE single-colour) but wrong for Mastercard, whose
 * defining feature is the two interlocking red/orange circles. We draw Mastercard
 * properly here, and present every brand on a white "card" chip so the colours
 * read on the dark quote card (the Visa/Amex blues otherwise vanish into navy).
 */

/** Accurate Mastercard mark: red + orange circles with the overlap in #FF5F00. */
function MastercardMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} role="img" aria-label="Mastercard">
      <circle cx="19" cy="16" r="9" fill="#EB001B" />
      <circle cx="29" cy="16" r="9" fill="#F79E1B" />
      {/* Overlap of the two circles, in Mastercard's interlock orange. */}
      <path d="M24 8.52a9 9 0 0 1 0 14.96 9 9 0 0 1 0-14.96Z" fill="#FF5F00" />
    </svg>
  );
}

/** Card-brand trust row: real brand marks on white chips. */
export function CardBrandStrip({ className = '' }: { className?: string }) {
  const chip =
    'h-7 w-11 rounded-md bg-white flex items-center justify-center shadow-sm ring-1 ring-black/5';
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <span className={chip} aria-label="Visa">
        <SiVisa className="h-3.5 w-auto text-[#1434CB]" />
      </span>
      <span className={chip}>
        <MastercardMark className="h-5 w-auto" />
      </span>
      <span className={chip} aria-label="American Express">
        <SiAmericanexpress className="h-4 w-auto text-[#1F72CF]" />
      </span>
      <span className={chip} aria-label="Apple Pay">
        <SiApplepay className="h-4 w-auto text-black" />
      </span>
    </div>
  );
}
