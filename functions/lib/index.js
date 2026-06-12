"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerParticipant = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
exports.registerParticipant = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d;
    const data = request.data;
    // Validate required fields
    const { campId, fullName, phone, gender, subGroupId, roomTypePreferenceId } = data;
    if (!campId || !(fullName === null || fullName === void 0 ? void 0 : fullName.trim()) || !(phone === null || phone === void 0 ? void 0 : phone.trim()) || !gender || !subGroupId || !roomTypePreferenceId) {
        throw new https_1.HttpsError('invalid-argument', 'Missing required fields');
    }
    if (gender !== 'M' && gender !== 'F') {
        throw new https_1.HttpsError('invalid-argument', 'gender must be M or F');
    }
    // Load camp — verify exists and registration is open
    const campSnap = await db.doc(`camps/${campId}`).get();
    if (!campSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Camp not found');
    }
    const camp = campSnap.data();
    if (!camp.registrationOpen) {
        throw new https_1.HttpsError('failed-precondition', 'Registration is closed for this camp');
    }
    // Load sub-group
    const subGroupSnap = await db.doc(`camps/${campId}/subGroups/${subGroupId}`).get();
    if (!subGroupSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Sub-group not found');
    }
    const subGroupName = subGroupSnap.data().name;
    // Load room type — price at this moment becomes feeOwed
    const roomTypeSnap = await db.doc(`camps/${campId}/roomTypes/${roomTypePreferenceId}`).get();
    if (!roomTypeSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Room type not found');
    }
    const roomTypeData = roomTypeSnap.data();
    const roomTypePreferenceName = roomTypeData.name;
    const feeOwed = roomTypeData.price;
    // Build participant doc — omit undefined-valued optional fields
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
        // Store as UTC noon to avoid timezone boundary issues
        participant.dateOfBirth = firestore_1.Timestamp.fromDate(new Date(`${data.dateOfBirth}T12:00:00Z`));
    }
    if (data.age != null)
        participant.age = data.age;
    if ((_b = data.emergencyContactName) === null || _b === void 0 ? void 0 : _b.trim())
        participant.emergencyContactName = data.emergencyContactName.trim();
    if ((_c = data.emergencyContactPhone) === null || _c === void 0 ? void 0 : _c.trim())
        participant.emergencyContactPhone = data.emergencyContactPhone.trim();
    const ref = await db.collection(`camps/${campId}/participants`).add(participant);
    return {
        participantId: ref.id,
        fullName: participant.fullName,
        subGroupName,
        roomTypePreferenceName,
        feeOwed,
        currency: (_d = camp.currency) !== null && _d !== void 0 ? _d : 'GHS',
        campName: camp.name,
    };
});
//# sourceMappingURL=index.js.map