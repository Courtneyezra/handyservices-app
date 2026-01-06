import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';

export interface ContractorProfile {
    id: string;
    userId: string;
    slug: string;
    profile?: any; // The actual profile data including skills
    user?: any; // The user data
}

export function useContractorAuth() {
    const [, setLocation] = useLocation();

    const { data: contractor, isLoading, error } = useQuery<ContractorProfile>({
        queryKey: ['contractor-me'],
        queryFn: async () => {
            const res = await fetch('/api/contractor/me');
            if (res.status === 401) {
                throw new Error('Unauthorized');
            }
            if (!res.ok) throw new Error('Failed to fetch profile');
            return res.json();
        },
        retry: false
    });

    const logout = async () => {
        await fetch('/api/contractor/logout', { method: 'POST' });
        setLocation('/contractor/login');
    };

    return {
        contractor,
        isLoading,
        isAuthenticated: !!contractor,
        logout
    };
}
