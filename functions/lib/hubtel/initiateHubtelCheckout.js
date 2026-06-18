"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiateHubtelCheckout = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const hubtelClient_1 = require("./hubtelClient");
const reference_1 = require("./reference");
const constants_1 = require("./constants");
/**
 * Admin-only. Creates a pending hubtelTransactions session + a top-level reference
 * pointer, then initiates a Hubtel checkout and returns the payable URLs so the admin
 * can complete payment in-app (onsite/iframe). Confirmation happens later via the
 * callback or the verify poll — never here.
 */
exports.initiateHubtelCheckout = (0, https_1.onRequest)({ cors: true, secrets: hubtelClient_1.HUBTEL_SECRETS }, async (req, res) => {
    var _a;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const authHeader = req.headers.authorization;
    if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer '))) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    let uid;
    try {
        uid = (await (0, auth_1.getAuth)().verifyIdToken(authHeader.slice(7))).uid;
    }
    catch (_b) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        res.status(403).json({ error: 'Not an admin' });
        return;
    }
    const body = req.body || {};
    const { campId, subGroupId, amountGHS } = body;
    if (!campId ||
        !subGroupId ||
        typeof amountGHS !== 'number' ||
        !Number.isFinite(amountGHS) ||
        amountGHS <= 0) {
        res.status(400).json({ error: 'Missing or invalid fields' });
        return;
    }
    try {
        const campSnap = await db.doc(`camps/${campId}`).get();
        if (!campSnap.exists) {
            res.status(404).json({ error: 'Camp not found' });
            return;
        }
        const subGroupSnap = await db
            .doc(`camps/${campId}/subGroups/${subGroupId}`)
            .get();
        if (!subGroupSnap.exists) {
            res.status(404).json({ error: 'Sub-group not found' });
            return;
        }
        const subGroupName = subGroupSnap.data().name;
        const description = ((_a = body.description) === null || _a === void 0 ? void 0 : _a.trim()) || `Camp payment - ${subGroupName}`;
        const reference = (0, reference_1.generateReference)();
        const sessionRef = db.doc(`camps/${campId}/hubtelTransactions/${reference}`);
        await sessionRef.set({
            reference,
            status: 'PENDING',
            amountExpected: amountGHS,
            amount: 0,
            subGroupId,
            subGroupName,
            description,
            createdBy: uid,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        // Top-level pointer so the public callback can resolve campId from the reference
        // alone, without a collection-group query.
        await db.doc(`hubtelReferences/${reference}`).set({
            campId,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const origin = typeof body.returnOrigin === 'string' && body.returnOrigin
            ? body.returnOrigin.replace(/\/$/, '')
            : constants_1.APP_BASE;
        const returnUrl = `${origin}/pay/return?reference=${reference}&campId=${campId}`;
        let result;
        try {
            result = await (0, hubtelClient_1.initiateCheckout)({
                amountGHS,
                description,
                reference,
                callbackUrl: constants_1.HUBTEL_CALLBACK_URL,
                returnUrl,
                payeeName: body.payeeName,
                payeeEmail: body.payeeEmail,
                payeeMobileNumber: body.payeePhone,
            });
        }
        catch (err) {
            await sessionRef
                .update({
                status: 'FAILED',
                error: err.message,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            })
                .catch(() => { });
            console.error('initiateHubtelCheckout init error:', err);
            res.status(502).json({ error: 'Failed to initialize Hubtel checkout' });
            return;
        }
        await sessionRef.update({
            checkoutId: result.checkoutId,
            checkoutUrl: result.checkoutUrl,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        res.json({
            reference,
            checkoutId: result.checkoutId,
            checkoutUrl: result.checkoutUrl,
            checkoutDirectUrl: result.checkoutDirectUrl,
        });
    }
    catch (err) {
        console.error('initiateHubtelCheckout error:', err);
        res.status(500).json({ error: 'Failed to initialize checkout' });
    }
});
//# sourceMappingURL=initiateHubtelCheckout.js.map