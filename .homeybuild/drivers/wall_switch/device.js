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
        // Dependency injection: allow bridge to be passed in for testing or advanced use
        this.bridge = ((_a = app.getBridge) === null || _a === void 0 ? void 0 : _a.call(app)) || app.bridge;
        if (!this.bridge) {
            this.setUnavailable('Bridge not connected');
            return;
        }
        // Register Flow Trigger
        // Ensure you define this in app.json if you want it visible, 
        // or use standard capability triggers if capabilities are used.
        // For now we assume a custom trigger 'switch_pressed'.
        this.triggerPressed = this.homey.flow.getDeviceTriggerCard('wall_switch_pressed');
        this.bridge.on('state_update', (items) => {
            const updates = Array.isArray(items) ? items : [items];
            const update = updates.find((d) => String(d.deviceId) === String(this.getData().deviceId));
            if (update) {
                this.log('Switch Event:', update);
                // Trigger flow
                if (this.triggerPressed) {
                    this.triggerPressed.trigger(this, {}, { event: JSON.stringify(update) })
                        .catch(this.error);
                }
            }
        });
    }
};
