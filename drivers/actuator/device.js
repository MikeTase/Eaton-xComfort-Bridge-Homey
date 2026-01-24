"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class ActuatorDevice extends homey_1.default.Device {
    constructor() {
        super(...arguments);
        this.bridge = null;
    }
    async onInit() {
        this.log('ActuatorDevice init:', this.getName());
        const app = this.homey.app;
        this.bridge = app.getBridge();
        if (!this.bridge) {
            this.setUnavailable('Bridge not connected');
            return;
        }
        this.registerCapabilityListener('onoff', async (value) => {
            if (this.bridge) {
                await this.bridge.switchDevice(this.getData().id, value);
            }
        });
        this.registerCapabilityListener('dim', async (value) => {
            if (this.bridge) {
                // Homey dim is 0-1. xComfort is 1-99.
                // If dim is 0, we should switch OFF.
                if (value === 0) {
                    await this.bridge.switchDevice(this.getData().id, false);
                }
                else {
                    // Map 0-1 to 1-99
                    const dimValue = Math.max(1, Math.round(value * 99));
                    await this.bridge.dimDevice(this.getData().id, dimValue);
                }
            }
        });
        // Listen for updates
        this.bridge.on('state_update', (items) => {
            // Find update for this device
            const update = items.find((d) => String(d.deviceId) === String(this.getData().id));
            if (update) {
                this.log(`Received update for device ${this.getData().id}:`, update);
                if (typeof update.switch === 'boolean') {
                    this.setCapabilityValue('onoff', update.switch).catch(this.error);
                }
                if (typeof update.dimmvalue === 'number') {
                    // Map 0-99 to 0-1
                    const homeyDim = Math.max(0, Math.min(1, update.dimmvalue / 99));
                    this.setCapabilityValue('dim', homeyDim).catch(this.error);
                }
            }
        });
    }
};
