
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

export default function GoogleCallback() {
    const [, setLocation] = useLocation();
    const [error, setError] = useState('');

    useEffect(() => {
        const handleCallback = async () => {
            try {
                // Get token from URL
                const searchParams = new URLSearchParams(window.location.search);
                const token = searchParams.get('token');

                if (!token) {
                    throw new Error('No token received');
                }

                // Store token
                localStorage.setItem('contractorToken', token);

                // Fetch user info to store in localStorage (to match login flow)
                const response = await fetch('/api/contractor/me', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch user profile');
                }

                const data = await response.json();
                localStorage.setItem('contractorUser', JSON.stringify(data.user));
                if (data.profile?.id) {
                    localStorage.setItem('contractorProfileId', data.profile.id);
                }

                // Redirect
                setLocation('/contractor/dashboard');

            } catch (err) {
                console.error('Google callback error:', err);
                setError('Authentication failed. Please try again.');
                setTimeout(() => setLocation('/contractor/login'), 3000);
            }
        };

        handleCallback();
    }, [setLocation]);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
                <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-xl text-center">
                    <p className="text-red-400 mb-2">{error}</p>
                    <p className="text-sm text-slate-400">Redirecting to login...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900">
            <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-400">Completing sign in...</p>
            </div>
        </div>
    );
}
