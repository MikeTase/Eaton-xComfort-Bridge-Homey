import { BaseDriver } from '../../lib/BaseDriver';
import { DEVICE_TYPES, DEVICE_USAGE } from '../../lib/XComfortProtocol';
import { XComfortDevice } from '../../lib/types';

module.exports = class ApplianceDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
    const formattedDevices = this.formatForPairing(devices);
    this.homey.app?.log?.(
      `[ApplianceDriver] Returning ${formattedDevices.length} appliance/load devices for pairing`
    );
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[]) {
    const seenIds = new Set<string>();
    const filtered = devices.filter((device) => {
      const devType = Number(device.devType ?? 0);
      const usage = Number(device.usage ?? DEVICE_USAGE.LIGHT);
      const id = `${this.getItemBridgeId(device) || ''}:${device.deviceId}`;

      if (!id || seenIds.has(id)) return false;
      if (devType !== DEVICE_TYPES.SWITCHING_ACTUATOR && devType !== DEVICE_TYPES.DIMMING_ACTUATOR) return false;
      if (usage === DEVICE_USAGE.LIGHT) return false;

      seenIds.add(id);
      return true;
    });

    const candidates = filtered.map((device) => {
      const baseName = device.name || `Load ${device.deviceId}`;
      const roomName = device.roomName;
      const displayName = this.getDisplayNameWithBridge(roomName ? `${roomName} - ${baseName}` : baseName, device);
      const deviceType = Number(device.devType ?? 0);
      const dimmable = device.dimmable === true || deviceType === DEVICE_TYPES.DIMMING_ACTUATOR;

      return {
        name: displayName,
        data: this.getBridgeDeviceData('appliance', device),
        settings: {
          deviceType,
          dimmable,
          usage: Number(device.usage ?? 0),
        },
      };
    });

    return this.filterUnpairedPairingDevices(candidates);
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
};
