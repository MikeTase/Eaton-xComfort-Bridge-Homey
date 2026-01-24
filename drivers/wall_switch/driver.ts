import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/Bridge';
import { DeviceState } from '../../lib/types';

module.exports = class WallSwitchDriver extends Homey.Driver {
  private async listUnpairedDevices() {
    const app = this.homey.app as any;
    // Dependency injection: allow bridge to be passed in for testing or advanced use
    const bridge: XComfortBridge = app.getBridge?.() || app.bridge;

    if (!bridge) {
      throw new Error('Bridge not connected.');
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
      `[WallSwitchDriver] Returning ${pairedDevices.length} wall switches for pairing`
    );
    return pairedDevices;
  }

  private getPairedDevices(devices: any[]) {
    return devices
      // Only include wall switches / push buttons
      .filter((device: any) => {
        const devType = Number(device.devType ?? device.deviceType ?? device.type);
        // devType 220 = wall switch in observed payloads
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
