"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAddParticipant = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
exports.adminAddParticipant = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
    var _a, _b, _c, _d, _e;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    // Verify auth token
    const authHeader = req.headers.authorization;
    if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer '))) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const idToken = authHeader.slice(7);
    let uid;
    let displayName;
    try {
        const decoded = await (0, auth_1.getAuth)().verifyIdToken(idToken);
        uid = decoded.uid;
        displayName = (_a = decoded.email) !== null && _a !== void 0 ? _a : uid;
    }
    catch (_f) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    // Verify admin
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        res.status(403).json({ error: 'Not an admin' });
        return;
    }
    const data = req.body;
    const { campId, fullName, phone, gender, subGroupId, roomTypePreferenceId } = data;
    const acknowledged = (_b = data.acknowledgedDuplicates) !== null && _b !== void 0 ? _b : [];
    if (!campId || !(fullName === null || fullName === void 0 ? void 0 : fullName.trim()) || !(phone === null || phone === void 0 ? void 0 : phone.trim()) || !gender || !subGroupId || !roomTypePreferenceId) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    if (gender !== 'M' && gender !== 'F') {
        res.status(400).json({ error: 'gender must be M or F' });
        return;
    }
    try {
        // Camp — no registrationOpen check for admin
        const campSnap = await db.doc(`camps/${campId}`).get();
        if (!campSnap.exists) {
            res.status(404).json({ error: 'Camp not found' });
            return;
        }
        const camp = campSnap.data();
        const subGroupSnap = await db.doc(`camps/${campId}/subGroups/${subGroupId}`).get();
        if (!subGroupSnap.exists) {
            res.status(404).json({ error: 'Sub-group not found' });
            return;
        }
        const subGroupName = subGroupSnap.data().name;
        const roomTypeSnap = await db.doc(`camps/${campId}/roomTypes/${roomTypePreferenceId}`).get();
        if (!roomTypeSnap.exists) {
            res.status(404).json({ error: 'Room type not found' });
            return;
        }
        const roomTypeData = roomTypeSnap.data();
        const roomTypePreferenceName = roomTypeData.name;
        const feeOwed = roomTypeData.price;
        const participantsRef = db.collection(`camps/${campId}/participants`);
        // Layer 1: Phone — 409 for admin (acknowledgeable, not a hard block)
        if (!acknowledged.includes('DUPLICATE_PHONE')) {
            const phoneSnap = await participantsRef
                .where('phone', '==', phone.trim())
                .limit(5)
                .get();
            const phoneExists = phoneSnap.docs.some((d) => d.data().registrationState === 'REGISTERED');
            if (phoneExists) {
                res.status(409).json({
                    error: 'DUPLICATE_PHONE',
                    message: 'A participant with this phone number is already registered.',
                });
                return;
            }
        }
        // Layer 2: Name + DOB soft check
        if (!acknowledged.includes('DUPLICATE_NAME_DOB') && data.dateOfBirth) {
            const dobTs = firestore_1.Timestamp.fromDate(new Date(`${data.dateOfBirth}T12:00:00Z`));
            const dobSnap = await participantsRef
                .where('dateOfBirth', '==', dobTs)
                .limit(20)
                .get();
            const nameMatch = dobSnap.docs.some((d) => d.data().registrationState === 'REGISTERED' &&
                d.data().fullName.toLowerCase().trim() ===
                    fullName.trim().toLowerCase());
            if (nameMatch) {
                res.status(409).json({
                    error: 'DUPLICATE_NAME_DOB',
                    message: 'A participant with the same name and date of birth is already registered.',
                });
                return;
            }
        }
        // Layer 3: Email soft check
        if (!acknowledged.includes('DUPLICATE_EMAIL') && ((_c = data.email) === null || _c === void 0 ? void 0 : _c.trim())) {
            const emailLower = data.email.trim().toLowerCase();
            const emailSnap = await participantsRef
                .where('emailLower', '==', emailLower)
                .limit(5)
                .get();
            const emailExists = emailSnap.docs.some((d) => d.data().registrationState === 'REGISTERED');
            if (emailExists) {
                res.status(409).json({
                    error: 'DUPLICATE_EMAIL',
                    message: 'A participant with this email address is already registered.',
                });
                return;
            }
        }
        const participant = {
            fullName: fullName.trim(),
            phone: phone.trim(),
            gender,
            subGroupId,
            subGroupName,
            roomTypePreferenceId,
            roomTypePreferenceName,
            feeOwed,
            amountPaid: 0,
            registrationState: 'REGISTERED',
            checkInState: 'NOT_ARRIVED',
            tags: [],
            roomId: null,
            updatedBy: displayName,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if ((_d = data.email) === null || _d === void 0 ? void 0 : _d.trim()) {
            participant.email = data.email.trim();
            participant.emailLower = data.email.trim().toLowerCase();
        }
        if (data.dateOfBirth) {
            participant.dateOfBirth = firestore_1.Timestamp.fromDate(new Date(`${data.dateOfBirth}T12:00:00Z`));
        }
        if (data.age != null)
            participant.age = data.age;
        const ref = await participantsRef.add(participant);
        res.json({
            participantId: ref.id,
            fullName: participant.fullName,
            subGroupName,
            roomTypePreferenceName,
            feeOwed,
            currency: (_e = camp.currency) !== null && _e !== void 0 ? _e : 'GHS',
            campName: camp.name,
        });
    }
    catch (err) {
        console.error('adminAddParticipant error:', err);
        res.status(500).json({ error: 'Failed to add participant. Please try again.' });
    }
});
//# sourceMappingURL=adminAddParticipant.js.map