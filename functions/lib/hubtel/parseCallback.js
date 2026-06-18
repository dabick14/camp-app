"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCallback = parseCallback;
const helpers_1 = require("./helpers");
const normalizePhone_1 = require("./normalizePhone");
/**
 * Parse + normalize a Hubtel checkout callback into our internal shape.
 * Returns null if the payload has no Data block or no client reference
 * (nothing we can act on). Pure — no Firebase, no network.
 */
function parseCallback(payload) {
    var _a, _b;
    const data = ((payload === null || payload === void 0 ? void 0 : payload.Data) || (payload === null || payload === void 0 ? void 0 : payload.data));
    if (!data)
        return null;
    const reference = data.ClientReference || data.clientReference;
    if (!reference)
        return null;
    const rawStatus = data.Status || data.status || payload.Status || '';
    const amountRaw = (_b = (_a = data.Amount) !== null && _a !== void 0 ? _a : data.amount) !== null && _b !== void 0 ? _b : 0;
    const amount = Number(amountRaw);
    const pd = data.PaymentDetails || data.paymentDetails || {};
    return {
        reference: String(reference),
        checkoutId: data.CheckoutId || data.checkoutId || data.SalesInvoiceId,
        amountGHS: Number.isFinite(amount) ? amount : 0,
        status: (0, helpers_1.mapHubtelStatus)(String(rawStatus)),
        rawStatus: String(rawStatus),
        senderPhone: (0, normalizePhone_1.normalizePhone)(data.CustomerPhoneNumber ||
            data.customerPhoneNumber ||
            pd.MobileMoneyNumber ||
            pd.mobileMoneyNumber),
        channel: pd.PaymentType || pd.paymentType,
        channelProvider: pd.Channel || pd.channel,
        description: data.Description || data.description,
    };
}
//# sourceMappingURL=parseCallback.js.map