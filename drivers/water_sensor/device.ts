import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceStateUpdate, XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class WaterSensorDevice extends BaseDevice {

  async onDeviceReady() {
    await this.ensureCapabilities();
    this.registerCapabilityListeners();

    this.addManagedStateListener(this.deviceId, (_deviceId: string, state: DeviceStateUpdate) => {
      void this.updateState(state);
    });

    void this.applyDeviceSnapshot();
  }

  private async ensureCapabilities(): Promise<void> {
    if (this.isWaterGuard() && !this.hasCapability('onoff')) {
      await this.addCapability('onoff').catch(this.error);
    }
  }

  private registerCapabilityListeners(): void {
    if (!this.hasCapability('onoff')) {
      return;
    }

    this.registerCapabilityListener('onoff', async (value: boolean) => {
      if (!this.bridge) {
        throw new Error('Bridge offline');
      }

      await this.updateCapability('onoff', value);

      try {
        await this.bridge.switchDevice(this.deviceId, value);
      } catch (error) {
        await this.updateCapability('onoff', !value);
        throw error;
      }
    });
  }

  private async updateState(state: DeviceStateUpdate): Promise<void> {
    const alarm = this.resolveAlarmState(state);

    if (alarm !== undefined) {
      await this.updateCapability('alarm_water', alarm);
    }

    if (typeof state.switch === 'boolean' && this.hasCapability('onoff')) {
      await this.updateCapability('onoff', state.switch);

      // When the valve is reopened (switch=true) and there is no curstate in
      // this update, clear any active alarm.  In xComfort, reopening the valve
      // means the alarm was acknowledged and resolved.
      if (state.switch === true && alarm === undefined) {
        const currentAlarm = this.getCapabilityValue('alarm_water');
        if (currentAlarm === true) {
          this.log('Clearing water alarm — valve reopened without active alarm indication');
          await this.updateCapability('alarm_water', false);
        }
      }
    }
  }

  protected onBridgeChanged(): void {
    void this.applyDeviceSnapshot();
  }

  private async applyDeviceSnapshot(): Promise<void> {
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
      await this.updateState(snapshot);
    }

    // If the bridge reports no curstate at all, clear any stale alarm that
    // persisted from a previous session.  A real alarm will be set again as
    // soon as the bridge sends a curstate update.
    if (device.curstate === undefined && this.getCapabilityValue('alarm_water') === true) {
      this.log('Clearing stale water alarm — no alarm indication from bridge data');
      await this.updateCapability('alarm_water', false);
    }
  }

  private resolveAlarmState(state: { switch?: boolean; curstate?: unknown } | XComfortDevice): boolean | undefined {
    if (typeof state.curstate === 'number') {
      return state.curstate !== 1;
    }

    return undefined;
  }

  private isWaterGuard(): boolean {
    const settings = this.getSettings() as { deviceType?: number };
    return Number(settings.deviceType) === DEVICE_TYPES.WATER_GUARD;
  }

  /**
   * Public method for flow action card to control the water valve.
   * open = true  → valve open (water flows)
   * open = false → valve closed (water blocked)
   */
  async setValveState(open: boolean): Promise<void> {
    if (!this.hasCapability('onoff')) {
      throw new Error('This device does not have a controllable valve');
    }
    if (!this.bridge) {
      throw new Error('Bridge offline');
    }

    await this.updateCapability('onoff', open);

    try {
      await this.bridge.switchDevice(this.deviceId, open);
    } catch (error) {
      await this.updateCapability('onoff', !open);
      throw error;
    }
  }
};
