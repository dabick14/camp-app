"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHANGED_TEMPLATE = exports.DEFAULT_ASSIGNED_TEMPLATE = exports.DEFAULT_SENDER_ID = void 0;
exports.firstNameOf = firstNameOf;
exports.renderTemplate = renderTemplate;
exports.DEFAULT_SENDER_ID = 'FLGALATIANS';
exports.DEFAULT_ASSIGNED_TEMPLATE = "Hi {FirstName}, you've been assigned to Room {RoomNumber} for {CampName}. See you there!";
exports.DEFAULT_CHANGED_TEMPLATE = "Hi {FirstName}, your room for {CampName} has changed. You're now in Room {RoomNumber}.";
function firstNameOf(fullName) {
    var _a;
    return (_a = fullName.trim().split(/\s+/)[0]) !== null && _a !== void 0 ? _a : fullName;
}
function renderTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match);
}
//# sourceMappingURL=templates.js.map