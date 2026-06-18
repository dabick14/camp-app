"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReference = generateReference;
const crypto_1 = require("crypto");
/**
 * Generate a unique Hubtel clientReference. Hubtel caps clientReference at 32 chars.
 * Format: PREFIX_<base36 timestamp>_<8 hex> — ~24 chars, well under the limit.
 */
function generateReference(prefix = 'CAMP') {
    const ts = Date.now().toString(36);
    const rand = (0, crypto_1.randomBytes)(4).toString('hex');
    return `${prefix}_${ts}_${rand}`.toUpperCase().slice(0, 32);
}
//# sourceMappingURL=reference.js.map