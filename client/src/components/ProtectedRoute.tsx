
import { useEffect } from "react";
import { useLocation } from "wouter";

interface ProtectedRouteProps {
    children: React.ReactNode;
    role: 'admin' | 'contractor';
}

export default function ProtectedRoute({ children, role }: ProtectedRouteProps) {
    const [, setLocation] = useLocation();

    const tokenKey = role === 'admin' ? 'adminToken' : 'contractorToken';
    const loginPath = role === 'admin' ? '/admin/login' : '/contractor/login';
    const hasToken = !!localStorage.getItem(tokenKey);

    useEffect(() => {
        if (!hasToken) {
            // P8: a deep link (e.g. the "Quote ready to price" Pushover → /admin/price/<slug>) opened
            // on a phone with no session must come BACK here after login, not land on the default page.
            const here = `${window.location.pathname}${window.location.search}`;
            const next = role === 'admin' && here.startsWith('/admin/') && here !== loginPath ? `?next=${encodeURIComponent(here)}` : '';
            setLocation(`${loginPath}${next}`);
        }
    }, [hasToken, loginPath, role, setLocation]);

    if (!hasToken) {
        return null;
    }

    return <>{children}</>;
}
