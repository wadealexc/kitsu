/* -------------------- TIMESTAMP UTILITIES -------------------- */

/**
 * Returns current timestamp in unix seconds (not milliseconds).
 */
export function currentUnixTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Converts Date to unix timestamp (seconds).
 */
export function toUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

/**
 * Converts unix timestamp (seconds) to Date.
 */
export function fromUnixTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
}
