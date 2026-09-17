/**
 * The admin session header for a fetch to a route behind requireAdmin (which also admits VAs).
 * The token is the one the admin login stores; with none, the route answers 401.
 */
export function adminAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}
