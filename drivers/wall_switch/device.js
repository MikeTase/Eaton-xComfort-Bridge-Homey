"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class WallSwitchDevice extends homey_1.default.Device {
    constructor() {
        super(...arguments);
        this.bridge = null;
        this.triggerPressed = null;
    }
    async onInit() {
        this.log('WallSwitchDevice init:', this.getName());
        const app = this.homey.app;
        this.bridge = app.getBridge();
        if (!this.bridge) {
            this.setUnavailable('Bridge not connected');
            return;
        }
        // Register Flow Trigger
        // Ensure you define this in app.json if you want it visible, 
        // or use standard capability triggers if capabilities are used.
        // For now we assume a custom trigger 'switch_pressed'.
        // this.triggerPressed = this.homey.flow.getDeviceTriggerCard('switch_pressed');
        this.bridge.on('state_update', (data) => {
            if (String(data.deviceId) === String(this.getData().id)) {
                this.log('Switch Event:', data);
                // Trigger flow
                if (this.triggerPressed) {
                    this.triggerPressed.trigger(this, {}, { event: JSON.stringify(data) })
                        .catch(this.error);
                }
            }
        });
    }
};
