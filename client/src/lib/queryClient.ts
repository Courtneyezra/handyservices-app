import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Prevent infinite retries that cause mass requests
            retry: 1,
            // Don't retry on 4xx errors (client errors)
            retryOnMount: false,
            // Refetch less aggressively
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            // Stale time to prevent unnecessary refetches
            staleTime: 30000, // 30 seconds
            // Cache time before garbage collection
            gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
        },
    },
});

export async function apiRequest(
    method: string,
    url: string,
    data?: unknown | undefined,
): Promise<Response> {
    const res = await fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
        },
        body: data ? JSON.stringify(data) : undefined,
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`API Request Failed: ${res.status} ${errorText}`);
    }

    return res;
}
