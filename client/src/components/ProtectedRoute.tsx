
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

interface ProtectedRouteProps {
    children: React.ReactNode;
    role: 'admin' | 'contractor';
}

export default function ProtectedRoute({ children, role }: ProtectedRouteProps) {
    const [, setLocation] = useLocation();
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

    useEffect(() => {
        const checkAuth = () => {
            if (role === 'admin') {
                const token = localStorage.getItem('adminToken');
                if (!token) {
                    // Save current location for redirect back? (Enhancement)
                    setLocation('/admin/login');
                    setIsAuthorized(false);
                } else {
                    setIsAuthorized(true);
                }
            } else if (role === 'contractor') {
                const token = localStorage.getItem('contractorToken');
                if (!token) {
                    setLocation('/contractor/login');
                    setIsAuthorized(false);
                } else {
                    setIsAuthorized(true);
                }
            }
        };

        checkAuth();
    }, [role, setLocation]);

    if (isAuthorized === null) {
        return null; // or loading spinner
    }

    if (!isAuthorized) {
        return null;
    }

    return <>{children}</>;
}
