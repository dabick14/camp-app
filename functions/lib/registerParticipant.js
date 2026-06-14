"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerParticipant = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
exports.registerParticipant = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
    var _a, _b, _c, _d;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const data = req.body;
    const { campId, fullName, phone, gender, subGroupId, roomTypePreferenceId } = data;
    const acknowledged = (_a = data.acknowledgedDuplicates) !== null && _a !== void 0 ? _a : [];
    if (!campId || !(fullName === null || fullName === void 0 ? void 0 : fullName.trim()) || !(phone === null || phone === void 0 ? void 0 : phone.trim()) || !gender || !subGroupId || !roomTypePreferenceId) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }
    if (gender !== 'M' && gender !== 'F') {
        res.status(400).json({ error: 'gender must be M or F' });
        return;
    }
    try {
        const db = (0, firestore_1.getFirestore)();
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
        // Age gate
        if (camp.minAge != null || camp.maxAge != null) {
            let computedAge = null;
            if (data.dateOfBirth) {
                const dob = new Date(`${data.dateOfBirth}T12:00:00Z`);
                const campStart = camp.startDate.toDate();
                computedAge = Math.floor((campStart.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
            }
            else if (data.age != null) {
                computedAge = data.age;
            }
            if (computedAge !== null) {
                if (camp.minAge != null && computedAge < camp.minAge) {
                    res.status(400).json({
                        error: 'AGE_BELOW_MIN',
                        message: `This camp has a minimum age of ${camp.minAge}. Please contact the organizers if this is an error.`,
                    });
                    return;
                }
                if (camp.maxAge != null && computedAge > camp.maxAge) {
                    res.status(400).json({
                        error: 'AGE_EXCEEDED',
                        message: `This camp has a maximum age of ${camp.maxAge}. Please contact the organizers if this is an error.`,
                    });
                    return;
                }
            }
        }
        const participantsRef = db.collection(`camps/${campId}/participants`);
        // Layer 1: Phone hard block — non-acknowledgeable for public form
        const phoneSnap = await participantsRef
            .where('phone', '==', phone.trim())
            .limit(5)
            .get();
        const phoneExists = phoneSnap.docs.some((d) => d.data().registrationState === 'REGISTERED');
        if (phoneExists) {
            res.status(400).json({
                error: 'DUPLICATE_PHONE',
                message: 'This phone number is already registered. If you registered before, contact your council leader.',
            });
            return;
        }
        // Layer 2: Name + DOB soft check (only if DOB provided)
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
                    message: 'Someone with the same name and date of birth is already registered. If this is not you, click Register anyway.',
                });
                return;
            }
        }
        // Layer 3: Email soft check
        if (!acknowledged.includes('DUPLICATE_EMAIL') && ((_b = data.email) === null || _b === void 0 ? void 0 : _b.trim())) {
            const emailLower = data.email.trim().toLowerCase();
            const emailSnap = await participantsRef
                .where('emailLower', '==', emailLower)
                .limit(5)
                .get();
            const emailExists = emailSnap.docs.some((d) => d.data().registrationState === 'REGISTERED');
            if (emailExists) {
                res.status(409).json({
                    error: 'DUPLICATE_EMAIL',
                    message: 'This email address is already registered. If this is not you, click Register anyway.',
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
            updatedBy: 'self',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if ((_c = data.email) === null || _c === void 0 ? void 0 : _c.trim()) {
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
            currency: (_d = camp.currency) !== null && _d !== void 0 ? _d : 'GHS',
            campName: camp.name,
        });
    }
    catch (err) {
        console.error('registerParticipant error:', err);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});
//# sourceMappingURL=registerParticipant.js.map