import * as Homey from 'homey';
import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceMetadata, DeviceStateUpdate, InfoEntry, XComfortDevice } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

interface WallSwitchData {
  buttonNumber?: number;
  componentId?: string;
  componentModel?: string;
}

module.exports = class WallSwitchDevice extends BaseDevice {
  private triggerPressed: Homey.FlowCardTriggerDevice | null = null;
  private debug: boolean = false;
  private hasSeenInitialButtonState: boolean = false;
  private companionSensorId: string | null = null;
  private onDevicesLoaded?: () => void;

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

    this.addManagedStateListener(this.deviceId, (deviceId: string, state: DeviceStateUpdate) => {
        void this.applySensorMetadata(state.metadata);
        void this.handleButtonState(state, triggerUp, triggerDown);
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
      return;
    }

    if (this.companionSensorId !== sensorId) {
      this.companionSensorId = sensorId;
      const boundSensorId = sensorId;
      this.addManagedStateListener(boundSensorId, (_deviceId: string, state: DeviceStateUpdate) => {
        if (this.companionSensorId !== boundSensorId) {
          return;
        }
        void this.applySensorMetadata(state.metadata);
      });
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

    if (pressedState) {
      triggerUp?.trigger(this, {}, {}).catch(this.error);
    } else {
      triggerDown?.trigger(this, {}, {}).catch(this.error);
    }

    if (!this.triggerPressed) {
      return;
    }

    const data = this.getData() as WallSwitchData;
    const action = pressedState ? 'press_up' : 'press_down';
    const button = typeof data.buttonNumber === 'number' ? data.buttonNumber : 1;
    const componentId = data.componentId || String(this.deviceId);
    const componentModel = data.componentModel || 'Wall Switch';

    this.triggerPressed.trigger(
      this,
      {
        event: JSON.stringify(state),
        action,
        button,
        component_id: componentId,
        component_model: componentModel,
      },
      {
        action,
        button,
        component_id: componentId,
        component_model: componentModel,
      },
    ).catch(this.error);
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

  private async applySensorMetadata(metadata?: DeviceMetadata): Promise<void> {
    if (!metadata) {
      return;
    }

    if (typeof metadata.temperature === 'number') {
      if (!this.hasCapability('measure_temperature')) {
        await this.addCapability('measure_temperature').catch(this.error);
      }
      await this.updateCapability('measure_temperature', metadata.temperature);
    }

    if (typeof metadata.humidity === 'number') {
      if (!this.hasCapability('measure_humidity')) {
        await this.addCapability('measure_humidity').catch(this.error);
      }
      await this.updateCapability('measure_humidity', metadata.humidity);
    }
  }
}
