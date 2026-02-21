import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class WaterSensorDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
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
      if (devType !== DEVICE_TYPES.WATER_GUARD && devType !== DEVICE_TYPES.WATER_SENSOR) return false;
      seenIds.add(String(id));
      return true;
    });

    return filtered.map((device) => {
      const baseName = device.name || `Water Sensor ${device.deviceId}`;
      const roomName = device.roomName;
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
