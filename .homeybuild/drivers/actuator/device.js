"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class ActuatorDevice extends homey_1.default.Device {
    async onInit() {
        this.log('ActuatorDevice init:', this.getName());
        // Check dimmable setting and remove dim capability if not applicable
        const settings = this.getSettings();
        // Check explicit flag OR check deviceType (100 = switch, 101 = dim)
        // If deviceType is 100, force non-dimmable even if settings said true previously
        let isDimmable = settings.dimmable !== false;
        if (settings.deviceType === 100) {
            isDimmable = false;
        }
        if (!isDimmable && this.hasCapability('dim')) {
            this.log('Device is not dimmable, removing dim capability');
            await this.removeCapability('dim').catch(this.error);
        }
        const app = this.homey.app;
        this.bridge = app.bridge;
        const hasCapability = (cap) => {
            return Array.isArray(this.capabilities) && this.capabilities.includes(cap);
        };
        if (!this.bridge) {
            this.setUnavailable('Bridge not connected');
            return;
        }
        const resolveDeviceId = () => {
            const rawId = this.getData().deviceId;
            const numericId = Number(rawId);
            return Number.isNaN(numericId) ? String(rawId) : numericId;
        };
        let lastSwitchCommandAt = null;
        let lastBridgeSendAt = null;
        this.onDeviceUpdate = (deviceId, state) => {
            try {
                const now = Date.now();
                if (lastSwitchCommandAt) {
                    const latency = now - lastSwitchCommandAt;
                    // console.log(`[Actuator] Latency: ${latency}ms from switch command to state update for ${this.getName()} (${this.getData().deviceId})`);
                }
                if (lastBridgeSendAt) {
                    const bridgeToUpdate = now - lastBridgeSendAt;
                    // console.log(`[Actuator] Bridge-to-update delay: ${bridgeToUpdate}ms for ${this.getName()} (${this.getData().deviceId})`);
                    lastSwitchCommandAt = null;
                    lastBridgeSendAt = null;
                }
                if (typeof state.switch === 'boolean') {
                    this.setCapabilityValue('onoff', state.switch).catch(console.error);
                    // console.log(`[Actuator] State update: onoff=${state.switch} for ${this.getName()} (${this.getData().deviceId})`);
                }
                if (typeof state.dimmvalue === 'number' && hasCapability('dim')) {
                    const homeyDim = Math.max(0, Math.min(1, state.dimmvalue / 99));
                    this.setCapabilityValue('dim', homeyDim).catch(console.error);
                    // console.log(`[Actuator] State update: dim=${homeyDim} for ${this.getName()} (${this.getData().deviceId})`);
                }
            }
            catch (err) {
                console.error(`[Actuator] Error handling deviceUpdate for ${this.getData().deviceId}:`, err);
            }
        };
        this.bridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
        this.registerCapabilityListener('onoff', async (value) => {
            if (!this.bridge)
                return;
            try {
                // Optimistic UI update
                this.setCapabilityValue('onoff', value).catch(() => { });
                if (!value && hasCapability('dim')) {
                    this.setCapabilityValue('dim', 0).catch(() => { });
                }
                lastSwitchCommandAt = Date.now();
                lastBridgeSendAt = null;
                // switchDevice uses the 1/0 logic internally now
                this.bridge.switchDevice(resolveDeviceId(), value, (sendTime) => {
                    lastBridgeSendAt = sendTime || Date.now();
                    if (lastSwitchCommandAt) {
                        const delta = lastBridgeSendAt - lastSwitchCommandAt;
                        // console.log(`[Actuator] Bridge send delay: ${delta}ms for ${this.getName()} (${this.getData().deviceId})`);
                    }
                });
            }
            catch (err) {
                console.error(`[Actuator] Error sending onoff command for ${this.getData().deviceId}:`, err);
            }
        });
        this.registerCapabilityListener('dim', async (value) => {
            if (!this.bridge)
                return;
            if (!hasCapability('dim'))
                return;
            try {
                if (value === 0) {
                    this.setCapabilityValue('onoff', false).catch(() => { });
                    lastSwitchCommandAt = Date.now();
                    lastBridgeSendAt = null;
                    // console.log(`[Actuator] Command: switchDevice(${resolveDeviceId()}, false) at ${lastSwitchCommandAt}`);
                    await this.bridge.switchDevice(resolveDeviceId(), false, (sendTime) => {
                        lastBridgeSendAt = sendTime || Date.now();
                        if (lastSwitchCommandAt) {
                            const delta = lastBridgeSendAt - lastSwitchCommandAt;
                            // console.log(`[Actuator] Bridge send delay: ${delta}ms for ${this.getName()} (${this.getData().deviceId})`);
                        }
                    });
                }
                else {
                    const dimValue = Math.max(1, Math.round(value * 99));
                    this.setCapabilityValue('onoff', true).catch(() => { });
                    lastSwitchCommandAt = Date.now();
                    lastBridgeSendAt = null;
                    // console.log(`[Actuator] Command: dimDevice(${resolveDeviceId()}, ${dimValue}) at ${lastSwitchCommandAt}`);
                    await this.bridge.dimDevice(resolveDeviceId(), dimValue, (sendTime) => {
                        lastBridgeSendAt = sendTime || Date.now();
                        if (lastSwitchCommandAt) {
                            const delta = lastBridgeSendAt - lastSwitchCommandAt;
                            // console.log(`[Actuator] Bridge send delay: ${delta}ms for ${this.getName()} (${this.getData().deviceId})`);
                        }
                    });
                }
            }
            catch (err) {
                console.error(`[Actuator] Error sending dim command for ${this.getData().deviceId}:`, err);
            }
        });
    }
    onDeleted() {
        if (this.bridge && this.onDeviceUpdate) {
            this.bridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
            this.log('ActuatorDevice listener removed');
        }
    }
};
