"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageType = void 0;
var MessageType;
(function (MessageType) {
    /* Keep Alive */
    MessageType[MessageType["ACK"] = 1] = "ACK";
    MessageType[MessageType["HEARTBEAT"] = 2] = "HEARTBEAT";
    /* Connection */
    MessageType[MessageType["CONNECTION_START"] = 10] = "CONNECTION_START";
    MessageType[MessageType["CONNECTION_CONFIRM"] = 11] = "CONNECTION_CONFIRM";
    /* Handshake */
    MessageType[MessageType["SC_INIT"] = 14] = "SC_INIT";
    MessageType[MessageType["SC_PUBLIC_KEY"] = 15] = "SC_PUBLIC_KEY";
    MessageType[MessageType["SC_CLIENT_KEY"] = 16] = "SC_CLIENT_KEY";
    MessageType[MessageType["SC_ACK"] = 17] = "SC_ACK";
    /* Auth */
    MessageType[MessageType["LOGIN"] = 30] = "LOGIN";
    MessageType[MessageType["LOGIN_OK"] = 31] = "LOGIN_OK";
    MessageType[MessageType["LOGIN_RESPONSE"] = 32] = "LOGIN_RESPONSE";
    /* Discovery */
    MessageType[MessageType["REQUEST_DEVICES"] = 240] = "REQUEST_DEVICES";
    MessageType[MessageType["REQUEST_ROOMS"] = 242] = "REQUEST_ROOMS";
    MessageType[MessageType["SET_ALL_DATA"] = 300] = "SET_ALL_DATA";
    /* Control */
    MessageType[MessageType["ACTION_SLIDE_DEVICE"] = 280] = "ACTION_SLIDE_DEVICE";
    MessageType[MessageType["ACTION_SWITCH_DEVICE"] = 281] = "ACTION_SWITCH_DEVICE";
    /* Events */
    MessageType[MessageType["SET_DEVICE_STATE"] = 291] = "SET_DEVICE_STATE";
    MessageType[MessageType["SET_STATE_INFO"] = 310] = "SET_STATE_INFO";
})(MessageType || (exports.MessageType = MessageType = {}));
