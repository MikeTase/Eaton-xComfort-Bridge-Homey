import { BaseDriver } from '../../lib/BaseDriver';
import type { XComfortDevice } from '../../lib/types';
import {
  getClassificationSettings,
  getDisplayName,
  isWeatherStationDevice,
} from '../../lib/utils/deviceClassification';

module.exports = class WeatherStationDriver extends BaseDriver {
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

        const bridge = this.getBridge(this.getItemBridgeId(device));
        const component = device.compId !== undefined ? bridge.getComponent(String(device.compId)) : undefined;
        if (!isWeatherStationDevice(device, component)) {
          return false;
        }

        seenIds.add(uniqueId);
        return true;
      })
      .map((device) => {
        const bridge = this.getBridge(this.getItemBridgeId(device));
        const component = device.compId !== undefined ? bridge.getComponent(String(device.compId)) : undefined;
        return {
          name: this.getDisplayNameWithBridge(getDisplayName(device, 'Weather Station'), device),
          data: {
            ...this.getBridgeDeviceData('weather_station', device),
            ...(device.compId !== undefined ? { componentId: String(device.compId) } : {}),
          },
          settings: getClassificationSettings(device, component),
        };
      });

    return this.filterUnpairedPairingDevices(candidates);
  }
};
