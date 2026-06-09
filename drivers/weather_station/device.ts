import { BaseDevice } from '../../lib/BaseDevice';
import { XCOMFORT_CAPABILITIES } from '../../lib/XComfortCapabilities';
import type { DeviceMetadata, DeviceStateUpdate, InfoEntry, XComfortDevice } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

module.exports = class WeatherStationDevice extends BaseDevice {
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
    const metadata = this.getMetadata(state);
    if (!metadata) {
      return;
    }

    await this.applySensorMetadata(metadata);

    if (typeof metadata.brightness === 'number') {
      await this.ensureDeviceCapability('measure_luminance');
      await this.updateCapability('measure_luminance', metadata.brightness);
    }

    if (typeof metadata.windSpeed === 'number') {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.WIND_SPEED);
      await this.updateCapability(XCOMFORT_CAPABILITIES.WIND_SPEED, metadata.windSpeed);
    }

    if (typeof metadata.rain === 'boolean') {
      await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.RAIN);
      await this.updateCapability(XCOMFORT_CAPABILITIES.RAIN, metadata.rain);
    }
  }

  private getMetadata(state: DeviceStateUpdate | XComfortDevice): DeviceMetadata | undefined {
    if ('metadata' in state && state.metadata) {
      return state.metadata;
    }

    if ('info' in state && Array.isArray(state.info)) {
      return parseInfoMetadata(state.info as InfoEntry[]);
    }

    return undefined;
  }
};
