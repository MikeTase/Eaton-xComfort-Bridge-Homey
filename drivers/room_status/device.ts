import { BaseDevice } from '../../lib/BaseDevice';
import { ClimateMode } from '../../lib/types';
import type { RoomStateUpdate, XComfortRoom } from '../../lib/types';
import { EnergyTracker } from '../../lib/utils/EnergyTracker';

const FIELD_CAPABILITY_MAP: Array<{ field: keyof RoomStateUpdate; capability: string }> = [
  { field: 'temp', capability: 'measure_temperature' },
  { field: 'humidity', capability: 'measure_humidity' },
  { field: 'valve', capability: 'xcomfort_heating_demand' },
  { field: 'power', capability: 'measure_power' },
  { field: 'lightsOn', capability: 'xcomfort_lights_on' },
  { field: 'windowsOpen', capability: 'xcomfort_windows_open' },
  { field: 'doorsOpen', capability: 'xcomfort_doors_open' },
  { field: 'currentMode', capability: 'xcomfort_current_mode' },
];

module.exports = class RoomStatusDevice extends BaseDevice {
  private roomRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  private energy = new EnergyTracker(
    async (kwh) => {
      await this.ensureDeviceCapability('meter_power');
      await this.updateCapability('meter_power', kwh);
    },
    {
      onPersist: async (kwh) => {
        await this.setStoreValue('roomMeterPowerKwh', kwh).catch(this.error);
      },
    },
  );

  protected get roomId(): string {
    return String(this.getData().roomId);
  }

  async onDeviceReady() {
    await this.restoreEnergyState();

    this.addManagedRoomStateListener(this.roomId, (_roomId: string, state: RoomStateUpdate) => {
      void this.updateFromRoomState(state);
    });

    await this.applyRoomSnapshot();
  }

  async switchRoomLights(switchState: boolean): Promise<void> {
    if (!this.bridge) {
      throw new Error('Bridge offline');
    }

    await this.bridge.switchRoom(this.roomId, switchState);
    this.scheduleRoomStateRefresh();
  }

  protected onBridgeChanged(): void {
    void this.applyRoomSnapshot();
  }

  private async restoreEnergyState(): Promise<void> {
    const storedValue = this.getStoreValue('roomMeterPowerKwh');
    if (typeof storedValue === 'number' && Number.isFinite(storedValue) && storedValue > 0) {
      this.energy.restore(storedValue);
      await this.ensureDeviceCapability('meter_power');
      await this.updateCapability('meter_power', this.energy.getKwh());
    }
  }

  private async applyRoomSnapshot(): Promise<void> {
    const room = this.bridge.getRoom(this.roomId);
    if (!room) {
      return;
    }

    const snapshot = this.toRoomUpdate(room);
    await this.reconcileCapabilitiesForSnapshot(snapshot);
    await this.updateFromRoomState(snapshot);
  }

  private toRoomUpdate(room: XComfortRoom): RoomStateUpdate {
    return {
      setpoint: room.setpoint,
      temp: room.temp,
      humidity: room.humidity,
      power: room.power,
      valve: room.valve,
      lightsOn: room.lightsOn,
      windowsOpen: room.windowsOpen,
      doorsOpen: room.doorsOpen,
      currentMode: room.currentMode,
      mode: room.mode,
      state: room.state,
      temperatureOnly: room.temperatureOnly,
      raw: room.raw,
    };
  }

  private async updateFromRoomState(state: RoomStateUpdate): Promise<void> {
    await this.ensureCapabilitiesForState(state);

    if (typeof state.temp === 'number') {
      await this.updateCapability('measure_temperature', state.temp);
    }
    if (typeof state.humidity === 'number') {
      await this.updateCapability('measure_humidity', state.humidity);
    }
    if (typeof state.valve === 'number') {
      await this.updateCapability('xcomfort_heating_demand', this.clampPercentage(state.valve));
    }
    if (typeof state.power === 'number') {
      await this.updateCapability('measure_power', state.power);
      await this.energy.applyPower(state.power);
    }
    if (typeof state.lightsOn === 'number') {
      await this.updateCapability('xcomfort_lights_on', state.lightsOn);
    }
    if (typeof state.windowsOpen === 'number') {
      await this.updateCapability('xcomfort_windows_open', state.windowsOpen);
    }
    if (typeof state.doorsOpen === 'number') {
      await this.updateCapability('xcomfort_doors_open', state.doorsOpen);
    }

    const mode = state.currentMode ?? state.mode;
    if (mode !== undefined) {
      await this.updateCapability('xcomfort_current_mode', this.toModeCapability(mode));
    }
  }

  private async ensureCapabilitiesForState(state: RoomStateUpdate): Promise<void> {
    for (const { field, capability } of FIELD_CAPABILITY_MAP) {
      if (state[field] !== undefined) {
        await this.ensureDeviceCapability(capability);
      }
    }

    if (state.mode !== undefined) {
      await this.ensureDeviceCapability('xcomfort_current_mode');
    }
  }

  private async reconcileCapabilitiesForSnapshot(state: RoomStateUpdate): Promise<void> {
    const desiredCaps = new Set<string>();

    for (const { field, capability } of FIELD_CAPABILITY_MAP) {
      if (state[field] !== undefined) {
        desiredCaps.add(capability);
      }
    }

    if (state.mode !== undefined) {
      desiredCaps.add('xcomfort_current_mode');
    }
    if (desiredCaps.has('measure_power') || this.energy.getKwh() > 0) {
      desiredCaps.add('meter_power');
    }

    if (desiredCaps.size === 0) {
      return;
    }

    const managedCaps = new Set([
      ...FIELD_CAPABILITY_MAP.map((entry) => entry.capability),
      'meter_power',
    ]);

    for (const cap of this.getCapabilities()) {
      if (managedCaps.has(cap) && !desiredCaps.has(cap)) {
        await this.removeCapability(cap).catch(this.error);
      }
    }

    for (const cap of desiredCaps) {
      await this.ensureDeviceCapability(cap);
    }
  }

  private async ensureCapability(capabilityId: string): Promise<void> {
    if (!this.hasCapability(capabilityId)) {
      await this.addCapability(capabilityId).catch(this.error);
    }
  }

  private clampPercentage(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  private toModeCapability(value: number | ClimateMode): string {
    switch (Number(value)) {
      case ClimateMode.FrostProtection:
        return 'frost';
      case ClimateMode.Eco:
        return 'eco';
      case ClimateMode.Comfort:
        return 'comfort';
      default:
        return 'unknown';
    }
  }

  /** Reset the cumulative room energy meter to zero (used by the Flow action). */
  public async resetEnergyMeter(): Promise<void> {
    await this.energy.reset();
  }

  async onDeleted(): Promise<void> {
    if (this.roomRefreshTimer) {
      clearTimeout(this.roomRefreshTimer);
      this.roomRefreshTimer = null;
    }
    await this.energy.flush();
    super.onDeleted();
  }

  async onUninit(): Promise<void> {
    if (this.roomRefreshTimer) {
      clearTimeout(this.roomRefreshTimer);
      this.roomRefreshTimer = null;
    }
    await this.energy.flush();
    await super.onUninit();
  }

  private scheduleRoomStateRefresh(): void {
    if (this.roomRefreshTimer) {
      clearTimeout(this.roomRefreshTimer);
    }

    this.roomRefreshTimer = setTimeout(() => {
      this.roomRefreshTimer = null;
      this.bridge?.requestDeviceStates().catch(this.error);
    }, 1500);
  }
};
