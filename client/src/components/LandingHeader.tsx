
import { Phone } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { HandLogo, GoogleReviewsBadge } from "./LandingShared";
import { Link } from "wouter";

const WHATSAPP_NUMBER = "+447508744402";
const WHATSAPP_MESSAGE = encodeURIComponent("I'm interested in Handy Services");
const PHONE_NUMBER = "+447449501762";

interface HeaderProps {
    onConversion?: (source: string) => void;
}

export function LandingHeader({ onConversion }: HeaderProps) {
    const handleNavClick = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <header className="sticky top-0 z-50 bg-slate-800 px-4 lg:px-8 py-3">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <Link href="/landing">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={handleNavClick}>
                        <HandLogo className="w-10 h-10 md:w-12 md:h-12" />
                        <span className="text-white font-bold text-lg md:text-xl">Handy Services</span>
                    </div>
                </Link>

                <div className="hidden md:flex items-center gap-8">
                    <nav className="flex items-center gap-6">
                        <a href="#services" className="text-white/80 hover:text-white transition-colors">Services</a>
                        <a href="#team" className="text-white/80 hover:text-white transition-colors">Our Team</a>
                        <Link href="/property-managers">
                            <span className="text-white/80 hover:text-white transition-colors cursor-pointer" onClick={handleNavClick}>Property Managers</span>
                        </Link>
                        <Link href="/businesses">
                            <span className="text-white/80 hover:text-white transition-colors cursor-pointer text-emerald-400" onClick={handleNavClick}>For Business</span>
                        </Link>
                    </nav>
                    <GoogleReviewsBadge />
                </div>

                <div className="flex items-center gap-3">
                    <a
                        href={`tel:${PHONE_NUMBER}`}
                        onClick={() => onConversion?.('header_call')}
                        className="hidden lg:flex items-center gap-2 px-4 py-2 text-white border border-white/30 rounded-full hover:bg-white/10 transition-colors"
                        data-testid="button-header-call"
                    >
                        <Phone className="w-4 h-4" />
                        <span>07449 501762</span>
                    </a>
                    <a
                        href={`https://wa.me/${WHATSAPP_NUMBER.replace('+', '')}?text=${WHATSAPP_MESSAGE}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onConversion?.('header_whatsapp')}
                        className="flex lg:hidden items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-500 text-slate-900 font-semibold rounded-full transition-colors"
                        data-testid="button-header-whatsapp"
                    >
                        <SiWhatsapp className="w-4 h-4" />
                        <span className="hidden sm:inline">Chat Now</span>
                    </a>
                </div>
            </div>
        </header>
    );
}
