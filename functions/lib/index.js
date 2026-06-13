"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerParticipant = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
// HTTP function — cors: true handles the OPTIONS preflight via cors middleware
// before any function code runs, which is more reliable than onCall's built-in handling.
exports.registerParticipant = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
    var _a, _b, _c, _d;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const data = req.body;
    const { campId, fullName, phone, gender, subGroupId, roomTypePreferenceId } = data;
    if (!campId || !(fullName === null || fullName === void 0 ? void 0 : fullName.trim()) || !(phone === null || phone === void 0 ? void 0 : phone.trim()) || !gender || !subGroupId || !roomTypePreferenceId) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    if (gender !== 'M' && gender !== 'F') {
        res.status(400).json({ error: 'gender must be M or F' });
        return;
    }
    try {
        const campSnap = await db.doc(`camps/${campId}`).get();
        if (!campSnap.exists) {
            res.status(404).json({ error: 'Camp not found' });
            return;
        }
        const camp = campSnap.data();
        if (!camp.registrationOpen) {
            res.status(400).json({ error: 'Registration is closed for this camp' });
            return;
        }
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
            updatedBy: 'self',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if ((_a = data.email) === null || _a === void 0 ? void 0 : _a.trim())
            participant.email = data.email.trim();
        if (data.dateOfBirth) {
            participant.dateOfBirth = firestore_1.Timestamp.fromDate(new Date(`${data.dateOfBirth}T12:00:00Z`));
        }
        if (data.age != null)
            participant.age = data.age;
        if ((_b = data.emergencyContactName) === null || _b === void 0 ? void 0 : _b.trim())
            participant.emergencyContactName = data.emergencyContactName.trim();
        if ((_c = data.emergencyContactPhone) === null || _c === void 0 ? void 0 : _c.trim())
            participant.emergencyContactPhone = data.emergencyContactPhone.trim();
        const ref = await db.collection(`camps/${campId}/participants`).add(participant);
        res.json({
            participantId: ref.id,
            fullName: participant.fullName,
            subGroupName,
            roomTypePreferenceName,
            feeOwed,
            currency: (_d = camp.currency) !== null && _d !== void 0 ? _d : 'GHS',
            campName: camp.name,
        });
    }
    catch (err) {
        console.error('registerParticipant error:', err);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});
//# sourceMappingURL=index.js.map