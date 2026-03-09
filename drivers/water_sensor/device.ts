import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class WaterSensorDevice extends BaseDevice {

  async onDeviceReady() {
    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      this.updateState(state);
    });

    this.applyDeviceSnapshot();
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

  protected onBridgeChanged(): void {
    this.applyDeviceSnapshot();
  }

  private applyDeviceSnapshot(): void {
    const device = this.bridge.getDevice(this.deviceId);
    if (!device) {
      return;
    }

    const snapshot: DeviceStateUpdate = {};
    if (typeof device.switch === 'boolean') {
      snapshot.switch = device.switch;
    }
    if (device.curstate !== undefined) {
      snapshot.curstate = device.curstate;
    }

    if (Object.keys(snapshot).length > 0) {
      this.updateState(snapshot);
    }
  }
};
