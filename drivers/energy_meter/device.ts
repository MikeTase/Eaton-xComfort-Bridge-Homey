import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { XCOMFORT_CAPABILITIES } from '../../lib/XComfortCapabilities';
import type { BridgeStatus, DeviceStateUpdate } from '../../lib/types';
import { EnergyTracker } from '../../lib/utils/EnergyTracker';
import { extractHistoryPeriods } from '../../lib/utils/energyHistory';

interface EnergyMeterData {
  meterId?: string | number;
  loadId?: string | number;
  meterKind?: string;
}

const WHOLE_HOME_METER_SETTING = 'whole_home_meter';
const LEGACY_ENERGY_CUMULATIVE_SETTING = 'energy_cumulative';

module.exports = class EnergyMeterDevice extends BaseDevice {
  private onBridgeStatus?: (status: BridgeStatus) => void;
  private energy = new EnergyTracker(
    async (kwh) => {
      await this.ensureDeviceCapability('meter_power');
      await this.updateCapability('meter_power', kwh);
    },
    {
      onPersist: async (kwh) => {
        await this.setStoreValue('meterPowerKwh', kwh).catch(this.error);
      },
    },
  );

  async onDeviceReady() {
    await this.restoreEnergyState();
    await this.applyWholeHomeEnergySetting(await this.getWholeHomeEnergySettings());
    this.registerCapabilityListeners();
    this.registerBridgeStatusListener();
    this.registerDeviceStateListenerIfAvailable();
    await this.applyDeviceSnapshot();
    await this.applyStatus(this.bridge.getLastBridgeStatus());
  }

  /**
   * Handle device settings changes. When the user marks this meter as a
   * whole-home (cumulative) meter, Homey Energy treats it as a home meter
   * instead of a regular consuming device.
   */
  async onSettings({ newSettings, changedKeys }: { newSettings: Record<string, unknown>; changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes(WHOLE_HOME_METER_SETTING) || changedKeys.includes(LEGACY_ENERGY_CUMULATIVE_SETTING)) {
      await this.applyWholeHomeEnergySetting(newSettings);
    }
  }

  protected onBridgeChanged(newBridge: XComfortBridge, oldBridge: XComfortBridge): void {
    if (this.onBridgeStatus) {
      oldBridge.removeListener('bridge_status', this.onBridgeStatus);
    }
    this.registerBridgeStatusListener();
    void this.applyStatus(newBridge.getLastBridgeStatus());
  }

  async onDeleted(): Promise<void> {
    await this.energy.flush();
    if (this.onBridgeStatus && this.bridge) {
      this.bridge.removeListener('bridge_status', this.onBridgeStatus);
      this.onBridgeStatus = undefined;
    }
    super.onDeleted();
  }

  async onUninit(): Promise<void> {
    await this.energy.flush();
    if (this.onBridgeStatus && this.bridge) {
      this.bridge.removeListener('bridge_status', this.onBridgeStatus);
      this.onBridgeStatus = undefined;
    }
    await super.onUninit();
  }

  public async resetEnergyMeter(): Promise<void> {
    await this.energy.reset();
  }

  public async setLoadModeAction(mode: string): Promise<void> {
    const normalizedMode = this.normalizeLoadMode(mode);
    await this.bridge.setEnergyLoadMode(this.getMeterIdForControl(), normalizedMode);
    await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.LOAD_MODE);
    await this.updateCapability(XCOMFORT_CAPABILITIES.LOAD_MODE, normalizedMode);
  }

  public async refreshEnergyData(): Promise<void> {
    await this.bridge.requestEnergyData(this.getMeterIdForControl());
  }

  private registerCapabilityListeners(): void {
    if (!this.hasCapability(XCOMFORT_CAPABILITIES.LOAD_MODE)) {
      return;
    }

    this.registerCapabilityListener(XCOMFORT_CAPABILITIES.LOAD_MODE, async (value: string) => {
      await this.setLoadModeAction(value);
    });
  }

  private async applyWholeHomeEnergySetting(settings: Record<string, unknown>): Promise<void> {
    const cumulative = settings[WHOLE_HOME_METER_SETTING] === true || settings[LEGACY_ENERGY_CUMULATIVE_SETTING] === true;
    await this.setEnergy({ cumulative });
    this.log(`Energy meter marked as ${cumulative ? 'whole-home (cumulative)' : 'regular'} meter`);
  }

  private async getWholeHomeEnergySettings(): Promise<Record<string, unknown>> {
    const settings = this.getSettings() as Record<string, unknown>;
    if (settings[WHOLE_HOME_METER_SETTING] !== true && settings[LEGACY_ENERGY_CUMULATIVE_SETTING] === true) {
      settings[WHOLE_HOME_METER_SETTING] = true;
      await this.setSettings({ [WHOLE_HOME_METER_SETTING]: true }).catch(this.error);
    }
    return settings;
  }

  private registerBridgeStatusListener(): void {
    if (!this.onBridgeStatus) {
      this.onBridgeStatus = (status: BridgeStatus) => {
        void this.applyStatus(status);
      };
    }

    this.bridge.removeListener('bridge_status', this.onBridgeStatus);
    this.bridge.on('bridge_status', this.onBridgeStatus);
  }

  private registerDeviceStateListenerIfAvailable(): void {
    if (!this.bridge.getDevice(this.deviceId)) {
      return;
    }

    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      void this.applyMeasurements(state as Record<string, unknown>);
    });
  }

  private async applyDeviceSnapshot(): Promise<void> {
    const device = this.bridge.getDevice(this.deviceId);
    if (!device) {
      return;
    }

    await this.applyMeasurements(device);
  }

  private async applyStatus(status: BridgeStatus | null): Promise<void> {
    if (!status) {
      return;
    }

    const source = this.resolveMeterStatus(status);
    await this.applyMeasurements(source, status);
  }

  private async applyMeasurements(source: Record<string, unknown>, fallback?: Record<string, unknown>): Promise<void> {
    const power = this.getNumber(source, [
      'power',
      'activePower',
      'currentPower',
      'powerW',
      'instantPower',
      'actualPower',
      'powerConsumption',
      'watts',
    ])
      ?? (fallback ? this.getNumber(fallback, ['power']) : undefined);
    if (typeof power === 'number') {
      await this.ensureDeviceCapability('measure_power');
      await this.updateCapability('measure_power', this.round(power));
    }

    const current = this.getNumber(source, ['current', 'currentA', 'ampere', 'amperes', 'amps'])
      ?? (fallback ? this.getNumber(fallback, ['current']) : undefined);
    if (typeof current === 'number') {
      await this.ensureDeviceCapability('measure_current');
      await this.updateCapability('measure_current', this.round(current));
    }

    const voltage = this.getNumber(source, ['voltage', 'voltageV', 'volt', 'volts'])
      ?? (fallback ? this.getNumber(fallback, ['voltage']) : undefined);
    if (typeof voltage === 'number') {
      await this.ensureDeviceCapability('measure_voltage');
      await this.updateCapability('measure_voltage', this.round(voltage));
    }

    const pulses = this.getNumber(source, ['pulses', 'pulse', 'pulseCount', 'impulses', 'counter'])
      ?? (fallback ? this.getNumber(fallback, ['pulses']) : undefined);
    if (typeof pulses === 'number') {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.PULSES);
      await this.updateCapability(XCOMFORT_CAPABILITIES.PULSES, Math.max(0, Math.round(pulses)));
    }

    const energyCost = this.getNumber(source, ['cost', 'energyCost', 'totalCost', 'totalPrice'])
      ?? (fallback ? this.getNumber(fallback, ['energyCost']) : undefined);
    if (typeof energyCost === 'number') {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.ENERGY_COST);
      await this.updateCapability(XCOMFORT_CAPABILITIES.ENERGY_COST, Number(energyCost.toFixed(2)));
    }

    const tariff = this.getNumber(source, [
      'tariff',
      'tariffId',
      'currentTariff',
      'tariffPrice',
      'priceNow',
      'currentPrice',
      'pricePerKwh',
      'rate',
    ])
      ?? (fallback ? this.getNumber(fallback, ['tariff']) : undefined);
    if (typeof tariff === 'number') {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.ENERGY_TARIFF);
      await this.updateCapability(XCOMFORT_CAPABILITIES.ENERGY_TARIFF, Number(tariff.toFixed(4)));
    }

    const tariffLabel = this.getString(source, [
      'tariffLabel',
      'tariffName',
      'tariffText',
      'currentTariffName',
      'currentTariffLabel',
      'priceArea',
      'priceZone',
      'tariffCode',
    ]) ?? (fallback ? this.getString(fallback, ['tariffLabel']) : undefined)
      ?? this.getNonNumericString(source, ['tariff', 'currentTariff']);
    if (tariffLabel) {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.ENERGY_TARIFF_LABEL);
      await this.updateCapability(XCOMFORT_CAPABILITIES.ENERGY_TARIFF_LABEL, tariffLabel);
    }

    const currency = this.getString(source, [
      'currency',
      'currencyCode',
      'energyCurrency',
      'costCurrency',
      'tariffCurrency',
    ]) ?? (fallback ? this.getString(fallback, ['currency']) : undefined);
    if (currency) {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.ENERGY_CURRENCY);
      await this.updateCapability(XCOMFORT_CAPABILITIES.ENERGY_CURRENCY, currency.toUpperCase());
    }

    const history = this.getFirstDefined(source, [
      'history',
      'energyHistory',
      'consumptionHistory',
      'historicEnergy',
      'periods',
      'dayHistory',
      'daily',
      'weekHistory',
      'weekly',
      'monthHistory',
      'monthly',
      'yearHistory',
      'yearly',
    ]) ?? (fallback ? this.getFirstDefined(fallback, ['energyHistory']) : undefined);
    if (history !== undefined) {
      const summary = this.formatEnergyHistory(history, currency);
      if (summary) {
        await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.ENERGY_HISTORY);
        await this.updateCapability(XCOMFORT_CAPABILITIES.ENERGY_HISTORY, summary);
      }
      await this.applyEnergyHistoryInsights(history);
      await this.setStoreValue('energyHistoryRaw', history).catch(this.error);
    }

    const loadMode = this.getLoadMode(source) ?? (fallback ? this.getLoadMode(fallback) : undefined);
    if (loadMode) {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.LOAD_MODE);
      await this.updateCapability(XCOMFORT_CAPABILITIES.LOAD_MODE, loadMode);
    }

    const directEnergy = this.getNumber(source, [
      'energy',
      'energyKwh',
      'kwh',
      'totalEnergy',
      'electricalEnergy',
      'consumption',
      'totalConsumption',
      'consumptionKwh',
      'totalKwh',
      'importEnergy',
      'meterPower',
    ]) ?? (fallback ? this.getNumber(fallback, ['energyKwh', 'energy']) : undefined);

    if (typeof directEnergy === 'number') {
      await this.ensureDeviceCapability('meter_power');
      const roundedEnergy = Number(directEnergy.toFixed(6));
      await this.updateCapability('meter_power', roundedEnergy);
      // Bridge readings repeat frequently — skip the store write when the
      // value hasn't changed to avoid unnecessary flash wear.
      if (this.getStoreValue('meterPowerKwh') !== roundedEnergy) {
        await this.setStoreValue('meterPowerKwh', roundedEnergy).catch(this.error);
      }
      return;
    }

    if (typeof power === 'number') {
      await this.energy.applyPower(Math.max(0, power));
    }
  }

  private resolveMeterStatus(status: BridgeStatus): Record<string, unknown> {
    const data = this.getData() as EnergyMeterData;
    const targetMeterId = data.meterId !== undefined ? String(data.meterId) : null;
    const targetLoadId = data.loadId !== undefined ? String(data.loadId) : null;
    const preferLoads = data.meterKind === 'load';
    const meters = Array.isArray(status.energyMeters) ? status.energyMeters : [];
    const loads = Array.isArray(status.energyLoads) ? status.energyLoads : [];
    const primaryRecords = preferLoads ? loads : meters;
    const fallbackRecords = preferLoads ? meters : loads;

    const targetId = targetLoadId || targetMeterId;
    if (targetId) {
      const matched = this.findEnergyRecord([...primaryRecords, ...fallbackRecords], targetId);
      if (matched) return matched;
    }

    return primaryRecords[0] || fallbackRecords[0] || status;
  }

  private getMeterIdForControl(): string | number {
    const data = this.getData() as EnergyMeterData;
    return data.loadId ?? data.meterId ?? this.deviceId;
  }

  private findEnergyRecord(records: Array<Record<string, unknown>>, targetId: string): Record<string, unknown> | undefined {
    return records.find((record) => {
      const candidateId = record.meterId
        ?? record.energyMeterId
        ?? record.loadId
        ?? record.energyLoadId
        ?? record.id
        ?? record.deviceId
        ?? record.channel;
      return candidateId !== undefined && String(candidateId) === targetId;
    });
  }

  private async restoreEnergyState(): Promise<void> {
    const storedValue = this.getStoreValue('meterPowerKwh');
    if (typeof storedValue !== 'number' || !Number.isFinite(storedValue) || storedValue <= 0) {
      return;
    }

    this.energy.restore(storedValue);
    await this.ensureDeviceCapability('meter_power');
    await this.updateCapability('meter_power', this.energy.getKwh());
  }

  private getNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.replace(',', '.'));
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  private getString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return undefined;
  }

  private getNonNumericString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0 && Number.isNaN(Number.parseFloat(value))) {
        return value.trim();
      }
    }

    return undefined;
  }

  private getFirstDefined(source: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        return source[key];
      }
    }

    return undefined;
  }

  /**
   * Surface per-period kWh totals as numeric capabilities so the history is
   * graphable in Homey Insights (the string summary capability is not).
   */
  private async applyEnergyHistoryInsights(history: unknown): Promise<void> {
    const periods = extractHistoryPeriods(history);

    if (periods.todayKwh !== undefined) {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.ENERGY_TODAY);
      await this.updateCapability(XCOMFORT_CAPABILITIES.ENERGY_TODAY, periods.todayKwh);
    }

    if (periods.monthKwh !== undefined) {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.ENERGY_MONTH);
      await this.updateCapability(XCOMFORT_CAPABILITIES.ENERGY_MONTH, periods.monthKwh);
    }
  }

  private formatEnergyHistory(value: unknown, currency?: string): string | undefined {
    if (typeof value === 'string') {
      return this.truncate(value.trim());
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${Number(value.toFixed(3))} kWh`;
    }

    if (Array.isArray(value)) {
      const entries = value
        .map((item, index) => this.formatHistoryEntry(item, `Period ${index + 1}`, currency))
        .filter((item): item is string => !!item)
        .slice(0, 4);
      return entries.length ? this.truncate(entries.join(', ')) : undefined;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const preferredKeys = [
        'today',
        'day',
        'daily',
        'week',
        'weekly',
        'month',
        'monthly',
        'year',
        'yearly',
      ];
      const entries = preferredKeys
        .map((key) => this.formatHistoryEntry(record[key], key, currency))
        .filter((item): item is string => !!item);

      if (entries.length) {
        return this.truncate(entries.join(', '));
      }

      const fallbackEntries = Object.entries(record)
        .map(([key, entry]) => this.formatHistoryEntry(entry, key, currency))
        .filter((item): item is string => !!item)
        .slice(0, 4);
      return fallbackEntries.length ? this.truncate(fallbackEntries.join(', ')) : undefined;
    }

    return undefined;
  }

  private formatHistoryEntry(value: unknown, label: string, currency?: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${this.humanizeLabel(label)} ${Number(value.toFixed(3))} kWh`;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return `${this.humanizeLabel(label)} ${value.trim()}`;
    }

    if (Array.isArray(value)) {
      const numericValues = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
      if (numericValues.length > 0) {
        const total = numericValues.reduce((sum, item) => sum + item, 0);
        return `${this.humanizeLabel(label)} ${Number(total.toFixed(3))} kWh (${numericValues.length} samples)`;
      }
      return value.length ? `${this.humanizeLabel(label)} ${value.length} entries` : undefined;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const entryLabel = this.getString(record, ['label', 'name', 'period', 'range']) || this.humanizeLabel(label);
      const energy = this.getNumber(record, [
        'energy',
        'energyKwh',
        'kwh',
        'consumption',
        'totalConsumption',
        'consumptionKwh',
        'totalKwh',
        'value',
      ]);
      const cost = this.getNumber(record, ['cost', 'energyCost', 'totalCost', 'totalPrice']);
      const parts: string[] = [];

      if (energy !== undefined) {
        parts.push(`${Number(energy.toFixed(3))} kWh`);
      }
      if (cost !== undefined) {
        parts.push(`${Number(cost.toFixed(2))}${currency ? ` ${currency.toUpperCase()}` : ''}`);
      }

      return parts.length ? `${entryLabel} ${parts.join(' / ')}` : undefined;
    }

    return undefined;
  }

  private humanizeLabel(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private truncate(value: string): string {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }

  private getLoadMode(source: Record<string, unknown>): string | undefined {
    const value = source.loadMode
      ?? source.mode
      ?? source.controlMode
      ?? source.priorityMode
      ?? source.loadControlMode
      ?? source.energyMode;
    if (typeof value === 'number' || typeof value === 'string') {
      return this.normalizeLoadMode(value);
    }
    return undefined;
  }

  private normalizeLoadMode(value: string | number): string {
    if (typeof value === 'number') {
      switch (value) {
        case 1:
          return 'energy_saving';
        case 2:
          return 'priority';
        case 0:
        default:
          return 'normal';
      }
    }

    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'saving' || normalized === 'energy_saving' || normalized === 'energysaving') {
      return 'energy_saving';
    }
    if (normalized === 'priority' || normalized === 'prio') {
      return 'priority';
    }
    return 'normal';
  }

  private round(value: number): number {
    return Number(value.toFixed(1));
  }
};
