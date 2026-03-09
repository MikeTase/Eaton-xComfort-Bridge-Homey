import { BaseDevice } from '../../lib/BaseDevice';
import { XCOMFORT_CAPABILITIES } from '../../lib/XComfortCapabilities';
import {
  ClimateMode,
  RoomStateUpdate,
  XComfortRoom,
} from '../../lib/types';

const MANAGED_CAPABILITIES = [
  'measure_temperature',
  'measure_humidity',
  'measure_power',
  'meter_power',
  XCOMFORT_CAPABILITIES.ROOM_MODE,
  XCOMFORT_CAPABILITIES.HEATING_DEMAND,
  XCOMFORT_CAPABILITIES.LIGHTS_ON,
  XCOMFORT_CAPABILITIES.WINDOWS_OPEN,
  XCOMFORT_CAPABILITIES.DOORS_OPEN,
] as const;

interface RoomSensorData {
  roomId?: string | number;
}

module.exports = class RoomSensorDevice extends BaseDevice {
  private roomId!: string;
  private energyKwh: number = 0;
  private lastPowerW: number | null = null;
  private lastPowerTimestamp: number | null = null;

  async onDeviceReady() {
    const data = this.getData() as RoomSensorData;
    if (data.roomId === undefined || data.roomId === null) {
      throw new Error('Missing roomId for room sensor');
    }

    this.roomId = String(data.roomId);

    const room = this.bridge.getRoom(this.roomId);
    await this.applyCapabilityProfile(room);
    await this.restoreEnergy();

    this.addManagedRoomStateListener(this.roomId, (_roomId, state) => {
      void this.updateRoomState(state);
    });

    if (room) {
      await this.applyRoomSnapshot(room);
    }
  }

  protected onBridgeChanged(): void {
    const room = this.bridge.getRoom(this.roomId);
    if (room) {
      void this.applyCapabilityProfile(room);
      void this.applyRoomSnapshot(room);
    }
  }

  private async restoreEnergy(): Promise<void> {
    const storedEnergy = Number(this.getStoreValue('energy_kwh_total') ?? 0);
    if (Number.isFinite(storedEnergy) && storedEnergy >= 0) {
      this.energyKwh = storedEnergy;
      if (this.hasCapability('meter_power')) {
        await this.updateCapability('meter_power', this.energyKwh);
      }
    }
  }

  private async applyRoomSnapshot(room: XComfortRoom): Promise<void> {
    const update: RoomStateUpdate = {
      temp: room.temp,
      humidity: room.humidity,
      power: room.power,
      valve: room.valve,
      currentMode: room.currentMode,
      mode: room.mode,
      temperatureOnly: room.temperatureOnly,
      lightsOn: room.lightsOn,
      windowsOpen: room.windowsOpen,
      doorsOpen: room.doorsOpen,
      raw: room.raw,
    };

    await this.updateRoomState(update);
  }

  private async applyCapabilityProfile(snapshot?: Partial<XComfortRoom | RoomStateUpdate>): Promise<void> {
    const desired = this.getDesiredCapabilities(snapshot);
    const current = new Set(this.getCapabilities());

    for (const capability of current) {
      if (MANAGED_CAPABILITIES.includes(capability as typeof MANAGED_CAPABILITIES[number]) && !desired.has(capability)) {
        await this.removeCapability(capability).catch(this.error);
      }
    }

    for (const capability of desired) {
      if (!current.has(capability)) {
        await this.addCapability(capability).catch(this.error);
      }
    }
  }

  private getDesiredCapabilities(snapshot?: Partial<XComfortRoom | RoomStateUpdate>): Set<string> {
    const desired = new Set<string>();
    const raw = snapshot?.raw as Record<string, unknown> | undefined;

    const hasNumber = (value: unknown) => typeof value === 'number';
    const hasBoolean = (value: unknown) => typeof value === 'boolean';

    if (
      hasNumber(snapshot?.temp)
      || hasNumber(raw?.temp)
      || hasBoolean(snapshot?.temperatureOnly)
      || hasBoolean(raw?.temperatureOnly)
    ) {
      desired.add('measure_temperature');
    }

    if (hasNumber(snapshot?.humidity) || hasNumber(raw?.humidity)) {
      desired.add('measure_humidity');
    }

    if (hasNumber(snapshot?.power) || hasNumber(raw?.power)) {
      desired.add('measure_power');
      desired.add('meter_power');
    }

    if (
      hasNumber(snapshot?.currentMode)
      || hasNumber(snapshot?.mode)
      || hasNumber(raw?.currentMode)
      || hasNumber(raw?.mode)
    ) {
      desired.add(XCOMFORT_CAPABILITIES.ROOM_MODE);
    }

    if (
      hasNumber(snapshot?.valve)
      || hasNumber(raw?.valve)
      || snapshot?.temperatureOnly === false
      || raw?.temperatureOnly === false
    ) {
      desired.add(XCOMFORT_CAPABILITIES.HEATING_DEMAND);
    }

    if (hasNumber(snapshot?.lightsOn) || hasNumber(raw?.lightsOn)) {
      desired.add(XCOMFORT_CAPABILITIES.LIGHTS_ON);
    }

    if (hasNumber(snapshot?.windowsOpen) || hasNumber(raw?.windowsOpen)) {
      desired.add(XCOMFORT_CAPABILITIES.WINDOWS_OPEN);
    }

    if (hasNumber(snapshot?.doorsOpen) || hasNumber(raw?.doorsOpen)) {
      desired.add(XCOMFORT_CAPABILITIES.DOORS_OPEN);
    }

    return desired;
  }

  private async ensureCapabilitiesForState(state: RoomStateUpdate): Promise<void> {
    const desired = this.getDesiredCapabilities(state);
    for (const capability of desired) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability).catch(this.error);
      }
    }
  }

  private async updateRoomState(state: RoomStateUpdate): Promise<void> {
    await this.ensureCapabilitiesForState(state);

    if (typeof state.temp === 'number' && this.hasCapability('measure_temperature')) {
      await this.updateCapability('measure_temperature', state.temp);
    }

    if (typeof state.humidity === 'number' && this.hasCapability('measure_humidity')) {
      await this.updateCapability('measure_humidity', state.humidity);
    }

    const roomMode = this.toRoomModeValue(state.currentMode ?? state.mode);
    if (roomMode && this.hasCapability(XCOMFORT_CAPABILITIES.ROOM_MODE)) {
      await this.updateCapability(XCOMFORT_CAPABILITIES.ROOM_MODE, roomMode);
    }

    if (typeof state.valve === 'number' && this.hasCapability(XCOMFORT_CAPABILITIES.HEATING_DEMAND)) {
      await this.updateCapability(XCOMFORT_CAPABILITIES.HEATING_DEMAND, state.valve);
    }

    if (typeof state.lightsOn === 'number' && this.hasCapability(XCOMFORT_CAPABILITIES.LIGHTS_ON)) {
      await this.updateCapability(XCOMFORT_CAPABILITIES.LIGHTS_ON, state.lightsOn);
    }

    if (typeof state.windowsOpen === 'number' && this.hasCapability(XCOMFORT_CAPABILITIES.WINDOWS_OPEN)) {
      await this.updateCapability(XCOMFORT_CAPABILITIES.WINDOWS_OPEN, state.windowsOpen);
    }

    if (typeof state.doorsOpen === 'number' && this.hasCapability(XCOMFORT_CAPABILITIES.DOORS_OPEN)) {
      await this.updateCapability(XCOMFORT_CAPABILITIES.DOORS_OPEN, state.doorsOpen);
    }

    if (typeof state.power === 'number' && this.hasCapability('measure_power')) {
      await this.updateCapability('measure_power', state.power);
      await this.updateEnergy(state.power);
    }
  }

  private async updateEnergy(powerW: number): Promise<void> {
    if (!this.hasCapability('meter_power') || !Number.isFinite(powerW)) {
      return;
    }

    const now = Date.now();
    if (this.lastPowerW !== null && this.lastPowerTimestamp !== null) {
      const elapsedMs = now - this.lastPowerTimestamp;
      if (elapsedMs > 0 && elapsedMs < 7 * 24 * 60 * 60 * 1000) {
        this.energyKwh += (this.lastPowerW * elapsedMs) / 3_600_000_000;
        await this.updateCapability('meter_power', this.energyKwh);
        await this.setStoreValue('energy_kwh_total', this.energyKwh).catch(this.error);
      }
    }

    this.lastPowerW = powerW;
    this.lastPowerTimestamp = now;
  }

  private toRoomModeValue(mode: number | ClimateMode | undefined): 'unknown' | 'frost' | 'eco' | 'comfort' | null {
    switch (Number(mode)) {
      case ClimateMode.FrostProtection:
        return 'frost';
      case ClimateMode.Eco:
        return 'eco';
      case ClimateMode.Comfort:
        return 'comfort';
      case ClimateMode.Unknown:
      default:
        return mode === undefined ? null : 'unknown';
    }
  }
};
