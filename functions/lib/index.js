"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAddParticipant = exports.registerParticipant = void 0;
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
var registerParticipant_1 = require("./registerParticipant");
Object.defineProperty(exports, "registerParticipant", { enumerable: true, get: function () { return registerParticipant_1.registerParticipant; } });
var adminAddParticipant_1 = require("./adminAddParticipant");
Object.defineProperty(exports, "adminAddParticipant", { enumerable: true, get: function () { return adminAddParticipant_1.adminAddParticipant; } });
//# sourceMappingURL=index.js.map