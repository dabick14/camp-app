"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devOverridePhone = devOverridePhone;
const normalizePhone_1 = require("./normalizePhone");
// Local-dev safety valve: redirect every outbound SMS to one real number
// (yours) instead of whatever fake phone number is on the seeded/test
// participant. Gated on BOTH conditions so it can never fire in production:
//
//  1. process.env.FUNCTIONS_EMULATOR === 'true' — set by the Firebase
//     Functions Emulator process itself (the firebase-functions SDK relies
//     on this same flag internally, e.g. to skip auth-header verification
//     under emulation). This is not something a config file can spoof —
//     only the actual emulator runtime sets it.
//  2. SMS_DEV_OVERRIDE_PHONE is set — a plain (non-secret) env var, local
//     only, read from functions/.env. Absent by default.
//
// Even if SMS_DEV_OVERRIDE_PHONE somehow ended up in a deployed function's
// config, condition 1 alone still blocks it outside the emulator.
function devOverridePhone() {
    if (process.env.FUNCTIONS_EMULATOR !== 'true')
        return null;
    const raw = process.env.SMS_DEV_OVERRIDE_PHONE;
    if (!raw)
        return null;
    return (0, normalizePhone_1.normalizeGhanaPhone)(raw);
}
//# sourceMappingURL=devOverride.js.map