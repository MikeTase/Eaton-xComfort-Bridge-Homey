"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class ActuatorDriver extends homey_1.default.Driver {
    async listUnpairedDevices() {
        var _a, _b;
        const app = this.homey.app;
        const bridge = app.bridge;
        if (!bridge) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }
        let devices = bridge.getDevices();
        if (!devices || devices.length === 0) {
            devices = await new Promise((resolve) => {
                let isResolved = false;
                let timeoutTimer;
                const cleanup = () => {
                    if (timeoutTimer)
                        clearTimeout(timeoutTimer);
                    bridge.removeListener('devices_loaded', onLoaded);
                };
                const finish = (loaded) => {
                    if (isResolved)
                        return;
                    isResolved = true;
                    cleanup();
                    resolve(loaded || bridge.getDevices() || []);
                };
                const onLoaded = (loadedDevices) => finish(loadedDevices);
                bridge.once('devices_loaded', onLoaded);
                // If not authenticated yet, we might need to wait for connection first
                // We set a safety timeout.
                timeoutTimer = setTimeout(() => {
                    finish(bridge.getDevices() || []);
                }, 15000);
            });
        }
        const formattedDevices = this.formatForPairing(devices);
        (_b = (_a = this.homey.app) === null || _a === void 0 ? void 0 : _a.log) === null || _b === void 0 ? void 0 : _b.call(_a, `[ActuatorDriver] Returning ${formattedDevices.length} dimmable/switching devices for pairing`);
        return formattedDevices;
    }
    formatForPairing(devices) {
        // Only include actuators / loads with valid, unique deviceId
        const seenIds = new Set();
        // Filter for Switching (100) and Dimming (101) Actuators
        const filtered = devices.filter((device) => {
            var _a;
            // Prioritize explicit devType, fallback to checking other props if needed
            // XComfortDevice interface defines devType as optional number
            const devType = (_a = device.devType) !== null && _a !== void 0 ? _a : 0;
            const id = device.deviceId;
            if (!id || seenIds.has(id))
                return false;
            seenIds.add(id);
            return devType === 100 || devType === 101;
        });
        return filtered.map((device) => {
            var _a;
            const baseName = device.name || `Device ${device.deviceId}`;
            // Use room name if available (not in XComfortDevice type explicitly but might exist in runtime)
            const roomName = device.roomName;
            const displayName = roomName ? `${roomName} - ${baseName}` : baseName;
            const deviceId = device.deviceId;
            const deviceType = (_a = device.devType) !== null && _a !== void 0 ? _a : 0;
            // devType 100 = Switching, 101 = Dimming
            // Only trust 'dimmable' flag or specific type
            const dimmable = device.dimmable === true || deviceType === 101;
            return {
                name: displayName,
                data: {
                    id: `actuator_${deviceId}`,
                    deviceId: deviceId
                },
                settings: {
                    deviceType,
                    dimmable
                }
            };
        });
    }
    async onPairListDevices() {
        return this.listUnpairedDevices();
    }
};
