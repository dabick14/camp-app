"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSms = sendSms;
const firestore_1 = require("firebase-admin/firestore");
const normalizePhone_1 = require("./normalizePhone");
const bmsClient_1 = require("./bmsClient");
const devOverride_1 = require("./devOverride");
// Reusable send-SMS service — every trigger (room assignment today; future
// broadcasts / payment reminders) should call through here rather than the
// provider client directly, so the send log, kill switch, and phone
// normalization stay in one place.
async function sendSms(params) {
    var _a, _b, _c;
    const { db, campId, participantId, phone, trigger, message, triggeredBy, apiKey, senderId, enabled, logId, } = params;
    const logRef = logId
        ? db.doc(`camps/${campId}/smsLog/${logId}`)
        : db.collection(`camps/${campId}/smsLog`).doc();
    // Idempotency lock: claim the log doc before doing anything else. If this
    // event was already processed (duplicate trigger delivery, retry), the
    // create() below throws ALREADY_EXISTS and we bail out before ever
    // touching the provider — no double sends, no double charges.
    try {
        await logRef.create({
            participantId,
            phone,
            trigger,
            message,
            status: 'PENDING',
            triggeredBy,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    catch (err) {
        const code = err.code;
        if (code === 6 || code === 'already-exists') {
            return 'DUPLICATE';
        }
        throw err;
    }
    if (!enabled) {
        await logRef.update({ status: 'SKIPPED', reason: 'SMS disabled for camp (kill switch)' });
        return 'SKIPPED';
    }
    const normalizedPhone = (0, normalizePhone_1.normalizeGhanaPhone)(phone);
    if (!normalizedPhone) {
        await logRef.update({ status: 'SKIPPED', reason: 'Missing or invalid phone number' });
        return 'SKIPPED';
    }
    // Emulator-only redirect (see devOverride.ts) — the participant's own
    // number is still what gets validated and logged as `phone`; only the
    // actual provider destination changes, and only under FUNCTIONS_EMULATOR.
    const override = (0, devOverride_1.devOverridePhone)();
    const recipient = override !== null && override !== void 0 ? override : normalizedPhone;
    const result = await (0, bmsClient_1.sendQuickSms)({ apiKey, sender: senderId, recipient, message });
    const creditFields = result.creditLeft !== undefined ? { creditLeft: result.creditLeft } : {};
    const devRedirectFields = override
        ? { devRedirected: true, devRedirectedFrom: normalizedPhone }
        : {};
    if (result.ok) {
        await logRef.update(Object.assign(Object.assign({ status: 'SENT', normalizedPhone: recipient, providerResponse: (_a = result.raw) !== null && _a !== void 0 ? _a : null }, creditFields), devRedirectFields));
        return 'SENT';
    }
    await logRef.update(Object.assign(Object.assign({ status: 'FAILED', normalizedPhone: recipient, providerError: (_b = result.errorMessage) !== null && _b !== void 0 ? _b : 'Unknown provider error', providerResponse: (_c = result.raw) !== null && _c !== void 0 ? _c : null }, creditFields), devRedirectFields));
    return 'FAILED';
}
//# sourceMappingURL=smsService.js.map