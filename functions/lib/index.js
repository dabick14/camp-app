"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLeaderActive = exports.leaderRegisterParticipant = exports.provisionLeader = exports.adminAddParticipant = void 0;
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
var adminAddParticipant_1 = require("./adminAddParticipant");
Object.defineProperty(exports, "adminAddParticipant", { enumerable: true, get: function () { return adminAddParticipant_1.adminAddParticipant; } });
var provisionLeader_1 = require("./provisionLeader");
Object.defineProperty(exports, "provisionLeader", { enumerable: true, get: function () { return provisionLeader_1.provisionLeader; } });
var leaderRegisterParticipant_1 = require("./leaderRegisterParticipant");
Object.defineProperty(exports, "leaderRegisterParticipant", { enumerable: true, get: function () { return leaderRegisterParticipant_1.leaderRegisterParticipant; } });
var setLeaderActive_1 = require("./setLeaderActive");
Object.defineProperty(exports, "setLeaderActive", { enumerable: true, get: function () { return setLeaderActive_1.setLeaderActive; } });
//# sourceMappingURL=index.js.map