import * as Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { DeviceStateUpdate } from '../../lib/types';

interface XComfortApp extends Homey.App {
  bridge: XComfortBridge | null;
}

module.exports = class WaterSensorDevice extends Homey.Device {
  private bridge: XComfortBridge | null = null;
  private onDeviceUpdate?: (deviceId: string, state: DeviceStateUpdate) => void;

  async onInit() {
    this.log('WaterSensorDevice init:', this.getName());

    this.bridge = (this.homey.app as XComfortApp).bridge;
    if (!this.bridge) {
      this.setUnavailable('Bridge not connected');
      return;
    }

    this.setAvailable();

    this.onDeviceUpdate = (_deviceId: string, state: DeviceStateUpdate) => {
      this.updateState(state);
    };

    this.bridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
  }

  private updateState(state: DeviceStateUpdate) {
    let alarm: boolean | undefined;

    if (typeof state.switch === 'boolean') {
      alarm = state.switch;
    } else if (typeof state.curstate === 'number') {
      alarm = state.curstate === 1;
    }

    if (alarm !== undefined && this.hasCapability('alarm_water')) {
      this.setCapabilityValue('alarm_water', alarm).catch(this.error);
    }
  }

  onDeleted() {
    if (this.bridge && this.onDeviceUpdate) {
      this.bridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
    }
  }
};
