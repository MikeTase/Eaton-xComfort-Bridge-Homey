import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';

module.exports = class WallSwitchDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
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
