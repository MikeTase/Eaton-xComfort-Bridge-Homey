import * as Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { XComfortDevice } from '../../lib/types';

interface XComfortApp extends Homey.App {
  bridge: XComfortBridge | null;
}

const WATER_GUARD = 497;
const WATER_SENSOR = 499;

module.exports = class WaterSensorDriver extends Homey.Driver {
  private async listUnpairedDevices() {
    const app = this.homey.app as XComfortApp;
    const bridge = app.bridge;

    if (!bridge) {
      throw new Error('Bridge not connected. Please configure settings first.');
    }

    let devices: XComfortDevice[] = bridge.getDevices();

    if (!devices || devices.length === 0) {
      devices = await new Promise<XComfortDevice[]>((resolve) => {
        let isResolved = false;
        let timeoutTimer: NodeJS.Timeout;

        const cleanup = () => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          bridge.removeListener('devices_loaded', onLoaded);
        };

        const finish = (loaded: XComfortDevice[]) => {
          if (isResolved) return;
          isResolved = true;
          cleanup();
          resolve(loaded || bridge.getDevices() || []);
        };

        const onLoaded = (loadedDevices: XComfortDevice[]) => finish(loadedDevices);

        bridge.once('devices_loaded', onLoaded);

        timeoutTimer = setTimeout(() => {
          finish(bridge.getDevices() || []);
        }, 15000);
      });
    }

    const formatted = this.formatForPairing(devices);
    this.homey.app?.log?.(`[WaterSensorDriver] Returning ${formatted.length} water sensors for pairing`);
    return formatted;
  }

  private formatForPairing(devices: XComfortDevice[]) {
    const seenIds = new Set<string>();

    const filtered = devices.filter((device) => {
      const devType = device.devType ?? 0;
      const id = device.deviceId;
      if (!id || seenIds.has(String(id))) return false;
      if (devType !== WATER_GUARD && devType !== WATER_SENSOR) return false;
      seenIds.add(String(id));
      return true;
    });

    return filtered.map((device) => {
      const baseName = device.name || `Water Sensor ${device.deviceId}`;
      const roomName = (device as any).roomName;
      const displayName = roomName ? `${roomName} - ${baseName}` : baseName;

      return {
        name: displayName,
        data: {
          id: `water_${device.deviceId}`,
          deviceId: device.deviceId,
        },
        settings: {
          deviceType: device.devType ?? 0,
        },
      };
    });
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
};
