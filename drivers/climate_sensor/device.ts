import { BaseDevice } from '../../lib/BaseDevice';
import type { DeviceMetadata, DeviceStateUpdate, InfoEntry, XComfortDevice } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

module.exports = class ClimateSensorDevice extends BaseDevice {
  async onDeviceReady() {
    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      void this.updateFromState(state);
    });

    await this.applyDeviceSnapshot();
  }

  private async applyDeviceSnapshot(): Promise<void> {
    const device = this.bridge.getDevice(this.deviceId);
    if (!device) {
      return;
    }

    const metadata = this.parseDeviceMetadata(device);
    await this.applyMetadata(metadata);
  }

  private parseDeviceMetadata(device: XComfortDevice): DeviceMetadata {
    if (!Array.isArray(device.info)) {
      return {};
    }

    return parseInfoMetadata(device.info as InfoEntry[]);
  }

  private async updateFromState(state: DeviceStateUpdate): Promise<void> {
    if (!state.metadata) {
      return;
    }

    await this.applyMetadata(state.metadata);
  }

  private async applyMetadata(metadata: DeviceMetadata): Promise<void> {
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
