import { BaseDriver } from '../../lib/BaseDriver';
import type { XComfortDevice } from '../../lib/types';
import {
  getDisplayName,
  isTemperatureSensorDevice,
} from '../../lib/utils/deviceClassification';

module.exports = class TemperatureSensorDriver extends BaseDriver {
  async onPairListDevices() {
    const devices = await this.getDevicesFromBridge();
    return this.formatForPairing(devices);
  }

  private formatForPairing(devices: XComfortDevice[]) {
    const seenIds = new Set<string>();

    const candidates = devices
      .filter((device) => {
        const deviceId = String(device.deviceId || '');
        const uniqueId = `${this.getItemBridgeId(device) || ''}:${deviceId}`;
        if (!deviceId || seenIds.has(uniqueId)) {
          return false;
        }

        if (!isTemperatureSensorDevice(device)) {
          return false;
        }

        seenIds.add(uniqueId);
        return true;
      })
      .map((device) => ({
        name: this.getDisplayNameWithBridge(getDisplayName(device, 'Temperature Sensor'), device),
        data: {
          ...this.getBridgeDeviceData('temperature', device),
          ...(device.compId !== undefined ? { componentId: String(device.compId) } : {}),
        },
        settings: {
          deviceType: Number(device.devType ?? 0),
          ...(typeof device.compType === 'number' ? { componentType: device.compType } : {}),
        },
      }));

    return this.filterUnpairedPairingDevices(candidates);
  }
};
