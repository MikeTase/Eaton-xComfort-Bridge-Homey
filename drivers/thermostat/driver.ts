import * as Homey from 'homey';
import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice, XComfortRoom } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { resolveThermostatRoomId } from '../../lib/utils/resolveThermostatRoomId';

/** A thermostat device that may expose preset-mode control. */
interface PresetDevice extends Homey.Device {
  setPresetModeAction?(preset: string): Promise<void>;
}

module.exports = class ThermostatDriver extends BaseDriver {
  async onInit() {
    super.onInit();

    // Register custom flow action for preset
    const setPresetAction = this.homey.flow.getActionCard('set_xcomfort_preset');
    if (setPresetAction) {
      setPresetAction.registerRunListener(async (args: { device: PresetDevice; preset?: unknown }) => {
        const device = args.device;
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
      presetCondition.registerRunListener(async (args: { device: Homey.Device; preset?: unknown }) => {
        const device = args.device;
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
    const rooms = await this.getRoomsFromBridge();
    const formattedDevices = this.formatForPairing(devices, rooms);
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[], rooms: XComfortRoom[]) {
    const seenIds = new Set<string>();
    
    const filtered = devices.filter((device) => {
      const devType = device.devType ?? 0;
      const id = `${this.getItemBridgeId(device) || ''}:${device.deviceId}`;
      
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);

      return (
          devType === DEVICE_TYPES.HEATING_ACTUATOR ||
          devType === DEVICE_TYPES.HEATING_VALVE ||
          devType === DEVICE_TYPES.RC_TOUCH
      );
    });

    const candidates = filtered.map((device) => {
      const baseName = device.name || `Device ${device.deviceId}`;
      const roomName = device.roomName;
      const displayName = this.getDisplayNameWithBridge(roomName ? `${roomName} - ${baseName}` : baseName, device);
      
      const deviceType = device.devType ?? 0;
      const bridgeId = this.getItemBridgeId(device);
      const bridgeRooms = bridgeId ? rooms.filter((room) => this.getItemBridgeId(room) === bridgeId) : rooms;
      const roomId = resolveThermostatRoomId(device, bridgeRooms);
      
      return {
        name: displayName,
        data: {
          ...this.getBridgeDeviceData('thermostat', device),
          ...(roomId ? { roomId } : {})
        },
        settings: {
          deviceType
        }
      };
    });

    return this.filterUnpairedPairingDevices(candidates);
  }
  
  async onPairListDevices() {
      return this.listUnpairedDevices();
  }
};
