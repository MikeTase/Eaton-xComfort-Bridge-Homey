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
    if (!metadata) {
      return;
    }

    if (typeof metadata.temperature === 'number') {
      await this.updateCapability('measure_temperature', metadata.temperature);
    }

    if (typeof metadata.humidity === 'number') {
      if (!this.hasCapability('measure_humidity')) {
        await this.addCapability('measure_humidity').catch(this.error);
      }
      await this.updateCapability('measure_humidity', metadata.humidity);
    }
  }
};
