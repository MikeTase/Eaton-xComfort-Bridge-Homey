import { BaseDriver } from '../../lib/BaseDriver';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { XComfortDevice } from '../../lib/types';

module.exports = class DoorWindowSensorDriver extends BaseDriver {
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
        if (devType !== DEVICE_TYPES.DOOR_WINDOW_SENSOR) {
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
            id: `door_window_${device.deviceId}`,
            deviceId: String(device.deviceId),
          },
          settings: {
            deviceType: Number(device.devType ?? 0),
          },
        };
      });
  }
};
