/**
 * Shared utility functions used across popup, sidebar, and options pages.
 */

/**
 * Format a number with K/M suffixes for large values.
 */
export function formatNumber(num: number): string {
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
}

/**
 * Check if two domains belong to the same site.
 * Simple implementation using registrable domain (eTLD+1).
 */
export function isSameSite(domain1: string, domain2: string): boolean {
    const getRegistrableDomain = (d: string) => d.split('.').slice(-2).join('.');
    return getRegistrableDomain(domain1) === getRegistrableDomain(domain2);
}

/**
 * Determine if a query status indicates the query was blocked.
 * Handles both Pi-hole v6 string statuses and legacy numeric statuses.
 */
export function isQueryBlocked(status: string | number | undefined | null): boolean {
    if (status === undefined || status === null) return false;

    if (typeof status === 'string') {
        // Pi-hole v6 status strings
        // Blocked: GRAVITY, BLACKLIST, REGEX, EXTERNAL_BLOCKED_*, DENYLIST, etc.
        // Allowed: FORWARDED, CACHE, UPSTREAM_*, RETRIED, etc.
        const blockedStatuses = [
            'GRAVITY',
            'BLACKLIST',
            'DENYLIST',
            'REGEX',
            'EXTERNAL_BLOCKED_IP',
            'EXTERNAL_BLOCKED_NULL',
            'EXTERNAL_BLOCKED_NXRA',
            'BLOCKED',
            'SPECIAL_DOMAIN',
            'DATABASE_BUSY'
        ];
        return blockedStatuses.includes(status.toUpperCase());
    }

    // Numeric status fallback: 2-11 are blocked
    return status >= 2 && status <= 11;
}
