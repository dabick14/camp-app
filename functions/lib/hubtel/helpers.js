"use strict";
/**
 * Small shared helpers for the Hubtel integration.
 * Kept pure (no Firebase, no network) so they are trivially unit-testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripQuotes = stripQuotes;
exports.lowerKeys = lowerKeys;
exports.mapHubtelStatus = mapHubtelStatus;
/** Strip surrounding quotes that sometimes sneak into env/secret values. */
function stripQuotes(s) {
    return s.replace(/^["']|["']$/g, '');
}
/**
 * Shallow-lowercase an object's top-level keys so we can read fields regardless of
 * the casing Hubtel returns. The api-txnstatus endpoint returns camelCase
 * (responseCode, data.status) while the callback and the rmsc.hubtel.com status
 * endpoint return PascalCase (ResponseCode, Data.Status). Reading one casing against
 * the other leaves every field undefined — this guards against that.
 */
function lowerKeys(obj) {
    if (!obj || typeof obj !== 'object')
        return {};
    const out = {};
    for (const key of Object.keys(obj)) {
        out[key.toLowerCase()] = obj[key];
    }
    return out;
}
/**
 * Map any Hubtel status string to our normalized status.
 * Callback status: "Success"; Status-check status: "Paid" | "Unpaid" | "Refunded".
 */
function mapHubtelStatus(status) {
    const s = (status || '').toLowerCase();
    if (['success', 'successful', 'paid', 'completed'].includes(s))
        return 'SUCCESS';
    if (['failed', 'failure', 'declined', 'error', 'refunded'].includes(s))
        return 'FAILED';
    if (['cancelled', 'canceled', 'abandoned', 'expired'].includes(s))
        return 'ABANDONED';
    return 'PENDING';
}
//# sourceMappingURL=helpers.js.map