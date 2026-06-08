import { BaseDriver } from '../../lib/BaseDriver';
import type { XComfortRoom } from '../../lib/types';

interface SwitchRoomLightsArgs {
  device?: {
    switchRoomLights?: (switchState: boolean) => Promise<void>;
  };
  state?: unknown;
}

module.exports = class RoomStatusDriver extends BaseDriver {
  async onInit() {
    super.onInit();

    const switchRoomLightsAction = this.homey.flow.getActionCard('switch_xcomfort_room_lights');
    if (switchRoomLightsAction) {
      switchRoomLightsAction.registerRunListener(async (args: SwitchRoomLightsArgs) => {
        const device = args.device;
        if (!device || typeof device.switchRoomLights !== 'function') {
          throw new Error('No xComfort room selected');
        }

        await device.switchRoomLights(args.state === 'on');
        return true;
      });
    }
  }

  async onPairListDevices() {
    const rooms = await this.getRoomsFromBridge();
    return this.formatForPairing(rooms);
  }

  private formatForPairing(rooms: XComfortRoom[]) {
    const seenIds = new Set<string>();

    const candidates = rooms
      .filter((room) => {
        const roomId = String(room.roomId || '');
        const uniqueId = `${this.getItemBridgeId(room) || ''}:${roomId}`;
        if (!roomId || seenIds.has(uniqueId)) {
          return false;
        }

        seenIds.add(uniqueId);
        return true;
      })
      .map((room) => ({
        name: this.getDisplayNameWithBridge(room.name || `Room ${room.roomId}`, room),
        data: this.getBridgeRoomData('room_status', room),
        settings: {
          room_id: String(room.roomId),
          temperatureOnly: room.temperatureOnly === true,
        },
      }));

    return this.filterUnpairedPairingDevices(candidates);
  }
};
