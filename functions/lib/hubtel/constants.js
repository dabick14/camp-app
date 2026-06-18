"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUBTEL_CALLBACK_URL = exports.APP_BASE = exports.FUNCTIONS_BASE = void 0;
/**
 * Deployment constants. The Cloud Functions live in the default us-central1 region
 * of the `camp-app-119bb` project; the SPA is served from Firebase Hosting.
 *
 * These are not secret. The callback URL is what we hand to Hubtel at init time; the
 * app base is only a fallback for the post-payment return URL (the client normally
 * passes its own origin so this works across preview/hosting domains).
 */
exports.FUNCTIONS_BASE = 'https://us-central1-camp-app-119bb.cloudfunctions.net';
exports.APP_BASE = 'https://camp-app-119bb.web.app';
exports.HUBTEL_CALLBACK_URL = `${exports.FUNCTIONS_BASE}/hubtelPaymentCallback`;
//# sourceMappingURL=constants.js.map