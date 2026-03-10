import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice, XComfortRoom } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { resolveThermostatRoomId } from '../../lib/utils/resolveThermostatRoomId';

module.exports = class ThermostatDriver extends BaseDriver {
  async onInit() {
    super.onInit();
    
    // Register custom flow action for preset
    const setPresetAction = this.homey.flow.getActionCard('set_xcomfort_preset');
    if (setPresetAction) {
      setPresetAction.registerRunListener(async (args: any) => {
        const device = args.device as any;
        const preset = this.normalizePresetArgument(args.preset);
        if (!preset) {
          throw new Error('No xComfort preset selected');
        }
        if (typeof device.setPresetModeAction === 'function') {
          await device.setPresetModeAction(preset);
        }
        return true;
      });
    }

    // Register custom flow condition
    const presetCondition = this.homey.flow.getConditionCard('xcomfort_preset_is');
    if (presetCondition) {
      presetCondition.registerRunListener(async (args: any) => {
        const device = args.device as any;
        const current = device.getCapabilityValue('xcomfort_preset_mode');
        const preset = this.normalizePresetArgument(args.preset);
        return preset ? current === preset : false;
      });
    }
  }

  private normalizePresetArgument(value: unknown): string | null {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (value && typeof value === 'object' && 'id' in value) {
      const presetId = (value as { id?: unknown }).id;
      if (typeof presetId === 'string' && presetId.length > 0) {
        return presetId;
      }
    }

    return null;
  }

  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
    const rooms = this.getBridge().getRooms();
    const formattedDevices = this.formatForPairing(devices, rooms);
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[], rooms: XComfortRoom[]) {
    const seenIds = new Set<string>();
    
    const filtered = devices.filter((device) => {
      const devType = device.devType ?? 0;
      const id = device.deviceId;
      
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);

      return (
          devType === DEVICE_TYPES.HEATING_ACTUATOR ||
          devType === DEVICE_TYPES.HEATING_VALVE ||
          devType === DEVICE_TYPES.RC_TOUCH
      );
    });

    return filtered.map((device) => {
      const baseName = device.name || `Device ${device.deviceId}`;
      const roomName = device.roomName;
      const displayName = roomName ? `${roomName} - ${baseName}` : baseName;
      
      const deviceId = device.deviceId;
      const deviceType = device.devType ?? 0;
      const roomId = resolveThermostatRoomId(device, rooms);
      
      return {
        name: displayName,
        data: {
          id: `thermostat_${deviceId}`,
          deviceId: deviceId,
          ...(roomId ? { roomId } : {})
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
};
