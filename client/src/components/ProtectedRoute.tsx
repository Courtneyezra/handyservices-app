
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
            setLocation(loginPath);
        }
    }, [hasToken, loginPath, setLocation]);

    if (!hasToken) {
        return null;
    }

    return <>{children}</>;
}
