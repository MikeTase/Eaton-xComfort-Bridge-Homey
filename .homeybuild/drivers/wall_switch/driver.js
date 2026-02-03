"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class WallSwitchDriver extends homey_1.default.Driver {
    async listUnpairedDevices() {
        var _a, _b, _c;
        const app = this.homey.app;
        const bridge = ((_a = app.getBridge) === null || _a === void 0 ? void 0 : _a.call(app)) || app.bridge;
        if (!bridge) {
            throw new Error('Bridge not connected.');
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
                    bridge.once('connected', () => {
                        // wait
                    });
                }
            });
        }
        const pairedDevices = this.getPairedDevices(devices);
        (_c = (_b = this.homey.app) === null || _b === void 0 ? void 0 : _b.log) === null || _c === void 0 ? void 0 : _c.call(_b, `[WallSwitchDriver] Returning ${pairedDevices.length} wall switches for pairing`);
        return pairedDevices;
    }
    getPairedDevices(devices) {
        return devices
            // Only include wall switches / push buttons
            .filter((device) => {
            var _a, _b;
            const devType = Number((_b = (_a = device.devType) !== null && _a !== void 0 ? _a : device.deviceType) !== null && _b !== void 0 ? _b : device.type);
            // devType 220 = wall switch in observed payloads
            return devType === 220;
        })
            .map((device) => {
            var _a, _b, _c;
            const baseName = device.name || device.deviceName || device.label || `Device ${device.deviceId}`;
            const displayName = device.roomName ? `${device.roomName} - ${baseName}` : baseName;
            const deviceId = String(device.deviceId);
            const deviceType = (_c = (_b = (_a = device.devType) !== null && _a !== void 0 ? _a : device.deviceType) !== null && _b !== void 0 ? _b : device.type) !== null && _c !== void 0 ? _c : 'unknown';
            return {
                name: displayName,
                data: {
                    id: `switch_${deviceId}`,
                    deviceId
                },
                settings: {
                    deviceType
                }
            };
        });
    }
    async onPairListDevices() {
        return this.listUnpairedDevices();
    }
};
