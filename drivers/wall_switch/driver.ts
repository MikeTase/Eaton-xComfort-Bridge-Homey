import * as Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { XComfortDevice } from '../../lib/types';

// Define the interface for our specific App
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class WallSwitchDriver extends Homey.Driver {
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

        // Safety timeout
        timeoutTimer = setTimeout(() => {
          finish(bridge.getDevices() || []);
        }, 15000);
      });
    }

    const pairedDevices = this.getPairedDevices(devices);
    this.homey.app?.log?.(
      `[WallSwitchDriver] Returning ${pairedDevices.length} wall switches for pairing`
    );
    return pairedDevices;
  }

  private getPairedDevices(devices: XComfortDevice[]) {
    return devices
      // Only include wall switches / push buttons (Type 220)
      .filter((device: any) => {
        const devType = Number(device.devType ?? device.deviceType ?? device.type);
        return devType === 220;
      })
      .map((device: any) => {
        const baseName = device.name || device.deviceName || device.label || `Device ${device.deviceId}`;
        const displayName = device.roomName ? `${device.roomName} - ${baseName}` : baseName;
        const deviceId = String(device.deviceId);
        const deviceType = device.devType ?? device.deviceType ?? device.type ?? 'unknown';
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
}
