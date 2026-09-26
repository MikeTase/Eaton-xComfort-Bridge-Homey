import { BaseDevice } from '../../lib/BaseDevice';
import type { DeviceStateUpdate, XComfortDevice } from '../../lib/types';
import { resolveContactOpen } from '../../lib/utils/sensorState';

type DoorWindowStateLike = {
  curstate?: unknown;
  switch?: boolean;
};

module.exports = class DoorWindowSensorDevice extends BaseDevice {
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

    await this.applyContactState(this.resolveOpenState(device));
    await this.applyDeviceMetadataSnapshot();
  }

  private async updateFromState(state: DeviceStateUpdate): Promise<void> {
    await this.applyContactState(this.resolveOpenState(state));
    await this.applySensorMetadata(state.metadata);
  }

  /**
   * Open/closed depends on the sensor's configured mode (window/door, "ON
   * when closed" vs "ON when opened"), so the channel state is combined with
   * the device/component mode and the component's contact info codes.
   */
  private resolveOpenState(state: DoorWindowStateLike | XComfortDevice): boolean | undefined {
    const device = this.bridge?.getDevice(this.deviceId);
    const compId = device?.compId ?? (state as XComfortDevice).compId;
    const component = compId !== undefined && compId !== null
      ? this.bridge?.getComponent(String(compId))
      : undefined;
    const componentRaw = component?.raw ?? {};
    // Mode comes from the stored component/device configuration only; state
    // updates can carry unrelated `mode` fields.
    const deviceMode = (device as Record<string, unknown> | undefined)?.mode;

    return resolveContactOpen({
      curstate: state.curstate,
      switch: state.switch,
      mode: componentRaw.mode ?? deviceMode,
      componentInfo: componentRaw.info,
    });
  }

  private async applyContactState(isOpen: boolean | undefined): Promise<void> {
    if (typeof isOpen !== 'boolean') {
      return;
    }

    await this.updateCapability('alarm_contact', isOpen);
  }
};
