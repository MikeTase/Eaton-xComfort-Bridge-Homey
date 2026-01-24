"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class ActuatorDevice extends homey_1.default.Device {
    async onInit() {
        var _a;
        this.log('ActuatorDevice init:', this.getName());
        const app = this.homey.app;
        // Dependency injection: allow bridge to be passed in for testing or advanced use
        this.bridge = ((_a = app.getBridge) === null || _a === void 0 ? void 0 : _a.call(app)) || app.bridge;
        // Helper to check if device has a capability
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
        // Timestamp tracking for latency measurement
        let lastSwitchCommandAt = null;
        let lastBridgeSendAt = null;
        // Listen for deviceUpdate events from bridge
        const updateDeviceState = (state) => {
            try {
                const now = Date.now();
                if (lastSwitchCommandAt) {
                    const latency = now - lastSwitchCommandAt;
                    console.log(`[Actuator] Latency: ${latency}ms from switch command to state update for ${this.getName()} (${this.getData().deviceId})`);
                }
                if (lastBridgeSendAt) {
                    const bridgeToUpdate = now - lastBridgeSendAt;
                    console.log(`[Actuator] Bridge-to-update delay: ${bridgeToUpdate}ms for ${this.getName()} (${this.getData().deviceId})`);
                    lastSwitchCommandAt = null;
                    lastBridgeSendAt = null;
                }
                // Use switch and dimmvalue from DeviceState
                if (typeof state.switch === 'boolean') {
                    this.setCapabilityValue('onoff', state.switch);
                    console.log(`[Actuator] State update: onoff=${state.switch} for ${this.getName()} (${this.getData().deviceId})`);
                }
                if (typeof state.dimmvalue === 'number' && hasCapability('dim')) {
                    const homeyDim = Math.max(0, Math.min(1, state.dimmvalue / 99));
                    this.setCapabilityValue('dim', homeyDim);
                    console.log(`[Actuator] State update: dim=${homeyDim} for ${this.getName()} (${this.getData().deviceId})`);
                }
            }
            catch (err) {
                console.error(`[Actuator] Error handling deviceUpdate:`, err);
            }
        };
        this.bridge.on('deviceUpdate', ({ deviceId, state }) => {
            if (String(deviceId) === String(this.getData().deviceId)) {
                updateDeviceState(state);
            }
        });
        // Capability listeners: send commands to bridge immediately
        this.registerCapabilityListener('onoff', async (value) => {
            if (!this.bridge)
                return;
            try {
                // Update Homey state immediately for UI responsiveness
                this.setCapabilityValue('onoff', value);
                if (!value && hasCapability('dim')) {
                    this.setCapabilityValue('dim', 0);
                }
                lastSwitchCommandAt = Date.now();
                lastBridgeSendAt = null;
                // Send switchDevice command without awaiting for faster response
                this.bridge.switchDevice(resolveDeviceId(), value, (sendTime) => {
                    lastBridgeSendAt = sendTime || Date.now();
                    if (lastSwitchCommandAt) {
                        const delta = lastBridgeSendAt - lastSwitchCommandAt;
                        console.log(`[Actuator] Bridge send delay: ${delta}ms for ${this.getName()} (${this.getData().deviceId})`);
                    }
                });
            }
            catch (err) {
                console.error(`[Actuator] Error sending onoff command:`, err);
            }
        });
        this.registerCapabilityListener('dim', async (value) => {
            if (!this.bridge)
                return;
            if (!hasCapability('dim'))
                return;
            try {
                if (value === 0) {
                    this.setCapabilityValue('onoff', false);
                    lastSwitchCommandAt = Date.now();
                    lastBridgeSendAt = null;
                    console.log(`[Actuator] Command: switchDevice(${resolveDeviceId()}, false) at ${lastSwitchCommandAt}`);
                    await this.bridge.switchDevice(resolveDeviceId(), false, (sendTime) => {
                        lastBridgeSendAt = sendTime || Date.now();
                        if (lastSwitchCommandAt) {
                            const delta = lastBridgeSendAt - lastSwitchCommandAt;
                            console.log(`[Actuator] Bridge send delay: ${delta}ms for ${this.getName()} (${this.getData().deviceId})`);
                        }
                    });
                }
                else {
                    const dimValue = Math.max(1, Math.round(value * 99));
                    this.setCapabilityValue('onoff', true);
                    lastSwitchCommandAt = Date.now();
                    lastBridgeSendAt = null;
                    console.log(`[Actuator] Command: dimDevice(${resolveDeviceId()}, ${dimValue}) at ${lastSwitchCommandAt}`);
                    await this.bridge.dimDevice(resolveDeviceId(), dimValue, (sendTime) => {
                        lastBridgeSendAt = sendTime || Date.now();
                        if (lastSwitchCommandAt) {
                            const delta = lastBridgeSendAt - lastSwitchCommandAt;
                            console.log(`[Actuator] Bridge send delay: ${delta}ms for ${this.getName()} (${this.getData().deviceId})`);
                        }
                    });
                }
            }
            catch (err) {
                console.error(`[Actuator] Error sending dim command:`, err);
            }
        });
    }
};
