"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provisionLeader = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
// Firebase Web API key (same value as VITE_FIREBASE_API_KEY in the client
// bundle — Firebase Web API keys are not secret by design, they're meant to
// ship in client code). Needed to trigger Identity Toolkit's hosted
// password-reset email; the Admin SDK can generate a reset link but has no
// equivalent for actually sending it.
// Read from env (functions/.env, gitignored) rather than hardcoded — not
// because this value is sensitive, but to stop literal API-key strings from
// sitting in source and tripping secret scanners. See functions/.env.example.
const WEB_API_KEY = process.env.WEB_API_KEY;
exports.provisionLeader = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
    var _a, _b;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const authHeader = req.headers.authorization;
    if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer '))) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const idToken = authHeader.slice(7);
    let callerUid;
    try {
        const decoded = await (0, auth_1.getAuth)().verifyIdToken(idToken);
        callerUid = decoded.uid;
    }
    catch (_c) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const callerAdminSnap = await db.doc(`admins/${callerUid}`).get();
    if (!callerAdminSnap.exists) {
        res.status(403).json({ error: 'Not an admin' });
        return;
    }
    const data = req.body;
    const { campId, subGroupId } = data;
    const email = (_a = data.email) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase();
    const displayName = (_b = data.displayName) === null || _b === void 0 ? void 0 : _b.trim();
    if (!campId || !email || !subGroupId) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Enter a valid email address' });
        return;
    }
    if (!WEB_API_KEY) {
        console.error('provisionLeader: WEB_API_KEY env var is not set — see functions/.env.example');
        res.status(500).json({ error: 'Server misconfiguration. Please contact support.' });
        return;
    }
    try {
        const subGroupSnap = await db.doc(`camps/${campId}/subGroups/${subGroupId}`).get();
        if (!subGroupSnap.exists) {
            res.status(404).json({ error: 'Sub-group not found' });
            return;
        }
        const subGroupName = subGroupSnap.data().name;
        // Server-side re-check — the client's exclusion list in the sub-group
        // picker is UX only. This is the actual enforcement point.
        const activeLeaderSnap = await db
            .collection('leaders')
            .where('campId', '==', campId)
            .where('subGroupId', '==', subGroupId)
            .where('active', '==', true)
            .limit(1)
            .get();
        if (!activeLeaderSnap.empty) {
            res.status(409).json({
                error: 'SUBGROUP_HAS_ACTIVE_LEADER',
                message: `${subGroupName} already has an active leader. Deactivate them first.`,
            });
            return;
        }
        // Find or create the Firebase Auth account for this email.
        let uid;
        try {
            const existing = await (0, auth_1.getAuth)().getUserByEmail(email);
            uid = existing.uid;
        }
        catch (err) {
            if (err.code !== 'auth/user-not-found')
                throw err;
            const created = await (0, auth_1.getAuth)().createUser({
                email,
                displayName: displayName || undefined,
                emailVerified: false,
            });
            uid = created.uid;
        }
        // Guard against the admin/leader collision useUserRole() warns about —
        // refuse to double-provision an existing admin as a leader too.
        const existingAdminSnap = await db.doc(`admins/${uid}`).get();
        if (existingAdminSnap.exists) {
            res.status(409).json({
                error: 'EMAIL_IS_ADMIN',
                message: 'This email belongs to an existing admin account and cannot also be a leader.',
            });
            return;
        }
        const leaderRef = db.doc(`leaders/${uid}`);
        const leaderSnap = await leaderRef.get();
        const leaderData = {
            email,
            campId,
            subGroupId,
            subGroupName,
            active: true,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: callerUid,
        };
        if (displayName)
            leaderData.displayName = displayName;
        if (leaderSnap.exists) {
            // Re-provisioning a previously deactivated leader record.
            await leaderRef.update(leaderData);
        }
        else {
            leaderData.createdAt = firestore_1.FieldValue.serverTimestamp();
            leaderData.createdBy = callerUid;
            await leaderRef.set(leaderData);
        }
        // Trigger Firebase's hosted "set your password" email — same flow as
        // /login/reset, just admin-initiated instead of self-service.
        await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${WEB_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
        });
        res.json({ uid, email, subGroupName });
    }
    catch (err) {
        console.error('provisionLeader error:', err);
        res.status(500).json({ error: 'Failed to provision leader. Please try again.' });
    }
});
//# sourceMappingURL=provisionLeader.js.map