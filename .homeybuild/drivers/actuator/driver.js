"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class ActuatorDriver extends homey_1.default.Driver {
    async listUnpairedDevices() {
        var _a, _b, _c;
        const app = this.homey.app;
        // Dependency injection: allow bridge to be passed in for testing or advanced use
        const bridge = ((_a = app.getBridge) === null || _a === void 0 ? void 0 : _a.call(app)) || app.bridge;
        if (!bridge) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }
        let devices = bridge.getDevices();
        if (!devices || devices.length === 0) {
            devices = await new Promise((resolve) => {
                let resolved = false;
                const finish = (loaded) => {
                    if (resolved)
                        return;
                    resolved = true;
                    clearTimeout(timeout);
                    bridge.off('devices_loaded', onLoaded);
                    resolve(loaded || bridge.getDevices() || []);
                };
                const onLoaded = (loadedDevices) => finish(loadedDevices);
                const timeout = setTimeout(() => {
                    finish(bridge.getDevices() || []);
                }, 15000);
                bridge.once('devices_loaded', onLoaded);
                if (!bridge.isAuthenticated()) {
                    bridge.once('authenticated', () => {
                        // wait for devices_loaded; fallback via timeout
                    });
                }
            });
        }
        const pairedDevices = this.getPairedDevices(devices);
        (_c = (_b = this.homey.app) === null || _b === void 0 ? void 0 : _b.log) === null || _c === void 0 ? void 0 : _c.call(_b, `[ActuatorDriver] Returning ${pairedDevices.length} dimmable devices for pairing`);
        return pairedDevices;
    }
    getPairedDevices(devices) {
        // Only include actuators / loads with valid, unique deviceId
        const seenIds = new Set();
        const filtered = devices.filter((device) => {
            var _a, _b;
            const devType = Number((_b = (_a = device.devType) !== null && _a !== void 0 ? _a : device.deviceType) !== null && _b !== void 0 ? _b : device.type);
            const id = device.deviceId;
            if (!id || seenIds.has(id))
                return false;
            seenIds.add(id);
            return devType === 100 || devType === 101;
        });
        const source = filtered.length ? filtered : devices.filter((device) => {
            const id = device.deviceId;
            if (!id || seenIds.has(id))
                return false;
            seenIds.add(id);
            return true;
        });
        return source.map((device) => {
            var _a, _b, _c;
            const baseName = device.name || device.deviceName || device.label || `Device ${device.deviceId}`;
            const displayName = device.roomName ? `${device.roomName} - ${baseName}` : baseName;
            const deviceId = device.deviceId;
            const deviceType = (_c = (_b = (_a = device.devType) !== null && _a !== void 0 ? _a : device.deviceType) !== null && _b !== void 0 ? _b : device.type) !== null && _c !== void 0 ? _c : 'unknown';
            const dimmable = device.dimmable === true || typeof device.dimmvalue === 'number';
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
