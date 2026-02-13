import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class WaterSensorDevice extends BaseDevice {

  async onDeviceReady() {
    this.setAvailable();

    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      this.updateState(state);
    });
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
    super.onDeleted();
  }
};
