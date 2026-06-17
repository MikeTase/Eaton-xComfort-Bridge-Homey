import * as Homey from 'homey';
import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { normalizeValveStateArgument } from '../../lib/utils/flowArguments';

/** A water-sensor device that may expose valve control. */
interface WaterValveDevice extends Homey.Device {
  setValveState?(open: boolean): Promise<void>;
}

module.exports = class WaterSensorDriver extends BaseDriver {
  async onInit() {
    super.onInit();

    const setValveAction = this.homey.flow.getActionCard('set_water_valve');
    if (setValveAction) {
      setValveAction.registerRunListener(async (args: { device: WaterValveDevice; state?: unknown }) => {
        const device = args.device;
        const open = normalizeValveStateArgument(args.state);
        if (open === undefined) {
          throw new Error('No water valve state selected');
        }
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
      valveCondition.registerRunListener(async (args: { device: Homey.Device }) => {
        const device = args.device;
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
      const id = `${this.getItemBridgeId(device) || ''}:${device.deviceId}`;
      if (!id || seenIds.has(String(id))) return false;
      if (devType !== DEVICE_TYPES.WATER_GUARD && devType !== DEVICE_TYPES.WATER_SENSOR) return false;
      seenIds.add(String(id));
      return true;
    });

    const candidates = filtered.map((device) => {
      const baseName = device.name || `Water Sensor ${device.deviceId}`;
      const roomName = device.roomName;
      const displayName = this.getDisplayNameWithBridge(roomName ? `${roomName} - ${baseName}` : baseName, device);

      return {
        name: displayName,
        data: this.getBridgeDeviceData('water', device),
        settings: {
          deviceType: device.devType ?? 0,
        },
      };
    });

    return this.filterUnpairedPairingDevices(candidates);
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
};
