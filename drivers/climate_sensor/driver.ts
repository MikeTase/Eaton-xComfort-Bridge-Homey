import { BaseDriver } from '../../lib/BaseDriver';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { XComfortDevice } from '../../lib/types';

module.exports = class ClimateSensorDriver extends BaseDriver {
  async onPairListDevices() {
    const devices = await this.getDevicesFromBridge();
    return this.formatForPairing(devices);
  }

  private formatForPairing(devices: XComfortDevice[]) {
    const seenIds = new Set<string>();

    return devices
      .filter((device) => {
        const deviceId = String(device.deviceId || '');
        if (!deviceId || seenIds.has(deviceId)) {
          return false;
        }

        const devType = Number(device.devType ?? 0);
        if (devType !== DEVICE_TYPES.TEMP_HUMIDITY_SENSOR) {
          return false;
        }

        seenIds.add(deviceId);
        return true;
      })
      .map((device) => {
        const baseName = device.name || `Sensor ${device.deviceId}`;
        const roomName = device.roomName;
        const displayName = roomName ? `${roomName} - ${baseName}` : baseName;

        return {
          name: displayName,
          data: {
            id: `climate_sensor_${device.deviceId}`,
            deviceId: String(device.deviceId),
          },
          settings: {
            deviceType: Number(device.devType ?? 0),
          },
        };
      });
  }
};
