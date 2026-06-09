import { BaseDevice } from '../../lib/BaseDevice';
import type { DeviceStateUpdate, XComfortDevice } from '../../lib/types';
import { resolveBinaryState } from '../../lib/utils/deviceClassification';

module.exports = class BinaryInputDevice extends BaseDevice {
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
    const isActive = resolveBinaryState(state);
    if (typeof isActive === 'boolean') {
      await this.updateCapability('alarm_generic', isActive);
    }

    if ('metadata' in state) {
      await this.applySensorMetadata((state as DeviceStateUpdate).metadata);
    } else {
      await this.applyDeviceMetadataSnapshot();
    }
  }
};
