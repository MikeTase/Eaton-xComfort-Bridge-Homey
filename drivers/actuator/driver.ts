import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/Bridge';
import { DeviceState } from '../../lib/types';

module.exports = class ActuatorDriver extends Homey.Driver {
  private async listUnpairedDevices() {
    const app = this.homey.app as any;
    // Dependency injection: allow bridge to be passed in for testing or advanced use
    const bridge: XComfortBridge = app.getBridge?.() || app.bridge;

    if (!bridge) {
      throw new Error('Bridge not connected. Please configure settings first.');
    }

    let devices: DeviceState[] = bridge.getDevices();

    if (!devices || devices.length === 0) {
      devices = await new Promise((resolve) => {
        let resolved = false;
        const finish = (loaded: any[]) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          bridge.off('devices_loaded', onLoaded);
          resolve(loaded || bridge.getDevices() || []);
        };

        const onLoaded = (loadedDevices: any[]) => finish(loadedDevices);

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
    this.homey.app?.log?.(
      `[ActuatorDriver] Returning ${pairedDevices.length} dimmable devices for pairing`
    );
    return pairedDevices;
  }

  private getPairedDevices(devices: any[]) {
    // Only include actuators / loads with valid, unique deviceId
    const seenIds = new Set();
    const filtered = devices.filter((device: any) => {
      const devType = Number(device.devType ?? device.deviceType ?? device.type);
      const id = device.deviceId;
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return devType === 100 || devType === 101;
    });

    const source = filtered.length ? filtered : devices.filter((device: any) => {
      const id = device.deviceId;
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    return source.map((device: any) => {
      const baseName = device.name || device.deviceName || device.label || `Device ${device.deviceId}`;
      const displayName = device.roomName ? `${device.roomName} - ${baseName}` : baseName;
      const deviceId = device.deviceId;
      const deviceType = device.devType ?? device.deviceType ?? device.type ?? 'unknown';
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
}
