import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class WaterSensorDriver extends BaseDriver {
  async onInit() {
    super.onInit();

    const setValveAction = this.homey.flow.getActionCard('set_water_valve');
    if (setValveAction) {
      setValveAction.registerRunListener(async (args: any) => {
        const device = args.device as any;
        const open = args.state === 'open';
        if (typeof device.setValveState === 'function') {
          await device.setValveState(open);
        } else {
          throw new Error('This device does not support valve control');
        }
        return true;
      });
    }

    const valveCondition = this.homey.flow.getConditionCard('water_valve_is');
    if (valveCondition) {
      valveCondition.registerRunListener(async (args: any) => {
        const device = args.device as any;
        if (!device.hasCapability('onoff')) {
          throw new Error('This device does not support valve control');
        }
        return device.getCapabilityValue('onoff') === true;
      });
    }
  }

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
