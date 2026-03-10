import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { XCOMFORT_CAPABILITIES } from '../../lib/XComfortCapabilities';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';
import { resolveThermostatRoomId } from '../../lib/utils/resolveThermostatRoomId';
import {
  ClimateMode,
  ClimateState,
  DeviceStateUpdate,
  InfoEntry,
  RoomModeSetpoint,
  RoomStateUpdate,
  XComfortDevice,
  XComfortRoom,
} from '../../lib/types';

const DEFAULT_MODE_SETPOINTS: Record<number, number> = {
  [ClimateMode.FrostProtection]: 8,
  [ClimateMode.Eco]: 18,
  [ClimateMode.Comfort]: 21,
};

const MODE_SETPOINT_RANGES: Record<number, { min: number; max: number }> = {
  [ClimateMode.Unknown]: { min: 5, max: 40 },
  [ClimateMode.FrostProtection]: { min: 5, max: 20 },
  [ClimateMode.Eco]: { min: 10, max: 30 },
  [ClimateMode.Comfort]: { min: 18, max: 40 },
};

type ThermostatModeCapability = 'auto' | 'heat' | 'cool' | 'off';
type PresetCapabilityValue = 'frost' | 'eco' | 'comfort';

interface ThermostatDeviceData {
  roomId?: string | number;
}

interface ThermostatSettings {
  room_id_override?: string;
  estimated_active_power_watts?: number | string;
}

module.exports = class ThermostatDevice extends BaseDevice {
  private debug: boolean = false;
  private roomId: string | null = null;
  private roomStateBound: boolean = false;
  private currentPreset: ClimateMode = ClimateMode.Unknown;
  private currentClimateState: ClimateState = ClimateState.Off;
  private currentSetpoint: number = 20;
  private targetRangeKey: string | null = null;
  private modeSetpoints: Map<ClimateMode, number> = new Map();
  private linkedSensorId: string | null = null;
  private linkedSensorTemperatureAvailable: boolean = false;
  private linkedSensorHumidityAvailable: boolean = false;
  private energyKwh: number = 0;
  private lastEnergyAt: number | null = null;
  private lastPowerW: number = 0;
  private currentHeatingDemand: number | null = null;
  private lastPowerSource: 'none' | 'live' | 'estimated' = 'none';
  private energyTimer: NodeJS.Timeout | null = null;
  private onDevicesLoaded?: () => void;

  async onDeviceReady() {
    this.debug = process.env.XCOMFORT_DEBUG === '1';

    await this.ensureCapabilities();
    await this.restoreEnergyState();
    this.registerStateListener();
    this.registerCapabilityListeners();
    this.registerDevicesLoadedListener();
    await this.tryBindRoomState();
  }

  async onSettings({ newSettings, changedKeys }: { newSettings: Record<string, unknown>, changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes('room_id_override')) {
      const override = newSettings.room_id_override as string;
      this.log(`Room override changed to: ${override}`);
      this.roomStateBound = false;
      
      // Cleanup old listener if it exists
      if (this.roomId) {
         this.removeManagedRoomStateListener(this.roomId);
      }
      this.roomId = null;

      if (this.bridge && this.bridge.isConnected) {
         void this.tryBindRoomState();
      }
    }

    if (changedKeys.includes('estimated_active_power_watts')) {
      const newPower = newSettings.estimated_active_power_watts;
      const watts = typeof newPower === 'number' ? newPower : Number(newPower) || 0;
      this.log(`Estimated active power changed to: ${watts}W`);
      await this.refreshEstimatedPowerMeasurement(watts);
    }
  }

  protected onBridgeChanged(newBridge: XComfortBridge, oldBridge: XComfortBridge): void {
    if (this.onDevicesLoaded) {
      oldBridge.removeListener('devices_loaded', this.onDevicesLoaded);
    }
    this.registerDevicesLoadedListener();
    if (!this.roomStateBound) {
      void this.tryBindRoomState();
      return;
    }

    const room = this.roomId ? this.bridge.getRoom(this.roomId) : undefined;
    if (room) {
      void this.applyRoomSnapshot(room);
    }
  }

  onDeleted(): void {
    this.flushEnergyTracking();
    if (this.onDevicesLoaded) {
      this.bridge.removeListener('devices_loaded', this.onDevicesLoaded);
      this.onDevicesLoaded = undefined;
    }
    super.onDeleted();
  }

  private registerDevicesLoadedListener(): void {
    if (!this.onDevicesLoaded) {
      this.onDevicesLoaded = () => {
        void this.tryBindRoomState();
      };
    }

    this.bridge.removeListener('devices_loaded', this.onDevicesLoaded);
    this.bridge.on('devices_loaded', this.onDevicesLoaded);
  }

  private async ensureCapabilities(): Promise<void> {
    if (!this.hasCapability('thermostat_mode')) {
      await this.addCapability('thermostat_mode').catch(this.error);
    }

    if (!this.hasCapability(XCOMFORT_CAPABILITIES.PRESET_MODE)) {
      await this.addCapability(XCOMFORT_CAPABILITIES.PRESET_MODE).catch(this.error);
    }
  }

  private registerStateListener() {
    this.addManagedStateListener(this.deviceId, (_id, data) => {
      void this.updateDeviceState(data);
    });

    // Virtual Rocker Logic for RC Touch
    const device = this.bridge.getDevice(this.deviceId);
    if (device && device.devType === DEVICE_TYPES.RC_TOUCH) {
      const numericDeviceId = Number(this.deviceId);
      if (Number.isNaN(numericDeviceId)) {
        this.error(`[Thermostat] Invalid RC_TOUCH deviceId for virtual rocker mapping: ${this.deviceId}`);
        return;
      }
      const virtualId = String(numericDeviceId + 1);
      this.log(`Device is RC_TOUCH, listening to virtual rocker ${virtualId}`);

      const triggerOn = this.homey.flow.getDeviceTriggerCard('thermostat_button_on');
      const triggerOff = this.homey.flow.getDeviceTriggerCard('thermostat_button_off');

      this.addManagedStateListener(virtualId, (_id, data) => {
        if (this.debug) {
          this.log(`Virtual Rocker update:`, data);
        }
        if (data.switch === true) {
          triggerOn?.trigger(this, {}, {}).catch(this.error);
        } else if (data.switch === false) {
          triggerOff?.trigger(this, {}, {}).catch(this.error);
        }
      });
    }
  }

  private async tryBindRoomState(): Promise<void> {
    if (this.roomStateBound) {
      const room = this.roomId ? this.bridge.getRoom(this.roomId) : undefined;
      if (room) {
        await this.applyRoomSnapshot(room);
      }
      return;
    }

    const resolvedRoomId = this.resolveRoomId();
    if (!resolvedRoomId) {
      return;
    }

    this.roomId = resolvedRoomId;
    this.roomStateBound = true;
    this.addManagedRoomStateListener(resolvedRoomId, (_id, data) => {
      void this.updateRoomState(data);
    });

    await this.setStoreValue('roomId', resolvedRoomId).catch(this.error);

    const room = this.bridge.getRoom(resolvedRoomId);
    if (room) {
      await this.applyRoomSnapshot(room);
    }

    if (this.debug) {
      this.log(`[Thermostat] Bound ${this.getName()} to room ${resolvedRoomId}`);
    }
  }

  private resolveRoomId(): string | null {
    const settings = this.getSettings() as ThermostatSettings;
    const overrideId = settings.room_id_override;
    const storedRoomId = this.getStoreValue('roomId');
    const data = this.getData() as ThermostatDeviceData;
    const device = this.bridge.getDevice(this.deviceId);
    
    return resolveThermostatRoomId(device, this.bridge.getRooms(), [
      overrideId,
      storedRoomId,
      data.roomId
    ]);
  }

  private async applyRoomSnapshot(room: XComfortRoom): Promise<void> {
    await this.tryBindRoomSensor(room);

    const update: RoomStateUpdate = {
      setpoint: room.setpoint,
      temp: room.temp,
      humidity: room.humidity,
      power: room.power,
      valve: room.valve,
      currentMode: room.currentMode,
      mode: room.mode,
      state: room.state,
      temperatureOnly: room.temperatureOnly,
      modes: Array.isArray(room.modes) ? room.modes : undefined,
      raw: room.raw,
    };

    await this.updateRoomState(update);
  }

  private async updateDeviceState(data: DeviceStateUpdate) {
    if (this.debug) {
      this.log(`Thermostat device update:`, data);
    }

    if (data.operationMode !== undefined) {
      await this.applyPreset(this.toClimateMode(data.operationMode));
    }

    if (data.tempState !== undefined) {
      await this.applyClimateState(this.toClimateState(data.tempState));
    }

    if (data.setpoint !== undefined && !this.roomStateBound) {
      this.currentSetpoint = this.clampSetpoint(data.setpoint, this.getEffectivePreset());
      await this.updateCapability('target_temperature', this.currentSetpoint);
    } else if ((data.operationMode !== undefined || data.tempState !== undefined) && !this.roomStateBound) {
      await this.syncDisplayedSetpoint();
    }

    if (data.metadata?.temperature !== undefined) {
      await this.updateCapability('measure_temperature', data.metadata.temperature);
    }

    if (data.metadata?.humidity !== undefined) {
      await this.ensureHumidityCapability();
      await this.updateCapability('measure_humidity', data.metadata.humidity);
    }

    if (data.metadata?.heatingDemand !== undefined) {
      await this.applyHeatingDemand(data.metadata.heatingDemand);
    }

    if (typeof data.dimmvalue === 'number') {
      await this.applyHeatingDemand(data.dimmvalue);
    }

    if (typeof data.power === 'number') {
      await this.applyPowerMeasurement(data.power, 'live');
    } else {
      await this.refreshEstimatedPowerMeasurement();
    }
  }

  private async updateRoomState(data: RoomStateUpdate) {
    if (this.debug) {
      this.log(`Thermostat room update:`, data);
    }

    if (Array.isArray(data.modes)) {
      this.storeModeSetpoints(data.modes);
    }

    let nextMode: ClimateMode | null = null;
    if (data.currentMode !== undefined) {
      nextMode = this.toClimateMode(data.currentMode);
    }
    if (data.mode !== undefined) {
      nextMode = this.toClimateMode(data.mode);
    }
    if (nextMode !== null) {
      await this.applyPreset(nextMode);
    }

    if (data.state !== undefined) {
      await this.applyClimateState(this.toClimateState(data.state));
    }

    const effectiveMode = nextMode ?? this.getEffectivePreset();
    const incomingSetpoint = typeof data.setpoint === 'number' ? data.setpoint : undefined;
    const displaySetpoint = this.getDisplaySetpoint(incomingSetpoint, effectiveMode);
    if (displaySetpoint !== undefined) {
      this.currentSetpoint = this.clampSetpoint(displaySetpoint, effectiveMode);
      await this.updateCapability('target_temperature', this.currentSetpoint);
    }

    if (typeof data.temp === 'number' && !this.linkedSensorTemperatureAvailable) {
      await this.updateCapability('measure_temperature', data.temp);
    }

    if (typeof data.humidity === 'number' && !this.linkedSensorHumidityAvailable) {
      await this.ensureHumidityCapability();
      await this.updateCapability('measure_humidity', data.humidity);
    }

    if (typeof data.valve === 'number') {
      await this.applyHeatingDemand(data.valve);
    }

    if (typeof data.power === 'number') {
      await this.applyPowerMeasurement(data.power, 'live');
    } else {
      await this.refreshEstimatedPowerMeasurement();
    }
  }

  private registerCapabilityListeners() {
    this.registerCapabilityListener('target_temperature', async (value) => {
      if (!this.bridge) {
        throw new Error('Bridge offline');
      }

      const roomId = await this.ensureRoomIdForControl();
      if (!roomId) {
        throw new Error('No linked xComfort room found for temperature control');
      }

      const mode = this.getEffectivePreset(ClimateMode.Comfort);
      const state = this.currentClimateState;
      const setpoint = this.clampSetpoint(value, mode);

      await this.bridge.setRoomHeatingState(roomId, mode, state, setpoint);
      this.modeSetpoints.set(mode, setpoint);
      this.currentSetpoint = setpoint;
      await this.updateCapability('target_temperature', setpoint);
    });

    this.registerCapabilityListener(XCOMFORT_CAPABILITIES.PRESET_MODE, async (value: PresetCapabilityValue) => {
      await this.setPresetModeAction(value);
    });

    this.registerCapabilityListener('thermostat_mode', async (value: ThermostatModeCapability) => {
      const roomId = await this.ensureRoomIdForControl();
      if (!roomId) {
        throw new Error('No linked xComfort room found for thermostat mode control');
      }

      if (value === 'cool') {
        throw new Error('Cooling mode is not supported by xComfort thermostat presets');
      }

      const currentMode = this.getEffectivePreset(ClimateMode.Comfort);
      const nextMode = value === 'off' ? ClimateMode.FrostProtection : currentMode;
      const nextState = this.fromThermostatModeCapability(value);
      const commandSetpoint = value === 'off'
        ? 0
        : this.clampSetpoint(this.getModeSetpoint(nextMode), nextMode);

      await this.bridge.setRoomHeatingState(roomId, nextMode, nextState, commandSetpoint);

      await this.applyPreset(nextMode);
      await this.applyClimateState(nextState);

      if (value === 'off') {
        this.currentSetpoint = this.getModeSetpoint(ClimateMode.FrostProtection);
      } else {
        this.currentSetpoint = commandSetpoint;
      }
      await this.updateCapability('target_temperature', this.currentSetpoint);
    });
  }

  public async setPresetModeAction(value: PresetCapabilityValue): Promise<void> {
    const roomId = await this.ensureRoomIdForControl();
    if (!roomId) {
      throw new Error('No linked xComfort room found for preset control');
    }

    const targetMode = this.fromPresetCapability(value);
    if (targetMode === this.currentPreset && this.currentClimateState !== ClimateState.Off) {
      return;
    }

    const nextState = this.getPresetState(targetMode);
    const currentMode = this.getEffectivePreset(targetMode);
    const currentSetpoint = this.clampSetpoint(this.getModeSetpoint(currentMode), currentMode);
    const newSetpoint = this.clampSetpoint(this.getModeSetpoint(targetMode), targetMode);

    // Mirror the upstream HA implementation: force manual state first, then switch preset.
    await this.bridge.setRoomHeatingState(roomId, currentMode, nextState, currentSetpoint);
    await this.bridge.setRoomHeatingState(roomId, targetMode, nextState, newSetpoint);

    await this.applyPreset(targetMode);
    await this.applyClimateState(nextState);
    this.currentSetpoint = newSetpoint;
    this.modeSetpoints.set(targetMode, newSetpoint);
    await this.updateCapability('target_temperature', newSetpoint);
  }

  private async ensureRoomIdForControl(): Promise<string | null> {
    if (!this.roomStateBound) {
      await this.tryBindRoomState();
    }
    return this.roomId;
  }

  private async ensureHumidityCapability(): Promise<void> {
    if (!this.hasCapability('measure_humidity')) {
      await this.addCapability('measure_humidity').catch(this.error);
    }
  }

  private async ensurePowerCapability(): Promise<void> {
    if (!this.hasCapability('measure_power')) {
      await this.addCapability('measure_power').catch(this.error);
    }
  }

  private async ensureEnergyCapability(): Promise<void> {
    if (!this.hasCapability('meter_power')) {
      await this.addCapability('meter_power').catch(this.error);
    }
  }

  private async ensureHeatingDemandCapability(): Promise<void> {
    if (!this.hasCapability(XCOMFORT_CAPABILITIES.HEATING_DEMAND)) {
      await this.addCapability(XCOMFORT_CAPABILITIES.HEATING_DEMAND).catch(this.error);
    }
  }

  private storeModeSetpoints(modes: RoomModeSetpoint[]): void {
    modes.forEach((mode) => {
      const normalizedMode = this.toClimateMode(mode.mode);
      if (normalizedMode === ClimateMode.Unknown) {
        return;
      }
      this.modeSetpoints.set(normalizedMode, mode.value);
    });
  }

  private async applyPreset(mode: ClimateMode): Promise<void> {
    if (mode === ClimateMode.Unknown) {
      return;
    }

    this.currentPreset = mode;
    await this.syncPresetCapability(mode);
    await this.syncTargetTemperatureOptions(mode);
  }

  private async applyClimateState(state: ClimateState): Promise<void> {
    this.currentClimateState = state;
    await this.updateCapability('thermostat_mode', this.toThermostatModeCapability(state));
    await this.refreshEstimatedPowerMeasurement();
  }

  private async syncPresetCapability(mode: ClimateMode): Promise<void> {
    const value = this.toPresetCapability(mode);
    if (value) {
      const prev = this.getCapabilityValue(XCOMFORT_CAPABILITIES.PRESET_MODE);
      await this.updateCapability(XCOMFORT_CAPABILITIES.PRESET_MODE, value);
      
      if (prev !== value) {
        const trigger = this.homey.flow.getDeviceTriggerCard('xcomfort_preset_changed');
        if (trigger) {
          await trigger.trigger(this, { preset: value }).catch(this.error);
        }
      }
    }
  }

  private async syncTargetTemperatureOptions(mode: ClimateMode): Promise<void> {
    const range = MODE_SETPOINT_RANGES[mode] || MODE_SETPOINT_RANGES[ClimateMode.Unknown];
    const nextKey = `${range.min}:${range.max}`;
    if (this.targetRangeKey === nextKey) {
      return;
    }

    this.targetRangeKey = nextKey;
    await this.setCapabilityOptions('target_temperature', {
      min: range.min,
      max: range.max,
      step: 0.5,
    }).catch(this.error);
  }

  private async syncDisplayedSetpoint(): Promise<void> {
    const displaySetpoint = this.getDisplaySetpoint(undefined, this.getEffectivePreset());
    if (displaySetpoint === undefined) {
      return;
    }

    this.currentSetpoint = this.clampSetpoint(displaySetpoint, this.getEffectivePreset());
    await this.updateCapability('target_temperature', this.currentSetpoint);
  }

  private getDisplaySetpoint(
    incomingSetpoint: number | undefined,
    mode: ClimateMode,
  ): number | undefined {
    if (typeof incomingSetpoint === 'number' && incomingSetpoint > 0) {
      return incomingSetpoint;
    }

    if (mode !== ClimateMode.Unknown) {
      return this.getModeSetpoint(mode);
    }

    return undefined;
  }

  private getModeSetpoint(mode: ClimateMode): number {
    return this.modeSetpoints.get(mode)
      ?? DEFAULT_MODE_SETPOINTS[mode]
      ?? this.currentSetpoint;
  }

  private clampSetpoint(value: number, mode: ClimateMode): number {
    const range = MODE_SETPOINT_RANGES[mode] || MODE_SETPOINT_RANGES[ClimateMode.Unknown];
    return Math.max(range.min, Math.min(range.max, value));
  }

  private getEffectivePreset(fallback: ClimateMode = ClimateMode.Unknown): ClimateMode {
    return this.currentPreset !== ClimateMode.Unknown ? this.currentPreset : fallback;
  }

  private getPresetState(mode: ClimateMode): ClimateState {
    // xComfort presets are heating presets, so preset changes should always
    // drive the room into a heating state instead of preserving Homey's generic
    // cooling mode semantics.
    return ClimateState.HeatingManual;
  }

  private toClimateMode(value: number | ClimateMode): ClimateMode {
    switch (Number(value)) {
      case ClimateMode.FrostProtection:
        return ClimateMode.FrostProtection;
      case ClimateMode.Eco:
        return ClimateMode.Eco;
      case ClimateMode.Comfort:
        return ClimateMode.Comfort;
      default:
        return ClimateMode.Unknown;
    }
  }

  private toClimateState(value: number | ClimateState): ClimateState {
    switch (Number(value)) {
      case ClimateState.Off:
        return ClimateState.Off;
      case ClimateState.HeatingAuto:
        return ClimateState.HeatingAuto;
      case ClimateState.HeatingManual:
        return ClimateState.HeatingManual;
      case ClimateState.CoolingAuto:
        return ClimateState.CoolingAuto;
      case ClimateState.CoolingManual:
        return ClimateState.CoolingManual;
      default:
        return ClimateState.Off;
    }
  }

  private toPresetCapability(mode: ClimateMode): PresetCapabilityValue | null {
    switch (mode) {
      case ClimateMode.FrostProtection:
        return 'frost';
      case ClimateMode.Eco:
        return 'eco';
      case ClimateMode.Comfort:
        return 'comfort';
      default:
        return null;
    }
  }

  private fromPresetCapability(value: PresetCapabilityValue): ClimateMode {
    switch (value) {
      case 'frost':
        return ClimateMode.FrostProtection;
      case 'eco':
        return ClimateMode.Eco;
      case 'comfort':
      default:
        return ClimateMode.Comfort;
    }
  }

  private toThermostatModeCapability(state: ClimateState): ThermostatModeCapability {
    switch (state) {
      case ClimateState.HeatingAuto:
      case ClimateState.CoolingAuto:
        return 'auto';
      case ClimateState.HeatingManual:
      case ClimateState.CoolingManual:
        return 'heat';
      case ClimateState.Off:
      default:
        return 'off';
    }
  }

  private fromThermostatModeCapability(value: ThermostatModeCapability): ClimateState {
    switch (value) {
      case 'auto':
        return ClimateState.HeatingAuto;
      case 'heat':
        return ClimateState.HeatingManual;
      case 'cool':
        return ClimateState.HeatingManual;
      case 'off':
      default:
        return ClimateState.Off;
    }
  }

  private async tryBindRoomSensor(room?: XComfortRoom): Promise<void> {
    const sensorId = this.resolveRoomSensorId(room);
    if (!sensorId || sensorId === this.deviceId) {
      this.linkedSensorId = null;
      this.linkedSensorTemperatureAvailable = false;
      this.linkedSensorHumidityAvailable = false;
      return;
    }

    if (this.linkedSensorId !== sensorId) {
      this.linkedSensorId = sensorId;
      this.linkedSensorTemperatureAvailable = false;
      this.linkedSensorHumidityAvailable = false;
      const boundSensorId = sensorId;
      this.addManagedStateListener(boundSensorId, (_id, data) => {
        if (this.linkedSensorId !== boundSensorId) {
          return;
        }
        void this.updateLinkedSensorState(data);
      });
    }

    await this.applyLinkedSensorSnapshot(sensorId);
  }

  private resolveRoomSensorId(room?: XComfortRoom): string | null {
    const sourceRoom = room ?? (this.roomId ? this.bridge.getRoom(this.roomId) : undefined);
    if (!sourceRoom) {
      return null;
    }

    if (sourceRoom.roomSensorId !== undefined && sourceRoom.roomSensorId !== null) {
      return String(sourceRoom.roomSensorId);
    }

    const rawRoomSensorId = sourceRoom.raw?.roomSensorId;
    if (typeof rawRoomSensorId === 'string' || typeof rawRoomSensorId === 'number') {
      return String(rawRoomSensorId);
    }

    return null;
  }

  private async applyLinkedSensorSnapshot(sensorId: string): Promise<void> {
    const sensorDevice = this.bridge.getDevice(sensorId);
    if (!sensorDevice || !Array.isArray(sensorDevice.info)) {
      this.linkedSensorTemperatureAvailable = false;
      this.linkedSensorHumidityAvailable = false;
      return;
    }

    const metadata = parseInfoMetadata(sensorDevice.info as InfoEntry[]);
    const temperature = typeof metadata.temperature === 'number' ? metadata.temperature : null;
    const humidity = typeof metadata.humidity === 'number' ? metadata.humidity : null;
    this.linkedSensorTemperatureAvailable = temperature !== null;
    this.linkedSensorHumidityAvailable = humidity !== null;

    if (this.linkedSensorTemperatureAvailable) {
      await this.updateCapability('measure_temperature', temperature);
    }

    if (this.linkedSensorHumidityAvailable) {
      await this.ensureHumidityCapability();
      await this.updateCapability('measure_humidity', humidity);
    }
  }

  private async updateLinkedSensorState(data: DeviceStateUpdate): Promise<void> {
    if (typeof data.metadata?.temperature === 'number') {
      this.linkedSensorTemperatureAvailable = true;
      await this.updateCapability('measure_temperature', data.metadata.temperature);
    }

    if (typeof data.metadata?.humidity === 'number') {
      this.linkedSensorHumidityAvailable = true;
      await this.ensureHumidityCapability();
      await this.updateCapability('measure_humidity', data.metadata.humidity);
    }
  }

  private async restoreEnergyState(): Promise<void> {
    const storedValue = this.getStoreValue('meterPowerKwh');
    if (typeof storedValue !== 'number' || !Number.isFinite(storedValue) || storedValue <= 0) {
      return;
    }

    this.energyKwh = storedValue;
    await this.ensureEnergyCapability();
    await this.updateCapability('meter_power', this.roundEnergyValue(this.energyKwh));
  }

  private async applyHeatingDemand(value: number): Promise<void> {
    const normalizedDemand = Math.max(0, Math.min(100, value));
    this.currentHeatingDemand = normalizedDemand;
    await this.ensureHeatingDemandCapability();
    await this.updateCapability(XCOMFORT_CAPABILITIES.HEATING_DEMAND, normalizedDemand);
    await this.refreshEstimatedPowerMeasurement();
  }

  private async refreshEstimatedPowerMeasurement(overrideWatts?: number): Promise<void> {
    const configuredPower = overrideWatts !== undefined ? overrideWatts : this.getEstimatedActivePowerWatts();
    if (configuredPower <= 0) {
      if (this.lastPowerSource === 'estimated') {
        await this.applyPowerMeasurement(0, 'estimated');
      }
      return;
    }

    await this.applyPowerMeasurement(this.estimateCurrentPower(configuredPower), 'estimated');
  }

  private getEstimatedActivePowerWatts(): number {
    const settings = this.getSettings() as ThermostatSettings;
    const rawValue = settings.estimated_active_power_watts;
    const parsedValue = typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string'
        ? Number(rawValue)
        : 0;

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return 0;
    }

    return parsedValue;
  }

  private estimateCurrentPower(configuredPower: number): number {
    if (this.currentClimateState === ClimateState.Off) {
      return 0;
    }

    if (this.currentHeatingDemand !== null) {
      return this.roundPowerValue((configuredPower * this.currentHeatingDemand) / 100);
    }

    if (this.currentClimateState === ClimateState.HeatingAuto || this.currentClimateState === ClimateState.HeatingManual) {
      return configuredPower;
    }

    return 0;
  }

  private async applyPowerMeasurement(power: number, source: 'live' | 'estimated' = 'live'): Promise<void> {
    const sanitizedPower = this.roundPowerValue(Math.max(0, power));
    this.lastPowerSource = source;
    await this.ensurePowerCapability();
    await this.updateCapability('measure_power', sanitizedPower);

    this.integrateEnergy(Date.now());
    this.lastPowerW = sanitizedPower;
    await this.persistEnergyReading();

    if (sanitizedPower > 0) {
      this.startEnergyTimer();
      return;
    }

    this.stopEnergyTimer();
  }

  private integrateEnergy(now: number): void {
    if (this.lastEnergyAt !== null && now > this.lastEnergyAt && this.lastPowerW > 0) {
      const elapsedMs = now - this.lastEnergyAt;
      this.energyKwh += (this.lastPowerW * elapsedMs) / 3600000000;
    }

    this.lastEnergyAt = now;
  }

  private startEnergyTimer(): void {
    if (this.energyTimer) {
      return;
    }

    this.energyTimer = setInterval(() => {
      this.integrateEnergy(Date.now());
      void this.persistEnergyReading();
    }, 60000);
  }

  private stopEnergyTimer(): void {
    if (!this.energyTimer) {
      return;
    }

    clearInterval(this.energyTimer);
    this.energyTimer = null;
  }

  private flushEnergyTracking(): void {
    this.integrateEnergy(Date.now());
    this.stopEnergyTimer();
    void this.persistEnergyReading();
  }

  private async persistEnergyReading(): Promise<void> {
    await this.ensureEnergyCapability();
    const roundedValue = this.roundEnergyValue(this.energyKwh);
    await this.updateCapability('meter_power', roundedValue);
    await this.setStoreValue('meterPowerKwh', roundedValue).catch(this.error);
  }

  private roundEnergyValue(value: number): number {
    return Number(value.toFixed(6));
  }

  private roundPowerValue(value: number): number {
    return Number(value.toFixed(1));
  }
};
