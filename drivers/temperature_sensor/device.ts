import { BaseDevice } from '../../lib/BaseDevice';
import type { DeviceMetadata, DeviceStateUpdate, InfoEntry } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

/**
 * Sensor devices can carry `temp`/`humidity` as plain fields (seen in the
 * official app's data model for devTypes 410/450/451). Use them only when
 * the info codes did not provide a value.
 */
function withDirectReadings(
  metadata: DeviceMetadata | undefined,
  source: { temp?: unknown; humidity?: unknown },
): DeviceMetadata | undefined {
  const result: DeviceMetadata = { ...(metadata || {}) };
  if (result.temperature === undefined && typeof source.temp === 'number' && Number.isFinite(source.temp)) {
    result.temperature = source.temp;
  }
  if (result.humidity === undefined && typeof source.humidity === 'number' && Number.isFinite(source.humidity)) {
    result.humidity = source.humidity;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

module.exports = class TemperatureSensorDevice extends BaseDevice {
  async onDeviceReady() {
    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      void this.applyMetadata(withDirectReadings(state.metadata, state));
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

    const metadata = Array.isArray(device.info) ? parseInfoMetadata(device.info as InfoEntry[]) : undefined;
    await this.applyMetadata(withDirectReadings(metadata, device as Record<string, unknown>));
  }

  private async applyMetadata(metadata?: DeviceMetadata): Promise<void> {
    // applySensorMetadata already ensures and updates the temperature and
    // humidity capabilities (plus battery/signal) from this metadata.
    await this.applySensorMetadata(metadata);
  }
};
