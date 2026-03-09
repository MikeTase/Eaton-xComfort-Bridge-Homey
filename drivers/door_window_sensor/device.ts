import { BaseDevice } from '../../lib/BaseDevice';
import type { DeviceStateUpdate, XComfortDevice } from '../../lib/types';

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
  }

  private async updateFromState(state: DeviceStateUpdate): Promise<void> {
    await this.applyContactState(this.resolveOpenState(state));
  }

  private resolveOpenState(state: DoorWindowStateLike | XComfortDevice): boolean | undefined {
    if (typeof state.curstate === 'number') {
      return state.curstate !== 1;
    }

    if (typeof state.switch === 'boolean') {
      return state.switch;
    }

    return undefined;
  }

  private async applyContactState(isOpen: boolean | undefined): Promise<void> {
    if (typeof isOpen !== 'boolean') {
      return;
    }

    await this.updateCapability('alarm_contact', isOpen);
  }
};
