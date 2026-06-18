"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUBTEL_SECRETS = exports.HUBTEL_MERCHANT_ACCOUNT_NUMBER = exports.HUBTEL_ACCOUNT_ID = exports.HUBTEL_API_KEY = void 0;
exports.isHubtelConfigured = isHubtelConfigured;
exports.initiateCheckout = initiateCheckout;
exports.verifyStatus = verifyStatus;
/**
 * Hubtel Online Checkout API client (outbound calls only).
 * Ported from the proven implementation in the bms.codeslaw repo.
 *
 * Auth: HTTP Basic, base64("<ACCOUNT_ID>:<API_KEY>").
 * Status checks use the PUBLIC rmsc.hubtel.com endpoint (no IP whitelisting required).
 */
const params_1 = require("firebase-functions/params");
const helpers_1 = require("./helpers");
exports.HUBTEL_API_KEY = (0, params_1.defineSecret)('HUBTEL_API_KEY');
exports.HUBTEL_ACCOUNT_ID = (0, params_1.defineSecret)('HUBTEL_ACCOUNT_ID');
exports.HUBTEL_MERCHANT_ACCOUNT_NUMBER = (0, params_1.defineSecret)('HUBTEL_MERCHANT_ACCOUNT_NUMBER');
/** Bind this on any function that makes outbound Hubtel calls. */
exports.HUBTEL_SECRETS = [
    exports.HUBTEL_API_KEY,
    exports.HUBTEL_ACCOUNT_ID,
    exports.HUBTEL_MERCHANT_ACCOUNT_NUMBER,
];
const CHECKOUT_URL = 'https://payproxyapi.hubtel.com/items/initiate';
const STATUS_BASE = 'https://rmsc.hubtel.com/v1/merchantaccount/merchants';
function creds() {
    return {
        apiKey: (0, helpers_1.stripQuotes)(exports.HUBTEL_API_KEY.value() || ''),
        accountId: (0, helpers_1.stripQuotes)(exports.HUBTEL_ACCOUNT_ID.value() || ''),
        merchant: (0, helpers_1.stripQuotes)(exports.HUBTEL_MERCHANT_ACCOUNT_NUMBER.value() || ''),
    };
}
function isHubtelConfigured() {
    const c = creds();
    return !!(c.apiKey && c.accountId && c.merchant);
}
function authHeaders() {
    const c = creds();
    const auth = Buffer.from(`${c.accountId}:${c.apiKey}`).toString('base64');
    return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
}
/** POST /items/initiate — create a checkout and return the payable URLs. */
async function initiateCheckout(args) {
    var _a;
    if (!isHubtelConfigured()) {
        throw new Error('Hubtel is not configured (missing API key/account/merchant)');
    }
    const c = creds();
    const payload = {
        totalAmount: Number(args.amountGHS.toFixed(2)), // 2 decimals only, per docs
        description: args.description,
        callbackUrl: args.callbackUrl,
        returnUrl: args.returnUrl,
        merchantAccountNumber: c.merchant,
        cancellationUrl: args.cancellationUrl || args.returnUrl,
        clientReference: args.reference,
    };
    if (args.payeeName)
        payload.payeeName = args.payeeName;
    if (args.payeeEmail)
        payload.payeeEmail = args.payeeEmail;
    if (args.payeeMobileNumber)
        payload.payeeMobileNumber = args.payeeMobileNumber;
    const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!text)
        throw new Error('Hubtel returned an empty response');
    let result;
    try {
        result = JSON.parse(text);
    }
    catch (_b) {
        throw new Error(`Hubtel returned an invalid response (HTTP ${res.status})`);
    }
    if (result.responseCode !== '0000' || result.status !== 'Success') {
        throw new Error(result.message ||
            ((_a = result.data) === null || _a === void 0 ? void 0 : _a.message) ||
            'Failed to initialize Hubtel checkout');
    }
    const data = result.data;
    return {
        checkoutId: data.checkoutId,
        checkoutUrl: data.checkoutUrl,
        checkoutDirectUrl: data.checkoutDirectUrl,
        clientReference: data.clientReference,
    };
}
/**
 * GET status by clientReference — authoritative source of truth.
 * Uses the public rmsc.hubtel.com endpoint (no IP whitelisting).
 */
async function verifyStatus(reference) {
    var _a;
    if (!isHubtelConfigured()) {
        throw new Error('Hubtel is not configured (missing API key/account/merchant)');
    }
    const c = creds();
    const url = `${STATUS_BASE}/${c.merchant}/transactions/status?clientReference=${encodeURIComponent(reference)}`;
    const res = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Hubtel status check failed: ${res.status} ${errText.slice(0, 200)}`);
    }
    const text = await res.text();
    let result = {};
    try {
        result = text ? JSON.parse(text) : {};
    }
    catch (_b) {
        // leave result empty — handled below
    }
    // Tolerate camelCase vs PascalCase and the txn living under data/Data or at the top.
    const root = (0, helpers_1.lowerKeys)(result);
    const data = (0, helpers_1.lowerKeys)((_a = root.data) !== null && _a !== void 0 ? _a : result);
    const rawStatus = data.status;
    if (!rawStatus) {
        return { reference, status: 'PENDING', rawStatus: '', amountGHS: 0, currency: 'GHS' };
    }
    const amount = Number(data.amount) || 0;
    return {
        reference: data.clientreference || reference,
        transactionId: data.transactionid,
        status: (0, helpers_1.mapHubtelStatus)(rawStatus),
        rawStatus: String(rawStatus),
        amountGHS: amount,
        currency: data.currencycode || 'GHS',
        channel: data.paymentmethod,
        charges: data.charges == null ? undefined : Number(data.charges),
        paidAt: data.date ? new Date(data.date) : undefined,
    };
}
//# sourceMappingURL=hubtelClient.js.map