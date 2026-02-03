"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class WallSwitchDevice extends homey_1.default.Device {
    constructor() {
        super(...arguments);
        this.triggerPressed = null;
    }
    async onInit() {
        var _a;
        this.log('WallSwitchDevice init:', this.getName());
        const app = this.homey.app;
        this.bridge = ((_a = app.getBridge) === null || _a === void 0 ? void 0 : _a.call(app)) || app.bridge;
        if (!this.bridge) {
            this.setUnavailable('Bridge not connected');
            return;
        }
        // Register Flow Trigger
        this.triggerPressed = this.homey.flow.getDeviceTriggerCard('wall_switch_pressed');
        this.onDeviceUpdate = (deviceId, state) => {
            // Only verify this update belongs to this device (redundant with listener registration but safe)
            if (String(deviceId) === String(this.getData().deviceId)) {
                this.log('Switch Event:', state);
                if (this.triggerPressed) {
                    // Determine what data to pass to tokens.
                    // Assuming tokens might be { state: boolean } or similar based on driver.json
                    this.triggerPressed.trigger(this, {}, { event: JSON.stringify(state) })
                        .catch(this.error);
                }
            }
        };
        // Register listener for this specific device
        this.bridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
    }
    onDeleted() {
        if (this.bridge && this.onDeviceUpdate) {
            this.bridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
            this.log('WallSwitchDevice listener removed');
        }
    }
};
