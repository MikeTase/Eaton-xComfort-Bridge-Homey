import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

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
      .filter((device) => {
        const devType = Number(device.devType ?? 0);
        return devType === DEVICE_TYPES.WALL_SWITCH;
      })
      .map((device) => {
        const baseName = device.name || `Device ${device.deviceId}`;
        const roomName = device.roomName;
        const displayName = roomName ? `${roomName} - ${baseName}` : baseName;
        const deviceId = String(device.deviceId);
        const deviceType = device.devType ?? 0;
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
