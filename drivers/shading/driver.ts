import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class ShadingDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
    const formattedDevices = this.formatForPairing(devices);
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[]) {
    const seenIds = new Set<string>();
    
    const filtered = devices.filter((device) => {
      const devType = device.devType ?? 0;
      const id = `${this.getItemBridgeId(device) || ''}:${device.deviceId}`;
      
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);

      return devType === DEVICE_TYPES.SHADING_ACTUATOR;
    });

    const candidates = filtered.map((device) => {
      const baseName = this.getDisplayNameWithBridge(device.name || `Shading ${device.deviceId}`, device);
      
      return {
        name: baseName,
        data: this.getBridgeDeviceData('shading', device),
        settings: {
          shRuntime: typeof device.shRuntime === 'number' ? device.shRuntime : 0
        }
      };
    });

    return this.filterUnpairedPairingDevices(candidates);
  }
  
  async onPairListDevices() {
      return this.listUnpairedDevices();
  }
};
