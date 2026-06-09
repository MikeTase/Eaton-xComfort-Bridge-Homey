import { BaseDevice } from '../../lib/BaseDevice';
import type { DeviceMetadata, DeviceStateUpdate, InfoEntry } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

module.exports = class TemperatureSensorDevice extends BaseDevice {
  async onDeviceReady() {
    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      void this.applyMetadata(state.metadata);
    });

    await this.applyDeviceSnapshot();
  }

  protected onBridgeChanged(): void {
    void this.applyDeviceSnapshot();
  }

  private async applyDeviceSnapshot(): Promise<void> {
    const device = this.bridge.getDevice(this.deviceId);
    if (!device || !Array.isArray(device.info)) {
      return;
    }

    const metadata = parseInfoMetadata(device.info as InfoEntry[]);
    await this.applyMetadata(metadata);
  }

  private async applyMetadata(metadata?: DeviceMetadata): Promise<void> {
    // applySensorMetadata already ensures and updates the temperature and
    // humidity capabilities (plus battery/signal) from this metadata.
    await this.applySensorMetadata(metadata);
  }
};
