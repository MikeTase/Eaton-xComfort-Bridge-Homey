"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
module.exports = class WallSwitchDriver extends homey_1.default.Driver {
    async listUnpairedDevices() {
        const app = this.homey.app;
        const bridge = app.getBridge();
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
                    bridge.once('authenticated', () => {
                        // wait for devices_loaded; fallback via timeout
                    });
                }
            });
        }
        const pairedDevices = this.getPairedDevices(devices);
        this.homey.app?.log?.(`[WallSwitchDriver] Returning ${pairedDevices.length} wall switches for pairing`);
        return pairedDevices;
    }
    getPairedDevices(devices) {
        return devices
            .filter((device) => {
            const devType = Number(device.devType ?? device.deviceType ?? device.type);
            return devType === 220;
        })
            .map((device) => {
            const baseName = device.name || device.deviceName || device.label || `Device ${device.deviceId}`;
            const displayName = device.roomName ? `${device.roomName} - ${baseName}` : baseName;
            const deviceId = String(device.deviceId);
            const deviceType = device.devType ?? device.deviceType ?? device.type ?? 'unknown';
            return {
                name: displayName,
                data: {
                    id: `switch_${deviceId}`,
                    deviceId,
                },
                settings: {
                    deviceType,
                },
            };
        });
    }
    async onPairListDevices() {
        return this.listUnpairedDevices();
    }
};
