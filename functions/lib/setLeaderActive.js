"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLeaderActive = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
exports.setLeaderActive = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
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
    catch (_a) {
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
    const { uid, active } = data;
    if (!uid || typeof active !== 'boolean') {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    try {
        const leaderRef = db.doc(`leaders/${uid}`);
        const leaderSnap = await leaderRef.get();
        if (!leaderSnap.exists) {
            res.status(404).json({ error: 'Leader not found' });
            return;
        }
        const leader = leaderSnap.data();
        if (active) {
            // Re-check the one-active-leader-per-sub-group rule. Reactivation is
            // the same hazard provisionLeader's create-time check guards against —
            // both result in an additional active leader for a sub-group — so it
            // needs the identical server-side query, not just a flip.
            const activeLeaderSnap = await db
                .collection('leaders')
                .where('campId', '==', leader.campId)
                .where('subGroupId', '==', leader.subGroupId)
                .where('active', '==', true)
                .get();
            const hasOtherActiveLeader = activeLeaderSnap.docs.some((d) => d.id !== uid);
            if (hasOtherActiveLeader) {
                res.status(409).json({
                    error: 'SUBGROUP_HAS_ACTIVE_LEADER',
                    message: `${leader.subGroupName} already has an active leader. Deactivate them first.`,
                });
                return;
            }
        }
        await leaderRef.update({
            active,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: callerUid,
        });
        res.json({ uid, active, subGroupName: leader.subGroupName });
    }
    catch (err) {
        console.error('setLeaderActive error:', err);
        res.status(500).json({ error: 'Failed to update leader. Please try again.' });
    }
});
//# sourceMappingURL=setLeaderActive.js.map