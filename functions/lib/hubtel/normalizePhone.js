"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhone = normalizePhone;
/**
 * Normalize a Ghana MoMo number to E.164 (+233XXXXXXXXX).
 * Hubtel sends numbers like "233242825109"; users may also enter "0244..." or "+233...".
 * Returns undefined for empty/garbage input.
 */
function normalizePhone(input) {
    if (!input)
        return undefined;
    const cleaned = String(input).replace(/[^\d+]/g, '');
    if (!cleaned)
        return undefined;
    const d = cleaned.replace(/^\+/, '');
    if (d.startsWith('233'))
        return `+${d}`;
    if (d.startsWith('0'))
        return `+233${d.slice(1)}`;
    if (d.length === 9)
        return `+233${d}`; // 9 digits, missing the leading 0
    return `+${d}`;
}
//# sourceMappingURL=normalizePhone.js.map