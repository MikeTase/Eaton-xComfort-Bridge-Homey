import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class WaterSensorDevice extends BaseDevice {
  private onDeviceUpdate?: (deviceId: string, state: DeviceStateUpdate) => void;

  async onInit() {
    try {
        await super.onInit();
    } catch (e) {
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
