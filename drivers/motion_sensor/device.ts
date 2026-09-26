import { BaseDevice } from '../../lib/BaseDevice';
import type { DeviceStateUpdate, XComfortDevice } from '../../lib/types';
import { resolveMotionDetected } from '../../lib/utils/sensorState';

module.exports = class MotionSensorDevice extends BaseDevice {
  async onDeviceReady() {
    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      void this.updateFromState(state);
    });

    await this.applyDeviceSnapshot();
  }

  protected onBridgeChanged(): void {
    void this.applyDeviceSnapshot();
  }

  private async applyDeviceSnapshot(): Promise<void> {
    const device = this.bridge.getDevice(this.deviceId);
    if (!device) {
      return;
    }

    await this.updateFromState(device);
  }

  private async updateFromState(state: DeviceStateUpdate | XComfortDevice): Promise<void> {
    const motionDetected = resolveMotionDetected({
      curstate: state.curstate,
      switch: state.switch,
      componentInfo: this.getComponentInfo(state),
    });
    if (typeof motionDetected === 'boolean') {
      await this.updateCapability('alarm_motion', motionDetected);
    }

    if ('metadata' in state) {
      await this.applySensorMetadata((state as DeviceStateUpdate).metadata);
    } else {
      await this.applyDeviceMetadataSnapshot();
    }
  }

  /** Info of the sensor's component, which carries the motion state (1125/1126). */
  private getComponentInfo(state: DeviceStateUpdate | XComfortDevice): unknown {
    if ('componentInfo' in state && Array.isArray(state.componentInfo)) {
      return state.componentInfo;
    }
    const device = this.bridge?.getDevice(this.deviceId);
    const compId = device?.compId ?? (state as XComfortDevice).compId;
    if (compId === undefined || compId === null) {
      return undefined;
    }
    return this.bridge?.getComponent(String(compId))?.raw?.info;
  }
};
