import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceStateUpdate, InfoEntry, ShadingAction } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';
import { isShadingSafetyActive, shadingMotionFromCurstate } from '../../lib/utils/shadingState';

module.exports = class ShadingDevice extends BaseDevice {
  private safetyActive: boolean = false;
  private lastCurstate: number | null = null;
  private lastPosition: number | null = null;
  private positionListenerRegistered: boolean = false;

  async onDeviceReady() {
    this.registerStateListener();
    this.registerCapabilityListeners();
    this.applyDeviceSnapshot();
    await this.syncPositionSupport();
  }

  /**
   * Determine whether this shading actuator supports "go to position"
   * (shRuntime === 1, mirroring ha-xcomfort-bridge) and add/remove the
   * windowcoverings_set capability accordingly.
   *
   * The value is read from the device settings (stored during pairing) and
   * falls back to live bridge data, which also self-heals devices paired by
   * app versions that did not persist the setting.
   */
  private async syncPositionSupport(): Promise<void> {
    const settings = this.getSettings();
    let shRuntime: number | undefined =
      typeof settings.shRuntime === 'number' ? settings.shRuntime : undefined;

    const bridgeDevice = this.bridge ? this.bridge.getDevice(this.deviceId) : undefined;
    const liveRuntime =
      bridgeDevice && typeof bridgeDevice.shRuntime === 'number' ? bridgeDevice.shRuntime : undefined;

    if (liveRuntime !== undefined && liveRuntime !== shRuntime) {
      shRuntime = liveRuntime;
      await this.setSettings({ shRuntime: liveRuntime }).catch(this.error);
    }

    const supportsPosition = shRuntime === 1;

    if (supportsPosition && !this.hasCapability('windowcoverings_set')) {
      await this.addCapability('windowcoverings_set').catch(this.error);
    } else if (!supportsPosition && shRuntime !== undefined && this.hasCapability('windowcoverings_set')) {
      await this.removeCapability('windowcoverings_set').catch(this.error);
    }

    this.registerPositionListenerIfNeeded();
  }

  /**
   * Re-evaluate position support when the user changes the setting manually.
   */
  async onSettings({ changedKeys }: { newSettings: Record<string, unknown>; changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes('shRuntime')) {
      // Defer so the new settings value is readable via getSettings().
      setTimeout(() => {
        void this.syncPositionSupport();
      }, 100);
    }
  }

  private registerStateListener() {
    this.addManagedStateListener(this.deviceId, (_id, data) => {
        this.updateState(data);
    });
  }
  
  private updateState(data: DeviceStateUpdate) {
      if (data.metadata) {
          void this.applySensorMetadata(data.metadata);
      }

      // The live safety lock is reported by curstate 4/5 (or the "locked"
      // info codes on older actuators). `shSafety` is only the configuration
      // flag "safety function enabled" and must not be read as a lock.
      const infoForLock = typeof data.curstate === 'number' || !data.metadata
          ? undefined
          : this.bridge.getDevice(this.deviceId)?.info;
      const locked = isShadingSafetyActive(data.curstate, infoForLock);
      if (locked !== undefined) {
          this.safetyActive = locked;
          // Surface the wind/rain lock as an alarm instead of marking the
          // device unavailable: position stays visible, Flows can react to the
          // alarm, and movement commands are still rejected while locked.
          void this.ensureDeviceCapability('alarm_generic')
              .then(() => this.updateCapability('alarm_generic', locked))
              .catch(this.error);
      }

      // Track curstate for running/idle detection.
      if (typeof data.curstate === 'number') {
          this.lastCurstate = data.curstate;
          if (this.hasCapability('windowcoverings_state')) {
              this.setCapabilityValue(
                  'windowcoverings_state',
                  this.resolveWindowcoveringsState(this.lastPosition),
              ).catch(this.error);
          }
      }
      
      if (data.shPos !== undefined || data.shadsClosed !== undefined || data.dimmvalue !== undefined) {
          const previousPosition = this.lastPosition;
          const pos = this.normalizePosition(data.shPos ?? data.shadsClosed ?? data.dimmvalue);
          if (pos !== undefined && this.hasCapability('windowcoverings_set')) {
              // Values > 1 are on the 0-100 scale, normalize to 0-1
              this.setCapabilityValue('windowcoverings_set', pos).catch(this.error);
              if (this.hasCapability('windowcoverings_state')) {
                  this.setCapabilityValue(
                      'windowcoverings_state',
                      this.resolveWindowcoveringsState(pos, previousPosition),
                  ).catch(this.error);
              }
          }
          if (pos !== undefined) {
              this.lastPosition = pos;
          }
      }
  }

  protected onBridgeChanged(): void {
      this.applyDeviceSnapshot();
      void this.syncPositionSupport();
  }

  private applyDeviceSnapshot(): void {
      const device = this.bridge.getDevice(this.deviceId);
      if (!device) {
          return;
      }

      const snapshot: DeviceStateUpdate = {};
      if (typeof device.shPos === 'number') {
          snapshot.shPos = device.shPos;
      }
      if (typeof device.shadsClosed === 'number') {
          snapshot.shadsClosed = device.shadsClosed;
      }
      if (typeof device.dimmvalue === 'number') {
          snapshot.dimmvalue = device.dimmvalue;
      }
      if (device.curstate !== undefined) {
          snapshot.curstate = device.curstate;
      }
      if (Array.isArray(device.info)) {
          const metadata = parseInfoMetadata(device.info as InfoEntry[]);
          if (Object.keys(metadata).length > 0) {
              snapshot.metadata = metadata;
          }
      }

      if (Object.keys(snapshot).length > 0) {
          this.updateState(snapshot);
      }
  }

  private registerCapabilityListeners() {
      // Position Set (registered separately so it can be attached when the
      // capability is added later by syncPositionSupport)
      this.registerPositionListenerIfNeeded();

      // State (Up/Down/Idle)
      this.registerCapabilityListener('windowcoverings_state', async (value) => {
           if (this.safetyActive) throw new Error('Safety lock active');
           
           let action = ShadingAction.STOP;
           if (value === 'up') action = ShadingAction.OPEN;
           if (value === 'down') action = ShadingAction.CLOSE;
           
           const numericId = Number(this.deviceId);
           if (Number.isNaN(numericId)) throw new Error(`Invalid device ID: ${this.deviceId}`);
           this.setCapabilityValue('windowcoverings_state', value).catch(this.error);
           await this.bridge.controlShading(numericId, action);
      });
  }

  private registerPositionListenerIfNeeded() {
      if (this.positionListenerRegistered || !this.hasCapability('windowcoverings_set')) {
          return;
      }
      this.positionListenerRegistered = true;

      this.registerCapabilityListener('windowcoverings_set', async (value) => {
          if (this.safetyActive) throw new Error('Safety lock active');

          const numericId = Number(this.deviceId);
          if (Number.isNaN(numericId)) throw new Error(`Invalid device ID: ${this.deviceId}`);
          if (this.hasCapability('windowcoverings_state')) {
              const state = value <= 0 ? 'up' : value >= 1 ? 'down' : 'idle';
              this.setCapabilityValue('windowcoverings_state', state).catch(this.error);
          }
          await this.bridge.controlShading(numericId, ShadingAction.GO_TO, value * 100);
      });
  }

  private normalizePosition(value?: number): number | undefined {
      if (typeof value !== 'number' || Number.isNaN(value)) {
          return undefined;
      }

      return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  }

  private resolveWindowcoveringsState(
      position: number | null,
      previousPosition: number | null = this.lastPosition,
  ): 'up' | 'idle' | 'down' {
      // curstate is the actuator's reported motion (official enum:
      // 1 stopped, 2 moving up, 3 moving down, 4/5 safety, 6/7 stopped on
      // fault) — not the command enum.
      const motion = shadingMotionFromCurstate(this.lastCurstate);
      if (motion !== undefined) {
          return motion;
      }

      if (position !== null && previousPosition !== null && position !== previousPosition) {
          return position < previousPosition ? 'up' : 'down';
      }

      if (position !== null) {
          if (position <= 0) {
              return 'up';
          }
          if (position >= 1) {
              return 'down';
          }
      }

      return 'idle';
  }
};
