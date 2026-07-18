"use strict";
// Low-level HTTP client for BMS Africa's SMS API — which is a white-labeled
// mnotify.com (BMS's docs at developer.bms.africa resolve to mnotify's
// OpenAPI spec, and BMS confirmed the two are the same provider). Talks
// directly to api.mnotify.com.
//
// Auth note: mnotify's OpenAPI securityScheme metadata declares the API key
// as a header (`api_key`), but every one of its own runnable code samples
// (curl/php/python/nodejs) instead passes it as a `?key=` query parameter.
// We follow the code samples — they're the concrete, working examples.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendQuickSms = sendQuickSms;
const BMS_QUICK_SMS_URL = 'https://api.mnotify.com/api/sms/quick';
function extractCreditLeft(body) {
    const summary = body === null || body === void 0 ? void 0 : body.summary;
    return typeof (summary === null || summary === void 0 ? void 0 : summary.credit_left) === 'number' ? summary.credit_left : undefined;
}
async function sendQuickSms(params) {
    const url = `${BMS_QUICK_SMS_URL}?key=${encodeURIComponent(params.apiKey)}`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: [params.recipient],
                sender: params.sender,
                message: params.message,
                is_schedule: false,
                schedule_date: '',
            }),
        });
    }
    catch (err) {
        return { ok: false, httpStatus: 0, raw: null, errorMessage: err.message };
    }
    let body = null;
    try {
        body = await res.json();
    }
    catch (_a) {
        // Non-JSON response body — raw stays null, errorMessage falls back below.
    }
    const creditLeft = extractCreditLeft(body);
    const status = body === null || body === void 0 ? void 0 : body.status;
    if (!res.ok || status !== 'success') {
        const message = body === null || body === void 0 ? void 0 : body.message;
        return {
            ok: false,
            httpStatus: res.status,
            raw: body,
            creditLeft,
            errorMessage: message !== null && message !== void 0 ? message : `HTTP ${res.status}`,
        };
    }
    return { ok: true, httpStatus: res.status, raw: body, creditLeft };
}
//# sourceMappingURL=bmsClient.js.map