"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onRoomAssigned = exports.bmsApiKey = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const firestore_2 = require("firebase-admin/firestore");
const smsService_1 = require("./sms/smsService");
const templates_1 = require("./sms/templates");
exports.bmsApiKey = (0, params_1.defineSecret)('BMS_API_KEY');
// Sends the room-assignment/room-change text. Fires only when roomId
// actually changes on a participant doc — comparing before/after here (not
// relying on which client wrote the doc) is what makes this exactly-once
// regardless of re-renders, retries, or unrelated field edits that also
// happen to touch the participant doc.
exports.onRoomAssigned = (0, firestore_1.onDocumentUpdated)({ document: 'camps/{campId}/participants/{participantId}', secrets: [exports.bmsApiKey] }, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    if (!event.data)
        return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    const beforeRoomId = (_a = before.roomId) !== null && _a !== void 0 ? _a : null;
    const afterRoomId = (_b = after.roomId) !== null && _b !== void 0 ? _b : null;
    // Only a genuine assignment or reassignment fires a text: a brand-new
    // roomId (was empty) or a changed one (was set, now different). Room
    // clears (unassign) and no-op resaves of the same roomId are ignored.
    if (!afterRoomId || afterRoomId === beforeRoomId)
        return;
    const trigger = beforeRoomId ? 'ROOM_CHANGED' : 'ROOM_ASSIGNED';
    const { campId, participantId } = event.params;
    const db = (0, firestore_2.getFirestore)();
    const campSnap = await db.doc(`camps/${campId}`).get();
    const camp = (_c = campSnap.data()) !== null && _c !== void 0 ? _c : {};
    const smsSettings = (_d = camp.smsSettings) !== null && _d !== void 0 ? _d : {};
    const template = trigger === 'ROOM_ASSIGNED'
        ? (((_e = smsSettings.assignedTemplate) === null || _e === void 0 ? void 0 : _e.trim()) || templates_1.DEFAULT_ASSIGNED_TEMPLATE)
        : (((_f = smsSettings.changedTemplate) === null || _f === void 0 ? void 0 : _f.trim()) || templates_1.DEFAULT_CHANGED_TEMPLATE);
    const message = (0, templates_1.renderTemplate)(template, {
        FirstName: (0, templates_1.firstNameOf)((_g = after.fullName) !== null && _g !== void 0 ? _g : ''),
        RoomNumber: (_h = after.roomNumber) !== null && _h !== void 0 ? _h : '',
        RoomType: (_j = after.roomTypePreferenceName) !== null && _j !== void 0 ? _j : '',
        CampName: (_k = camp.name) !== null && _k !== void 0 ? _k : '',
    });
    await (0, smsService_1.sendSms)({
        db,
        campId,
        participantId,
        phone: (_l = after.phone) !== null && _l !== void 0 ? _l : '',
        trigger,
        message,
        triggeredBy: 'system',
        apiKey: exports.bmsApiKey.value(),
        senderId: ((_m = smsSettings.senderId) === null || _m === void 0 ? void 0 : _m.trim()) || templates_1.DEFAULT_SENDER_ID,
        enabled: smsSettings.enabled === true,
        // event.id uniquely identifies this exact trigger delivery — used as
        // the send log's doc id so a retried/redelivered event is a no-op.
        logId: event.id,
    });
});
//# sourceMappingURL=onRoomAssigned.js.map