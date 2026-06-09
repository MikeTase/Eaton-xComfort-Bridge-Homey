/**
 * Message Handler for xComfort Bridge
 *
 * Handles message routing, ACK management, and state update processing.
 * Extracted from XComfortConnection for single responsibility.
 */

import { MESSAGE_TYPES } from '../XComfortProtocol';
import { DeviceStateManager } from '../state/DeviceStateManager';
import type {
  ProtocolMessage,
  StateUpdateItem,
  DeviceStateUpdate,
  RoomStateUpdate,
  BridgeStatus,
  LoggerFunction,
  XComfortDevice,
  XComfortRoom,
  XComfortScene,
  RoomModeSetpoint,
  InfoEntry,
} from '../types';

// ============================================================================
// Module-specific Types (internal callbacks)
// ============================================================================

/** Callback when device list is complete */
type OnDeviceListCompleteFn = () => void;

/** Callback when ACK received */
type OnAckReceivedFn = (ref: number) => void;

/** Callback when NACK received */
type OnNackReceivedFn = (ref: number) => void;

/** Callback when Bridge Status is received */
type OnBridgeStatusUpdateFn = (status: BridgeStatus) => void;

/** Callback when Home/Bridge info is received */
type OnHomeDataUpdateFn = (payload: Record<string, unknown>) => void;

const ENERGY_MESSAGE_TYPES = new Set<number>([
  MESSAGE_TYPES.SET_ENERGY_DATA,
  MESSAGE_TYPES.SET_ENERGY_TARIFF,
  MESSAGE_TYPES.SET_ENERGY_MONITORING,
  MESSAGE_TYPES.SET_ENERGY_CONTROL,
  MESSAGE_TYPES.ENERGY_HISTORY,
  MESSAGE_TYPES.SET_ENERGY_METER,
  MESSAGE_TYPES.SET_ENERGY_METER_STATE,
]);

const APP_INFO_MESSAGES: Record<string, string> = {
  '1000': 'Bad device type',
  '1001': 'Device already exists',
  '1002': 'Unknown device',
  '1003': 'Unknown room',
  '1004': 'Failed creating room',
  '1005': 'Failed creating device',
  '1006': 'Failed creating scene',
  '1007': 'No device, room, or scene with this ID',
  '1008': 'Unknown scene',
  '1009': 'Room not dimmable',
  '1010': 'Device not dimmable',
  '1011': 'Learning mode started',
  '1012': 'Learning mode ended',
  '1013': 'Infinite toggle for device {value} started',
  '1014': 'Infinite toggle ended',
  '1015': 'Invalid action',
  '1016': 'Barcode scan data invalid',
  '1017': 'Failed updating room {value}',
  '1018': 'Failed updating scene {value}',
  '1019': 'Not allowed while learning mode is active',
  '1020': 'A dimming actuator has been found',
  '1021': 'A switching actuator has been found',
  '1022': 'Device removed because it is protected by a different password',
  '1023': 'Unsupported device type removed, serial {value}',
  '1024': 'Failed creating timer',
  '1025': 'Failed updating timer {value}',
  '1026': 'No room or scene with this control ID',
  '1027': 'Unknown timer',
  '1028': 'Sensor protected by an unknown password',
  '1029': 'Device {value} removed because of an unknown password',
  '1030': 'Device {value} removed because of an unsupported device type',
  '1031': 'Unknown device',
  '1032': 'Failed creating device',
  '1033': 'New component added to bridge, serial {value}',
  '1034': 'Operate device serial {value} to finalize configuration',
  '1035': 'Mode not editable because the device is already in use',
  '1036': 'Device {value} was removed after mode update',
  '1037': 'Device skipped due to sensor overflow',
  '1038': 'Failed creating heating program',
  '1039': 'Failed updating heating program {value}',
  '1040': 'Unknown heating program',
  '1041': 'Failed creating climate zone',
  '1042': 'Failed updating climate zone {value}',
  '1043': 'Unknown climate zone',
  '1044': 'Not configured',
  '1045': 'Effect regulation requires all heating actuators above firmware V1.50',
  '1046': 'No floor sensor at room control',
  '1047': 'No room sensor defined',
  '1048': 'No floor sensor defined',
  '1049': 'Support ID {value}',
  '1050': 'Room Controller Touch may have old firmware',
  '1051': 'Room Controller Touch needs new firmware',
  '1052': 'Server communication error {value}',
  '1053': 'Data reception error, not prepared',
  '1054': 'Data reception error, no data',
  '1055': 'Data reception error, data overflow',
  '1056': 'Backup restore error',
  '1057': 'Backup could not be saved on server {value}',
  '1058': 'Authentication failed',
  '1059': 'A shading actuator has been found',
  '1060': 'A water-safety device has been found',
  '1061': 'Water sensor cannot be assigned because the maximum assignment count was reached',
  '1062': 'Yale integration communication error',
  '1063': 'Unknown user',
  '1064': 'Failed creating user',
  '1065': 'Username already used by another user',
  '1066': 'Email address already used by another user',
  '1067': 'Advanced regulation is not possible because heating actuator firmware is too old',
  '1068': 'Multi-heating actuator valves in zone have mismatched usage',
  '1069': 'Climate devices with cooling require advanced regulation',
  '1070': 'Heating actuators below V1.53 do not support advanced regulation',
  '1071': 'Climate devices do not support advanced regulation',
  '1072': 'Climate regulation with switching or dimming actuator requires advanced regulation',
  '1073': 'Failed creating time program',
  '1074': 'Failed updating time program',
  '1075': 'Unknown time program',
  '1076': 'Unknown condition',
  '1077': 'Failed creating condition',
  '1078': 'Failed creating push notification',
  '1079': 'Unknown push notification',
  '1080': 'Failed creating client bridge',
  '1081': 'Unknown client bridge',
  '1082': 'Master-client bridge mode is not allowed because it is already in use',
  '1083': 'Failed creating meter',
  '1084': 'Unknown meter',
  '1085': 'History request currently not possible',
};

// ============================================================================
// MessageHandler Class
// ============================================================================

export class MessageHandler {
  private deviceStateManager: DeviceStateManager;
  private logger: LoggerFunction;
  private debugStateItems: boolean = false;
  private pendingDeviceUpdates: Map<string, DeviceStateUpdate> = new Map();
  private pendingRoomUpdates: Map<string, RoomStateUpdate> = new Map();
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private roomFlushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly UPDATE_COALESCE_MS = 150;
  private onDeviceListComplete?: OnDeviceListCompleteFn;
  private onAckReceived?: OnAckReceivedFn;
  private onNackReceived?: OnNackReceivedFn;
  private onBridgeStatusUpdate?: OnBridgeStatusUpdateFn;
  private onHomeDataUpdate?: OnHomeDataUpdateFn;

  constructor(
    deviceStateManager: DeviceStateManager,
    logger?: LoggerFunction
  ) {
    this.deviceStateManager = deviceStateManager;
    this.logger = logger || console.log;
    this.debugStateItems = process.env.XCOMFORT_DEBUG === '1';
  }

  /**
   * Set callback for when device list is complete
   */
  setOnDeviceListComplete(callback: OnDeviceListCompleteFn): void {
    this.onDeviceListComplete = callback;
  }

  /**
   * Set callback for when ACK is received (for retry mechanism)
   */
  setOnAckReceived(callback: OnAckReceivedFn): void {
    this.onAckReceived = callback;
  }

  /**
   * Set callback for when NACK is received (for retry mechanism)
   */
  setOnNackReceived(callback: OnNackReceivedFn): void {
    this.onNackReceived = callback;
  }

  /**
   * Set callback for Bridge Status updates
   */
  setOnBridgeStatusUpdate(callback: OnBridgeStatusUpdateFn): void {
    this.onBridgeStatusUpdate = callback;
  }

  /**
   * Set callback for Home/Bridge info updates
   */
  setOnHomeDataUpdate(callback: OnHomeDataUpdateFn): void {
    this.onHomeDataUpdate = callback;
  }

  /**
   * Process an encrypted message (after decryption)
   * Returns true if the message was handled
   */
  async processMessage(msg: ProtocolMessage): Promise<boolean> {
    // Handle incoming ACK messages
    if (msg.type_int === MESSAGE_TYPES.ACK) {
      if (msg.ref !== undefined) {
        this.onAckReceived?.(msg.ref);
      }
      return true;
    }

    // Handle NACK
    if (msg.type_int === MESSAGE_TYPES.NACK) {
      if (JSON.stringify(msg.payload || '').includes('no client-connection available')) {
         this.logger('[MessageHandler-CRITICAL] Bridge reports NO CLIENT CONNECTIONS AVAILABLE. Please restart the Bridge or disconnect other apps.');
      } else {
         this.logger(`[MessageHandler-ERROR] Received NACK for message ref: ${msg.ref}`);
         if (msg.payload) {
           this.logger(`[MessageHandler-ERROR] NACK details: ${JSON.stringify(msg.payload)}`);
         }
      }
      
      if (msg.ref !== undefined) {
        this.onNackReceived?.(msg.ref);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.HEARTBEAT) {
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.PING) {
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SET_HOME_DATA) {
      if (msg.payload) {
        this.processHomeData(msg.payload);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.ADD_DEVICE) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processDeviceData({ devices: [payload] });
      }
      return true;
    }

    if (
      msg.type_int === MESSAGE_TYPES.SET_SCENE ||
      msg.type_int === MESSAGE_TYPES.SET_SCENE_ID
    ) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processScenePayload(payload);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.DEVICE_DELETED) {
      const payload = this.getPayloadObject(msg.payload);
      const deviceId = this.getFirstPayloadId(payload, ['deviceId', 'id']);
      if (deviceId !== undefined) {
        this.deviceStateManager.deleteDevice(deviceId);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.ROOM_DELETED) {
      const payload = this.getPayloadObject(msg.payload);
      const roomId = this.getFirstPayloadId(payload, ['roomId', 'id']);
      if (roomId !== undefined) {
        this.deviceStateManager.deleteRoom(roomId);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SCENE_DELETED) {
      const payload = this.getPayloadObject(msg.payload);
      const sceneId = this.getFirstPayloadId(payload, ['sceneId', 'id']);
      if (sceneId !== undefined) {
        this.deviceStateManager.deleteScene(sceneId);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SET_BRIDGE_STATE) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload && this.onBridgeStatusUpdate) {
        this.onBridgeStatusUpdate(payload as BridgeStatus);
      }
      return true;
    }

    if (
      msg.type_int === MESSAGE_TYPES.ADD_COMP ||
      msg.type_int === MESSAGE_TYPES.SET_COMP_INFO
    ) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processComponentPayload(payload);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.COMP_DELETED) {
      const payload = this.getPayloadObject(msg.payload);
      const compId = this.getFirstPayloadId(payload, ['compId', 'id']);
      if (compId !== undefined) {
        this.deviceStateManager.deleteComponent(compId);
      }
      return true;
    }

    if (ENERGY_MESSAGE_TYPES.has(msg.type_int)) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload && this.onBridgeStatusUpdate) {
        this.onBridgeStatusUpdate(this.extractEnergyStatus(payload, msg.type_int));
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.SET_ALL_DATA) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processDeviceData(payload);
      }
      return true;
    }

    if (
      msg.type_int === MESSAGE_TYPES.SET_DEVICE_STATE ||
      msg.type_int === MESSAGE_TYPES.SET_DEVICE_INFO ||
      msg.type_int === MESSAGE_TYPES.SET_DEVICE_ALARM_STATE ||
      msg.type_int === MESSAGE_TYPES.SET_ROOM_STATE ||
      msg.type_int === MESSAGE_TYPES.SET_ROOM_INFO ||
      msg.type_int === MESSAGE_TYPES.SET_ROOM_HEATING_STATE
    ) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processSingleStateUpdate(payload);
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.STATE_UPDATE) {
      const payload = this.getPayloadObject(msg.payload);
      if (payload) {
        this.processStateUpdate(payload as { item?: StateUpdateItem[] });
      }
      return true;
    }

    if (msg.type_int === MESSAGE_TYPES.ERROR_INFO) {
      const payload = this.getPayloadObject(msg.payload);
      const appInfo = this.formatAppInfo(payload);
      this.logger(`[MessageHandler] Bridge app info ${appInfo.code}: ${appInfo.message}`);
      if (payload && this.onBridgeStatusUpdate) {
        this.onBridgeStatusUpdate({
          appInfoCode: appInfo.code,
          appInfoMessage: appInfo.message,
          rawAppInfo: payload,
        });
      }
      return true;
    }

    return false;
  }

  private formatAppInfo(payload: Record<string, unknown> | null): { code: string; message: string } {
    const code = String(payload?.info ?? 'unknown');
    const template = APP_INFO_MESSAGES[code];
    if (!template) {
      return {
        code,
        message: payload ? `Unmapped app info payload ${JSON.stringify(payload)}` : 'Missing app info payload',
      };
    }

    return {
      code,
      message: template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
        const value = payload?.[key];
        return value === undefined || value === null ? `{${key}}` : String(value);
      }),
    };
  }

  private getFirstPayloadId(
    payload: Record<string, unknown> | null,
    keys: string[],
  ): string | number | undefined {
    for (const key of keys) {
      const value = payload?.[key];
      if (typeof value === 'string' || typeof value === 'number') {
        return value;
      }
    }

    return undefined;
  }

  private extractEnergyStatus(payload: Record<string, unknown>, messageType: number): BridgeStatus {
    const status: BridgeStatus = {
      energyMessageType: messageType,
      rawEnergy: payload,
    };
    const source = this.getEnergySource(payload);
    const meters = this.extractEnergyMeters(payload);
    if (meters.length > 0) {
      status.energyMeters = meters;
    }
    const loads = this.extractEnergyLoads(payload);
    if (loads.length > 0) {
      status.energyLoads = loads;
    }
    const tariffs = this.extractEnergyTariffs(payload);
    if (tariffs.length > 0) {
      status.energyTariffs = tariffs;
    }

    const primarySource = {
      ...source,
      ...(meters[0] || loads[0] || {}),
    };
    const power = this.getFirstNumber(primarySource, [
      'power',
      'activePower',
      'currentPower',
      'mainPower',
      'electricalPower',
      'powerW',
      'instantPower',
      'actualPower',
      'powerConsumption',
      'watt',
      'watts',
      'value',
    ]);
    if (power !== undefined) {
      status.power = power;
    }

    const energy = this.getFirstNumber(primarySource, [
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
    ]);
    if (energy !== undefined) {
      status.energy = energy;
      status.energyKwh = energy;
    }

    const current = this.getFirstNumber(primarySource, ['current', 'currentA', 'ampere', 'amperes', 'amps']);
    if (current !== undefined) {
      status.current = current;
    }

    const voltage = this.getFirstNumber(primarySource, ['voltage', 'voltageV', 'volt', 'volts']);
    if (voltage !== undefined) {
      status.voltage = voltage;
    }

    const pulses = this.getFirstNumber(primarySource, ['pulses', 'pulse', 'pulseCount', 'impulses', 'counter']);
    if (pulses !== undefined) {
      status.pulses = pulses;
    }

    const energyCost = this.getFirstNumber(primarySource, ['cost', 'energyCost', 'totalCost', 'totalPrice']);
    if (energyCost !== undefined) {
      status.energyCost = energyCost;
    }

    const meterId = this.getFirstValue(primarySource, ['meterId', 'energyMeterId', 'id', 'deviceId']);
    if (typeof meterId === 'number' || typeof meterId === 'string') {
      status.meterId = meterId;
    }

    const connectionState = this.getFirstNumber(primarySource, ['connectionState', 'state', 'status']);
    if (connectionState !== undefined) {
      status.connectionState = connectionState;
    }

    const tariff = this.getFirstValue(primarySource, [
      'tariff',
      'tariffId',
      'currentTariff',
      'tariffPrice',
      'priceNow',
      'currentPrice',
      'pricePerKwh',
      'rate',
    ]);
    if (typeof tariff === 'number' || typeof tariff === 'string') {
      status.tariff = tariff;
    }

    const tariffLabel = this.getFirstString(primarySource, [
      'tariffLabel',
      'tariffName',
      'tariffText',
      'currentTariffName',
      'currentTariffLabel',
      'priceArea',
      'priceZone',
      'tariffCode',
    ]);
    if (tariffLabel !== undefined) {
      status.tariffLabel = tariffLabel;
    } else if (typeof tariff === 'string' && Number.isNaN(Number.parseFloat(tariff))) {
      status.tariffLabel = tariff;
    }

    const currency = this.getFirstString(primarySource, [
      'currency',
      'currencyCode',
      'energyCurrency',
      'costCurrency',
      'tariffCurrency',
    ]);
    if (currency !== undefined) {
      status.currency = currency.toUpperCase();
    }

    const energyHistory = this.getFirstValue(primarySource, [
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
    ]);
    if (energyHistory !== undefined) {
      status.energyHistory = energyHistory;
    } else if (messageType === MESSAGE_TYPES.ENERGY_HISTORY) {
      status.energyHistory = payload.data ?? payload.items ?? payload;
    }

    const loadMode = this.getFirstValue(primarySource, [
      'loadMode',
      'mode',
      'controlMode',
      'priorityMode',
      'loadControlMode',
      'energyMode',
    ]);
    if (typeof loadMode === 'number' || typeof loadMode === 'string') {
      status.loadMode = this.normalizeLoadMode(loadMode);
    }

    return status;
  }

  private getEnergySource(payload: Record<string, unknown>): Record<string, unknown> {
    const candidateKeys = [
      'energy',
      'energyData',
      'energyMeter',
      'mainMeter',
      'mainElectrical',
      'mainElectricalEnergy',
      'energyUsage',
      'meter',
      'mainElectricalEnergyUsage',
      'usage',
      'data',
    ];

    for (const key of candidateKeys) {
      const value = payload[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }

    return payload;
  }

  private extractEnergyMeters(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    const candidateKeys = [
      'meters',
      'energyMeters',
      'energyMeterList',
      'meter',
      'energyMeter',
      'items',
      'data',
    ];

    return this.extractRecordArray(payload, candidateKeys);
  }

  private extractEnergyLoads(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    return this.extractRecordArray(payload, [
      'loads',
      'load',
      'monitoredLoads',
      'energyLoads',
      'controlledLoads',
      'loadItems',
    ]);
  }

  private extractEnergyTariffs(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    return this.extractRecordArray(payload, [
      'tariffs',
      'tariffList',
      'tariffInfo',
      'tariffData',
      'prices',
      'pricePeriods',
      'rates',
    ]);
  }

  private extractRecordArray(
    payload: Record<string, unknown>,
    candidateKeys: string[],
  ): Array<Record<string, unknown>> {
    const records: Array<Record<string, unknown>> = [];

    candidateKeys.forEach((key) => {
      const value = payload[key];
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            records.push(item as Record<string, unknown>);
          }
        });
      } else if (key !== 'data' && value && typeof value === 'object' && !Array.isArray(value)) {
        records.push(value as Record<string, unknown>);
      }
    });

    return records;
  }

  private getFirstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
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

  private getFirstValue(source: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) {
        return source[key];
      }
    }

    return undefined;
  }

  private getFirstString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
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

  /**
   * Process SET_HOME_DATA (303) messages
   */
  private processHomeData(payload: Record<string, unknown>): void {
    const homePayload = payload.home && typeof payload.home === 'object' && !Array.isArray(payload.home)
      ? payload.home as Record<string, unknown>
      : payload;
    const bridgeInfoPayload: Record<string, unknown> = { ...homePayload };
    ['homeScenes', 'scenes', 'remoteAllowed', 'remoteOnline'].forEach((key) => {
      if (bridgeInfoPayload[key] === undefined && payload[key] !== undefined) {
        bridgeInfoPayload[key] = payload[key];
      }
    });

    const homeName = typeof homePayload.name === 'string' ? homePayload.name : 'unnamed';
    this.logger(`[MessageHandler] Home data received: ${homeName}`);
    this.onHomeDataUpdate?.(bridgeInfoPayload);

    if (payload.comps) {
      this.processDeviceData({ comps: payload.comps });
    }
    if (payload.devices) {
      this.processDeviceData({ devices: payload.devices });
    }
    if (payload.scenes) {
      this.processDeviceData({ scenes: payload.scenes });
    }
  }

  /**
   * Process device/room/scene data
   */
  private processDeviceData(payload: Record<string, unknown>): void {
    if (payload.comps && Array.isArray(payload.comps)) {
      payload.comps.forEach((compPayload) => {
        if (!compPayload || typeof compPayload !== 'object' || Array.isArray(compPayload)) {
          return;
        }

        this.processComponentPayload(compPayload as Record<string, unknown>);
      });
    }

    if (payload.devices) {
      const devices = payload.devices as Array<{
        deviceId: string;
        name: string;
        [key: string]: unknown;
      }>;

      devices.forEach((device) => {
        this.deviceStateManager.setDevice(device);
        
        // Trigger listeners with current state from discovery/sync
        const update: DeviceStateUpdate = {};
        let hasUpdate = false;

        if (device.switch !== undefined) {
          update.switch = device.switch === true || device.switch === 1;
          hasUpdate = true;
        }
        if (typeof device.dimmvalue === 'number') {
          update.dimmvalue = device.dimmvalue;
          hasUpdate = true;
        }
        if (typeof device.power === 'number') {
          update.power = device.power;
          hasUpdate = true;
        }
        if (typeof device.energy === 'number') {
          update.energy = device.energy;
          hasUpdate = true;
        }
        if (typeof device.current === 'number') {
          update.current = device.current;
          hasUpdate = true;
        }
        if (typeof device.voltage === 'number') {
          update.voltage = device.voltage;
          hasUpdate = true;
        }
        if (typeof device.pulses === 'number') {
          update.pulses = device.pulses;
          hasUpdate = true;
        }
        if (typeof device.energyCost === 'number') {
          update.energyCost = device.energyCost;
          hasUpdate = true;
        }
        if (typeof device.tariff === 'number' || typeof device.tariff === 'string') {
          update.tariff = device.tariff;
          hasUpdate = true;
        }
        if (typeof device.tariffLabel === 'string') {
          update.tariffLabel = device.tariffLabel;
          hasUpdate = true;
        }
        if (typeof device.currency === 'string') {
          update.currency = device.currency;
          hasUpdate = true;
        }
        if (device.energyHistory !== undefined) {
          update.energyHistory = device.energyHistory;
          hasUpdate = true;
        }
        if (typeof device.loadMode === 'string') {
          update.loadMode = device.loadMode;
          hasUpdate = true;
        }
        if (typeof device.setpoint === 'number') {
          update.setpoint = device.setpoint;
          hasUpdate = true;
        }
        if (typeof device.shadsClosed === 'number') {
          update.shadsClosed = device.shadsClosed;
          hasUpdate = true;
        }
        if (typeof device.shPos === 'number') {
          update.shPos = device.shPos;
          hasUpdate = true;
        }
        if (typeof device.shSafety === 'number') {
          update.shSafety = device.shSafety;
          hasUpdate = true;
        }
        if (device.operationMode !== undefined) {
          update.operationMode = device.operationMode as number;
          hasUpdate = true;
        }
        if (device.tempState !== undefined) {
          update.tempState = device.tempState as number;
          hasUpdate = true;
        }
        if (device.curstate !== undefined) {
          update.curstate = device.curstate;
          hasUpdate = true;
        }
        if (Array.isArray(device.info)) {
          const metadata = this.deviceStateManager.parseInfoMetadata(device.info as InfoEntry[]);
          if (Object.keys(metadata).length > 0) {
            update.metadata = metadata;
            hasUpdate = true;
          }
        }

        if (hasUpdate) {
          // Use setImmediate to ensure the device is fully registered before firing
          setImmediate(() => {
             this.deviceStateManager.triggerListeners(device.deviceId, update);
          });
        }
      });
    }

    if (payload.rooms && Array.isArray(payload.rooms)) {
      payload.rooms.forEach((roomPayload) => {
        if (!roomPayload || typeof roomPayload !== 'object' || Array.isArray(roomPayload)) {
          return;
        }

        const room = this.normalizeRoomPayload(roomPayload as Record<string, unknown>);
        this.deviceStateManager.setRoom(room);

        const update = this.extractRoomUpdate(room);
        if (Object.keys(update).length > 0) {
          setImmediate(() => {
            this.deviceStateManager.triggerRoomListeners(room.roomId, update);
          });
        }
      });
    }

    if (payload.roomHeating && Array.isArray(payload.roomHeating)) {
      payload.roomHeating.forEach((roomPayload) => {
        if (!roomPayload || typeof roomPayload !== 'object' || Array.isArray(roomPayload)) {
          return;
        }

        const room = this.normalizeRoomPayload(roomPayload as Record<string, unknown>);
        this.deviceStateManager.setRoom(room);

        const update = this.extractRoomUpdate(room);
        if (Object.keys(update).length > 0) {
          setImmediate(() => {
            this.deviceStateManager.triggerRoomListeners(room.roomId, update);
          });
        }
      });
    }

    if (payload.scenes && Array.isArray(payload.scenes)) {
      payload.scenes.forEach((scenePayload) => {
        if (!scenePayload || typeof scenePayload !== 'object' || Array.isArray(scenePayload)) {
          return;
        }

        this.processScenePayload(scenePayload as Record<string, unknown>);
      });
    }

    if (payload.lastItem) {
      // this.logger('[MessageHandler] Device discovery complete!');
      this.onDeviceListComplete?.();
    }
  }

  /**
   * Process state update messages
   */
  private processStateUpdate(payload: { item?: StateUpdateItem[] }): void {
    try {
      if (payload?.item) {
        const deviceUpdates = new Map<string, DeviceStateUpdate>();
        const deviceInfoUpdates = new Map<string, InfoEntry[]>();
        const roomUpdates = new Map<string, RoomStateUpdate>();

        payload.item.forEach((item) => {
          if (item.deviceId !== undefined && item.deviceId !== null) {
            const deviceId = String(item.deviceId);

            if (!deviceUpdates.has(deviceId)) {
              deviceUpdates.set(deviceId, {});
            }
            const deviceUpdate = deviceUpdates.get(deviceId)!;

            if (this.debugStateItems) {
              this.logger(`[MessageHandler] Raw item for device ${deviceId}: ${JSON.stringify(item)}`);
            }

            const hasStateField = (
              item.switch !== undefined ||
              item.dimmvalue !== undefined ||
              item.setpoint !== undefined ||
              item.shadsClosed !== undefined ||
              item.shPos !== undefined ||
              item.shSafety !== undefined ||
              item.curstate !== undefined ||
              item.errorState !== undefined ||
              item.power !== undefined ||
              item.energy !== undefined ||
              item.current !== undefined ||
              item.voltage !== undefined ||
              item.pulses !== undefined ||
              item.energyCost !== undefined ||
              item.tariff !== undefined ||
              item.tariffLabel !== undefined ||
              item.currency !== undefined ||
              item.energyHistory !== undefined ||
              item.loadMode !== undefined
            );

            if (hasStateField) {
              if (item.switch !== undefined) {
                  deviceUpdate.switch = (item.switch === true || item.switch === 1);
              } else if (item.curstate !== undefined && (item.curstate === 0 || item.curstate === 1)) {
                  deviceUpdate.switch = (item.curstate === 1);
              }

              if (item.dimmvalue !== undefined) deviceUpdate.dimmvalue = item.dimmvalue;
              if (item.power !== undefined) deviceUpdate.power = item.power;
              if (item.energy !== undefined) deviceUpdate.energy = item.energy;
              if (item.current !== undefined) deviceUpdate.current = item.current;
              if (item.voltage !== undefined) deviceUpdate.voltage = item.voltage;
              if (item.pulses !== undefined) deviceUpdate.pulses = item.pulses;
              if (item.energyCost !== undefined) deviceUpdate.energyCost = item.energyCost;
              if (item.tariff !== undefined) deviceUpdate.tariff = item.tariff;
              if (item.tariffLabel !== undefined) deviceUpdate.tariffLabel = item.tariffLabel;
              if (item.currency !== undefined) deviceUpdate.currency = item.currency;
              if (item.energyHistory !== undefined) deviceUpdate.energyHistory = item.energyHistory;
              if (item.loadMode !== undefined) deviceUpdate.loadMode = item.loadMode;
              if (item.curstate !== undefined) deviceUpdate.curstate = item.curstate;
              if (item.errorState !== undefined) deviceUpdate.errorState = item.errorState;
              if (item.shadsClosed !== undefined) deviceUpdate.shadsClosed = item.shadsClosed;
              if (item.shPos !== undefined) deviceUpdate.shPos = item.shPos;
              if (item.shSafety !== undefined) deviceUpdate.shSafety = item.shSafety;
              if (item.setpoint !== undefined) deviceUpdate.setpoint = item.setpoint;
              if (item.operationMode !== undefined) deviceUpdate.operationMode = item.operationMode;
              if (item.tempState !== undefined) deviceUpdate.tempState = item.tempState;
            }

            // Parse info[] independently — a single update item may contain BOTH
            // state fields AND info metadata (e.g. temp/humidity from a dimming
            // heater that also reports power). Previously this was an else-if,
            // which caused metadata to be silently dropped on combined updates.
            if (item.info && Array.isArray(item.info)) {
              const metadata = this.deviceStateManager.parseInfoMetadata(item.info);
              if (Object.keys(metadata).length > 0) {
                deviceUpdate.metadata = {
                  ...(deviceUpdate.metadata || {}),
                  ...metadata,
                };
              }
              deviceInfoUpdates.set(deviceId, item.info);
            }
          }

          if (item.roomId !== undefined && item.roomId !== null) {
            const roomId = String(item.roomId);

            if (!roomUpdates.has(roomId)) {
              roomUpdates.set(roomId, {});
            }
            const roomUpdate = roomUpdates.get(roomId)!;

            if (typeof item.setpoint === 'number') roomUpdate.setpoint = item.setpoint;
            if (typeof item.temp === 'number') roomUpdate.temp = item.temp;
            if (typeof item.humidity === 'number') roomUpdate.humidity = item.humidity;
            if (typeof item.power === 'number') roomUpdate.power = item.power;
            if (typeof item.valve === 'number') roomUpdate.valve = item.valve;
            if (typeof item.lightsOn === 'number') roomUpdate.lightsOn = item.lightsOn;
            if (typeof item.windowsOpen === 'number') roomUpdate.windowsOpen = item.windowsOpen;
            if (typeof item.doorsOpen === 'number') roomUpdate.doorsOpen = item.doorsOpen;
            if (item.currentMode !== undefined) roomUpdate.currentMode = item.currentMode;
            if (item.mode !== undefined) roomUpdate.mode = item.mode;
            if (item.state !== undefined) roomUpdate.state = item.state;
            if (typeof item.temperatureOnly === 'boolean') roomUpdate.temperatureOnly = item.temperatureOnly;
            if (Array.isArray(item.modes)) {
              roomUpdate.modes = item.modes
                .filter((mode): mode is RoomModeSetpoint => {
                  return !!mode
                    && typeof mode === 'object'
                    && !Array.isArray(mode)
                    && (mode as RoomModeSetpoint).mode !== undefined
                    && typeof (mode as RoomModeSetpoint).value === 'number';
                })
                .map((mode) => ({
                  mode: mode.mode,
                  value: mode.value,
                }));
            }
            roomUpdate.raw = {
              ...(roomUpdate.raw || {}),
              ...(item as Record<string, unknown>),
            };
          }
        });

        deviceUpdates.forEach((updateData, deviceId) => {
          // Persist key state fields back to the stored device so that
          // snapshots (used on reconnect) always reflect the latest state.
          const device = this.deviceStateManager.getDevice(deviceId);
          if (device) {
            const patch: Partial<XComfortDevice> = {};
            if (updateData.switch !== undefined) patch.switch = updateData.switch;
            if (updateData.dimmvalue !== undefined) patch.dimmvalue = updateData.dimmvalue;
            if (updateData.power !== undefined) patch.power = updateData.power;
            if (updateData.energy !== undefined) patch.energy = updateData.energy;
            if (updateData.current !== undefined) patch.current = updateData.current;
            if (updateData.voltage !== undefined) patch.voltage = updateData.voltage;
            if (updateData.pulses !== undefined) patch.pulses = updateData.pulses;
            if (updateData.energyCost !== undefined) patch.energyCost = updateData.energyCost;
            if (updateData.tariff !== undefined) patch.tariff = updateData.tariff;
            if (updateData.tariffLabel !== undefined) patch.tariffLabel = updateData.tariffLabel;
            if (updateData.currency !== undefined) patch.currency = updateData.currency;
            if (updateData.energyHistory !== undefined) patch.energyHistory = updateData.energyHistory;
            if (updateData.loadMode !== undefined) patch.loadMode = updateData.loadMode;
            if (updateData.curstate !== undefined) patch.curstate = updateData.curstate;
            if (updateData.errorState !== undefined) patch.errorState = updateData.errorState;
            if (updateData.shadsClosed !== undefined) patch.shadsClosed = updateData.shadsClosed;
            if (updateData.shPos !== undefined) patch.shPos = updateData.shPos;
            if (updateData.shSafety !== undefined) patch.shSafety = updateData.shSafety;
            if (updateData.setpoint !== undefined) patch.setpoint = updateData.setpoint;
            if (updateData.operationMode !== undefined) patch.operationMode = updateData.operationMode;
            if (updateData.tempState !== undefined) patch.tempState = updateData.tempState;
            if (deviceInfoUpdates.has(deviceId)) patch.info = deviceInfoUpdates.get(deviceId);

            if (Object.keys(patch).length > 0) {
              this.deviceStateManager.setDevice({ ...device, ...patch });
            }
          }

          this.enqueueDeviceUpdate(deviceId, updateData);
        });

        roomUpdates.forEach((updateData, roomId) => {
          const existingRoom = this.deviceStateManager.getRoom(roomId);
          const patch: Record<string, unknown> = {};
          if (updateData.setpoint !== undefined) patch.setpoint = updateData.setpoint;
          if (updateData.temp !== undefined) patch.temp = updateData.temp;
          if (updateData.humidity !== undefined) patch.humidity = updateData.humidity;
          if (updateData.power !== undefined) patch.power = updateData.power;
          if (updateData.valve !== undefined) patch.valve = updateData.valve;
          if (updateData.lightsOn !== undefined) patch.lightsOn = updateData.lightsOn;
          if (updateData.windowsOpen !== undefined) patch.windowsOpen = updateData.windowsOpen;
          if (updateData.doorsOpen !== undefined) patch.doorsOpen = updateData.doorsOpen;
          if (updateData.currentMode !== undefined) patch.currentMode = updateData.currentMode;
          if (updateData.mode !== undefined) patch.mode = updateData.mode;
          if (updateData.state !== undefined) patch.state = updateData.state;
          if (updateData.temperatureOnly !== undefined) patch.temperatureOnly = updateData.temperatureOnly;
          if (updateData.modes !== undefined) patch.modes = updateData.modes;
          if (updateData.raw !== undefined) patch.raw = updateData.raw;

          if (Object.keys(patch).length > 0) {
            this.deviceStateManager.setRoom({
              ...(existingRoom || { roomId, name: `Room ${roomId}` }),
              ...patch,
            });
          }

          this.enqueueRoomUpdate(roomId, updateData);
        });

        // Process compId items — update stored component data (matches HA _handle_SET_STATE_INFO)
        payload.item.forEach((item) => {
          if (item.compId !== undefined && item.compId !== null) {
            const compId = String(item.compId);
            const existing = this.deviceStateManager.getComponent(compId);
            if (existing) {
              this.deviceStateManager.setComponent({
                ...existing,
                raw: { ...(existing.raw || {}), ...(item as Record<string, unknown>) },
              });
            }
          }
        });
      }
    } catch (error) {
      this.logger(`[MessageHandler] Error processing state update:`, error);
    }
  }

  private processSingleStateUpdate(payload: Record<string, unknown>): void {
    this.processStateUpdate({
      item: [payload as StateUpdateItem],
    });
  }

  private enqueueDeviceUpdate(deviceId: string, updateData: DeviceStateUpdate): void {
    if (!Object.keys(updateData).length) return;

    const pending = this.pendingDeviceUpdates.get(deviceId) || {};
    const merged: DeviceStateUpdate = {
      ...pending,
      ...updateData,
      metadata: {
        ...(pending.metadata || {}),
        ...(updateData.metadata || {}),
      },
    };

    // Remove empty metadata to keep payload clean
    if (!Object.keys(merged.metadata || {}).length) {
      delete merged.metadata;
    }

    this.pendingDeviceUpdates.set(deviceId, merged);

    if (!this.flushTimers.has(deviceId)) {
      const timer = setTimeout(() => {
        this.flushTimers.delete(deviceId);
        const latest = this.pendingDeviceUpdates.get(deviceId);
        if (latest) {
          this.pendingDeviceUpdates.delete(deviceId);
          this.deviceStateManager.triggerListeners(deviceId, latest);
        }
      }, this.UPDATE_COALESCE_MS);

      this.flushTimers.set(deviceId, timer);
    }
  }

  private enqueueRoomUpdate(roomId: string, updateData: RoomStateUpdate): void {
    if (!Object.keys(updateData).length) return;

    const pending = this.pendingRoomUpdates.get(roomId) || {};
    const merged: RoomStateUpdate = {
      ...pending,
      ...updateData,
      raw: {
        ...(pending.raw || {}),
        ...(updateData.raw || {}),
      },
    };

    if (!Object.keys(merged.raw || {}).length) {
      delete merged.raw;
    }

    this.pendingRoomUpdates.set(roomId, merged);

    if (!this.roomFlushTimers.has(roomId)) {
      const timer = setTimeout(() => {
        this.roomFlushTimers.delete(roomId);
        const latest = this.pendingRoomUpdates.get(roomId);
        if (latest) {
          this.pendingRoomUpdates.delete(roomId);
          this.deviceStateManager.triggerRoomListeners(roomId, latest);
        }
      }, this.UPDATE_COALESCE_MS);

      this.roomFlushTimers.set(roomId, timer);
    }
  }

  private normalizeRoomPayload(payload: Record<string, unknown>): XComfortRoom {
    const roomId = String(payload.roomId ?? '');
    const room: XComfortRoom = {
      ...payload,
      roomId,
      name: typeof payload.name === 'string' ? payload.name : `Room ${roomId}`,
      raw: payload,
    };

    return room;
  }

  private processScenePayload(payload: Record<string, unknown>): void {
    const scene = this.normalizeScenePayload(payload);
    if (!scene.sceneId) {
      return;
    }

    this.deviceStateManager.setScene(scene);
  }

  private normalizeScenePayload(payload: Record<string, unknown>): XComfortScene {
    const sceneId = String(payload.sceneId ?? payload.id ?? '');
    const devices = Array.isArray(payload.devices)
      ? payload.devices.filter((item): item is Record<string, unknown> => {
        return !!item && typeof item === 'object' && !Array.isArray(item);
      })
      : undefined;
    const conditionSummary = this.summarizeSceneMetadata(payload, [
      'conditionSummary',
      'conditions',
      'condition',
      'rules',
      'rule',
      'if',
      'when',
    ]);
    const scheduleSummary = this.summarizeSceneMetadata(payload, [
      'scheduleSummary',
      'schedule',
      'schedules',
      'timer',
      'timers',
      'astro',
      'sunrise',
      'sunset',
      'time',
    ]);
    const sceneType = this.extractSceneType(payload, conditionSummary, scheduleSummary);
    const smart = this.getFirstBoolean(payload, ['smart', 'smartScene', 'isSmartScene'])
      ?? sceneType.toLowerCase().includes('smart');
    const conditional = this.getFirstBoolean(payload, ['conditional', 'conditionalScene', 'isConditional'])
      ?? !!conditionSummary;

    return {
      ...payload,
      sceneId,
      name: typeof payload.name === 'string' ? payload.name : `Scene ${sceneId}`,
      order: typeof payload.order === 'number' ? payload.order : undefined,
      show: typeof payload.show === 'boolean' ? payload.show : undefined,
      icon: typeof payload.icon === 'string' ? payload.icon : undefined,
      sceneType,
      conditionSummary,
      scheduleSummary,
      smart,
      conditional,
      deviceCount: devices ? devices.length : undefined,
      devices,
      raw: payload,
    };
  }

  private extractSceneType(
    payload: Record<string, unknown>,
    conditionSummary?: string,
    scheduleSummary?: string,
  ): string {
    const explicitType = this.getFirstString(payload, [
      'sceneType',
      'type',
      'kind',
      'mode',
      'category',
    ]);

    if (explicitType) {
      return this.humanizeLabel(explicitType);
    }

    if (conditionSummary && scheduleSummary) {
      return 'Conditional scheduled scene';
    }
    if (conditionSummary) {
      return 'Conditional scene';
    }
    if (scheduleSummary) {
      return 'Scheduled scene';
    }

    return 'Scene';
  }

  private summarizeSceneMetadata(payload: Record<string, unknown>, keys: string[]): string | undefined {
    const value = this.getFirstValue(payload, keys);
    if (value === undefined || value === null || value === false) {
      return undefined;
    }

    const key = keys.find((candidate) => payload[candidate] !== undefined && payload[candidate] !== null) || keys[0];
    return this.truncateLabel(this.formatSceneMetadataValue(value, key));
  }

  private formatSceneMetadataValue(value: unknown, label: string): string {
    const title = this.humanizeLabel(label);

    if (value === true) {
      return title;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${title}: ${value}`;
    }
    if (Array.isArray(value)) {
      const entries = value
        .map((entry, index) => this.formatSceneMetadataEntry(entry, `${title} ${index + 1}`))
        .filter((entry): entry is string => !!entry)
        .slice(0, 3);
      return entries.length ? entries.join(', ') : `${title}: ${value.length} entries`;
    }
    if (value && typeof value === 'object') {
      return this.formatSceneMetadataEntry(value, title) || title;
    }

    return title;
  }

  private formatSceneMetadataEntry(value: unknown, fallbackLabel: string): string | undefined {
    if (value === undefined || value === null || value === false) {
      return undefined;
    }
    if (value === true) {
      return fallbackLabel;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${fallbackLabel}: ${value}`;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const label = this.getFirstString(record, ['label', 'name', 'type', 'kind', 'event']) || fallbackLabel;
    const detail = this.getFirstString(record, ['value', 'time', 'operator', 'state', 'mode', 'offset']);
    if (detail) {
      return `${this.humanizeLabel(label)} ${detail}`;
    }

    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined && record[key] !== null)
      .slice(0, 3)
      .map((key) => this.humanizeLabel(key));
    return keys.length ? `${this.humanizeLabel(label)}: ${keys.join(', ')}` : this.humanizeLabel(label);
  }

  private getFirstBoolean(source: Record<string, unknown>, keys: string[]): boolean | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', '1', 'on'].includes(normalized)) return true;
        if (['false', 'no', '0', 'off'].includes(normalized)) return false;
      }
    }

    return undefined;
  }

  private humanizeLabel(value: string): string {
    return value
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private truncateLabel(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }

  private normalizeComponentPayload(payload: Record<string, unknown>): {
    compId: string;
    name?: string;
    compType?: number;
    raw: Record<string, unknown>;
  } {
    const compId = String(payload.compId ?? payload.id ?? '');
    const compType = typeof payload.compType === 'number'
      ? payload.compType
      : typeof payload.type === 'number'
        ? payload.type
        : undefined;

    const component: {
      compId: string;
      name?: string;
      compType?: number;
      raw: Record<string, unknown>;
    } = {
      compId,
      raw: payload,
    };

    if (typeof payload.name === 'string') {
      component.name = payload.name;
    }
    if (compType !== undefined) {
      component.compType = compType;
    }

    return component;
  }

  private processComponentPayload(payload: Record<string, unknown>): void {
    const component = this.normalizeComponentPayload(payload);
    if (!component.compId) {
      this.logger('[MessageHandler] Ignoring component payload without compId');
      return;
    }

    this.deviceStateManager.setComponent(component);
  }

  private extractRoomUpdate(room: XComfortRoom): RoomStateUpdate {
    const update: RoomStateUpdate = {};

    if (typeof room.setpoint === 'number') update.setpoint = room.setpoint;
    if (typeof room.temp === 'number') update.temp = room.temp;
    if (typeof room.humidity === 'number') update.humidity = room.humidity;
    if (typeof room.power === 'number') update.power = room.power;
    if (typeof room.valve === 'number') update.valve = room.valve;
    if (typeof room.lightsOn === 'number') update.lightsOn = room.lightsOn;
    if (typeof room.windowsOpen === 'number') update.windowsOpen = room.windowsOpen;
    if (typeof room.doorsOpen === 'number') update.doorsOpen = room.doorsOpen;
    if (room.currentMode !== undefined) update.currentMode = room.currentMode;
    if (room.mode !== undefined) update.mode = room.mode;
    if (room.state !== undefined) update.state = room.state;
    if (typeof room.temperatureOnly === 'boolean') update.temperatureOnly = room.temperatureOnly;
    if (Array.isArray(room.modes)) {
      update.modes = room.modes
        .filter((mode): mode is RoomModeSetpoint => {
          return !!mode
            && typeof mode === 'object'
            && !Array.isArray(mode)
            && mode.mode !== undefined
            && typeof mode.value === 'number';
        })
        .map((mode) => ({
          mode: mode.mode,
          value: mode.value,
        }));
    }
    if (room.raw) {
      update.raw = room.raw;
    }

    return update;
  }

  /**
   * Clear all pending coalesce timers and queued updates.
   * Should be called when the connection is being torn down.
   */
  cleanup(): void {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    this.pendingDeviceUpdates.clear();

    for (const timer of this.roomFlushTimers.values()) {
      clearTimeout(timer);
    }
    this.roomFlushTimers.clear();
    this.pendingRoomUpdates.clear();
  }

  private getPayloadObject(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    return payload as Record<string, unknown>;
  }
}
