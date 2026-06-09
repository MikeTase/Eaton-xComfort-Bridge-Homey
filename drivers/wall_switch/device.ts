import * as Homey from 'homey';
import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate, InfoEntry, XComfortDevice } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

interface WallSwitchData {
  buttonNumber?: number;
  componentId?: string;
  componentModel?: string;
}

type PressAction = 'press_up' | 'press_down';
type DoublePressAction = 'double_press_up' | 'double_press_down';

module.exports = class WallSwitchDevice extends BaseDevice {
  private triggerPressed: Homey.FlowCardTriggerDevice | null = null;
  private debug: boolean = false;
  private hasSeenInitialButtonState: boolean = false;
  private lastButtonEmitState: boolean | null = null;
  private lastButtonEmitAt: number = 0;
  private lastPressAction: PressAction | null = null;
  private lastPressAt: number = 0;
  private companionSensorId: string | null = null;
  private companionSensorListener?: (deviceId: string, state: DeviceStateUpdate) => void;
  private onDevicesLoaded?: () => void;
  private readonly buttonDedupeWindowMs = 300;
  private readonly doublePressWindowMs = 1000;

  async onDeviceReady() {
    this.debug = process.env.XCOMFORT_DEBUG === '1';

    if (!this.hasCapability('onoff')) {
      await this.addCapability('onoff').catch(this.error);
    }
    
    // Allow UI interaction to update state (or handle errors if strictly read-only)
    this.registerCapabilityListener('onoff', async (value) => {
        // Since wall switches are input devices, we mainly track state. 
        // Allowing this listener removes the "missing capability listener" error
        // and allows the user to manually correct the state in the app if needed.
        if (this.debug) {
          this.log('Wall switch state manually set to:', value);
        }
    });

    // Register Flow Trigger
    this.triggerPressed = this.homey.flow.getDeviceTriggerCard('wall_switch_pressed');
    const triggerUp = this.homey.flow.getDeviceTriggerCard('wall_switch_up');
    const triggerDown = this.homey.flow.getDeviceTriggerCard('wall_switch_down');
    const triggerDoubleUp = this.homey.flow.getDeviceTriggerCard('wall_switch_double_up');
    const triggerDoubleDown = this.homey.flow.getDeviceTriggerCard('wall_switch_double_down');

    this.addManagedStateListener(this.deviceId, (deviceId: string, state: DeviceStateUpdate) => {
        void this.applySensorMetadata(state.metadata);
        void this.handleButtonState(state, triggerUp, triggerDown, triggerDoubleUp, triggerDoubleDown);
    });

    this.registerDevicesLoadedListener();
    await this.bindCompanionSensor();
    await this.applyDeviceSnapshot();
  }

  onDeleted(): void {
    if (this.onDevicesLoaded && this.bridge) {
      this.bridge.removeListener('devices_loaded', this.onDevicesLoaded);
      this.onDevicesLoaded = undefined;
    }
    super.onDeleted();
  }

  async onUninit(): Promise<void> {
    if (this.onDevicesLoaded && this.bridge) {
      this.bridge.removeListener('devices_loaded', this.onDevicesLoaded);
      this.onDevicesLoaded = undefined;
    }
    await super.onUninit();
  }

  private registerDevicesLoadedListener(): void {
    if (!this.onDevicesLoaded) {
      this.onDevicesLoaded = () => {
        void this.bindCompanionSensor();
        void this.applyDeviceSnapshot();
      };
    }

    this.bridge.removeListener('devices_loaded', this.onDevicesLoaded);
    this.bridge.on('devices_loaded', this.onDevicesLoaded);
  }

  private async applyDeviceSnapshot(): Promise<void> {
    const device = this.bridge.getDevice(this.deviceId);
    if (!device) {
      return;
    }

    const initialState = this.resolveSwitchState(device);
    if (typeof initialState === 'boolean') {
      this.hasSeenInitialButtonState = true;
      await this.updateCapability('onoff', initialState);
    }

    if (Array.isArray(device.info)) {
      const metadata = parseInfoMetadata(device.info as InfoEntry[]);
      await this.applySensorMetadata(metadata);
    }

    if (this.companionSensorId) {
      await this.applyCompanionSensorSnapshot(this.companionSensorId);
    }
  }

  protected onBridgeChanged(newBridge: XComfortBridge, oldBridge: XComfortBridge): void {
    if (this.onDevicesLoaded) {
      oldBridge.removeListener('devices_loaded', this.onDevicesLoaded);
    }
    this.registerDevicesLoadedListener();
    this.hasSeenInitialButtonState = false;
    void this.bindCompanionSensor();
    void this.applyDeviceSnapshot();
  }

  private async bindCompanionSensor(): Promise<void> {
    const sensorId = this.findCompanionSensorId();
    if (!sensorId) {
      if (this.companionSensorId && this.companionSensorListener) {
        this.removeManagedStateListener(this.companionSensorId, this.companionSensorListener);
        this.companionSensorId = null;
        this.companionSensorListener = undefined;
      }
      return;
    }

    if (this.companionSensorId !== sensorId) {
      if (this.companionSensorId && this.companionSensorListener) {
        this.removeManagedStateListener(this.companionSensorId, this.companionSensorListener);
      }

      this.companionSensorId = sensorId;
      const boundSensorId = sensorId;
      this.companionSensorListener = (_deviceId: string, state: DeviceStateUpdate) => {
        if (this.companionSensorId !== boundSensorId) {
          return;
        }
        void this.applySensorMetadata(state.metadata);
      };
      this.addManagedStateListener(boundSensorId, this.companionSensorListener);
    }

    await this.applyCompanionSensorSnapshot(sensorId);
  }

  private findCompanionSensorId(): string | null {
    const device = this.bridge.getDevice(this.deviceId);
    const data = this.getData() as WallSwitchData;
    const componentId = device?.compId ?? data.componentId;
    if (componentId === undefined || componentId === null) {
      return null;
    }

    const componentIdString = String(componentId);
    const sensorDevice = this.bridge.getDevices().find((candidate) => {
      if (String(candidate.deviceId) === this.deviceId) {
        return false;
      }

      if (candidate.compId === undefined || String(candidate.compId) !== componentIdString) {
        return false;
      }

      return this.isCompanionSensorDevice(candidate);
    });

    return sensorDevice ? String(sensorDevice.deviceId) : null;
  }

  private isCompanionSensorDevice(device: XComfortDevice): boolean {
    if (this.hasParsedSensorMetadata(device)) {
      return true;
    }

    const devType = Number(device.devType ?? 0);
    if (
      devType === DEVICE_TYPES.TEMPERATURE_SENSOR ||
      devType === DEVICE_TYPES.TEMP_SENSOR ||
      devType === DEVICE_TYPES.TEMP_HUMIDITY_SENSOR
    ) {
      return true;
    }

    return Array.isArray(device.info) && devType !== DEVICE_TYPES.WALL_SWITCH;
  }

  private hasParsedSensorMetadata(device: XComfortDevice): boolean {
    if (!Array.isArray(device.info)) {
      return false;
    }

    const metadata = parseInfoMetadata(device.info as InfoEntry[]);
    return metadata.temperature !== undefined
      || metadata.humidity !== undefined
      || metadata.deviceTemperature !== undefined
      || metadata.batteryLevel !== undefined
      || metadata.signalStrength !== undefined
      || metadata.signalStrengthDbm !== undefined;
  }

  private async applyCompanionSensorSnapshot(sensorId: string): Promise<void> {
    const sensorDevice = this.bridge.getDevice(sensorId);
    if (!sensorDevice || !Array.isArray(sensorDevice.info)) {
      return;
    }

    const metadata = parseInfoMetadata(sensorDevice.info as InfoEntry[]);
    await this.applySensorMetadata(metadata);
  }

  private async handleButtonState(
    state: DeviceStateUpdate,
    triggerUp: Homey.FlowCardTriggerDevice | null,
    triggerDown: Homey.FlowCardTriggerDevice | null,
    triggerDoubleUp: Homey.FlowCardTriggerDevice | null,
    triggerDoubleDown: Homey.FlowCardTriggerDevice | null,
  ): Promise<void> {
    if (this.debug) {
      this.log('Switch Event:', state);
    }

    const pressedState = this.resolveSwitchState(state);
    if (typeof pressedState !== 'boolean') {
      return;
    }

    await this.updateCapability('onoff', pressedState);

    // Skip the first state update after startup/reconnect to avoid false flow triggers.
    if (!this.hasSeenInitialButtonState) {
      this.hasSeenInitialButtonState = true;
      return;
    }

    if (this.isFastDuplicateButtonEvent(pressedState)) {
      return;
    }

    const data = this.getData() as WallSwitchData;
    const action: PressAction = pressedState ? 'press_up' : 'press_down';
    const button = typeof data.buttonNumber === 'number' ? data.buttonNumber : 1;
    const componentId = data.componentId || String(this.deviceId);
    const componentModel = data.componentModel || 'Wall Switch';
    const tokenValues = {
      button,
      component_id: componentId,
      component_model: componentModel,
    };
    const isDoublePress = this.isDoublePress(action);

    if (pressedState) {
      triggerUp?.trigger(this, {}, {}).catch(this.error);
    } else {
      triggerDown?.trigger(this, {}, {}).catch(this.error);
    }

    this.triggerAnyPress(state, action, tokenValues);

    if (isDoublePress) {
      const doubleAction: DoublePressAction = action === 'press_up' ? 'double_press_up' : 'double_press_down';
      const doubleTrigger = action === 'press_up' ? triggerDoubleUp : triggerDoubleDown;
      doubleTrigger?.trigger(this, tokenValues, tokenValues).catch(this.error);
      this.triggerAnyPress(state, doubleAction, tokenValues);
    }
  }

  private triggerAnyPress(
    state: DeviceStateUpdate,
    action: PressAction | DoublePressAction,
    tokenValues: { button: number; component_id: string; component_model: string },
  ): void {
    if (!this.triggerPressed) {
      return;
    }

    this.triggerPressed.trigger(
      this,
      {
        event: JSON.stringify(state),
        action,
        ...tokenValues,
      },
      {
        action,
        ...tokenValues,
      },
    ).catch(this.error);
  }

  private isFastDuplicateButtonEvent(pressedState: boolean): boolean {
    const now = Date.now();
    const isDuplicate = this.lastButtonEmitState === pressedState
      && now - this.lastButtonEmitAt < this.buttonDedupeWindowMs;

    if (!isDuplicate) {
      this.lastButtonEmitState = pressedState;
      this.lastButtonEmitAt = now;
    }

    return isDuplicate;
  }

  private isDoublePress(action: PressAction): boolean {
    const now = Date.now();
    const isDouble = this.lastPressAction === action
      && now - this.lastPressAt <= this.doublePressWindowMs;

    this.lastPressAction = action;
    this.lastPressAt = now;
    return isDouble;
  }

  private resolveSwitchState(state: { switch?: boolean; curstate?: unknown } | XComfortDevice): boolean | undefined {
    if (typeof state.switch === 'boolean') {
      return state.switch;
    }

    if (typeof state.curstate === 'number') {
      return state.curstate === 1;
    }

    return undefined;
  }

}
