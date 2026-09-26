import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceStateUpdate, InfoEntry, ShadingAction } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';
import {
  bridgePositionToHomey,
  homeyPositionToBridge,
  isShadingSafetyActive,
  shadingMotionFromCurstate,
  shadingSupportsSteps,
} from '../../lib/utils/shadingState';

const TILT_CAPABILITIES = ['windowcoverings_tilt_up', 'windowcoverings_tilt_down'] as const;

module.exports = class ShadingDevice extends BaseDevice {
  private safetyActive: boolean = false;
  private lastCurstate: number | null = null;
  private lastPosition: number | null = null;
  private positionListenerRegistered: boolean = false;
  private tiltListenersRegistered: boolean = false;

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
    await this.syncTiltSupport();
  }

  /**
   * Step commands STEP_UP (4) / STEP_DOWN (3), like the official app's step
   * buttons. The official app offers them for blinds with slats
   * (`shHasSlats`, where a step turns the slats) and for the control options
   * that include steps (`shControl` 3, 5, 6). The protocol has no absolute
   * slat-angle command, so only the Homey tilt up/down buttons are offered.
   */
  private async syncTiltSupport(): Promise<void> {
    const bridgeDevice = this.bridge ? this.bridge.getDevice(this.deviceId) : undefined;
    const supportsSteps = bridgeDevice ? shadingSupportsSteps(bridgeDevice) : undefined;
    if (supportsSteps === undefined) {
      this.registerTiltListenersIfNeeded();
      return;
    }

    for (const capability of TILT_CAPABILITIES) {
      if (supportsSteps && !this.hasCapability(capability)) {
        await this.addCapability(capability).catch(this.error);
      } else if (!supportsSteps && this.hasCapability(capability)) {
        await this.removeCapability(capability).catch(this.error);
      }
    }

    if (supportsSteps && bridgeDevice && bridgeDevice.shHasSlats !== true) {
      // No slats: a step nudges the blind itself, so don't call it "tilt".
      await this.setCapabilityOptions('windowcoverings_tilt_up', {
        title: { en: 'Step up', nl: 'Stap omhoog' },
      }).catch(this.error);
      await this.setCapabilityOptions('windowcoverings_tilt_down', {
        title: { en: 'Step down', nl: 'Stap omlaag' },
      }).catch(this.error);
    }

    this.registerTiltListenersIfNeeded();
  }

  private registerTiltListenersIfNeeded(): void {
    if (this.tiltListenersRegistered || !this.hasCapability('windowcoverings_tilt_up')) {
      return;
    }
    this.tiltListenersRegistered = true;

    const step = async (action: ShadingAction) => {
      if (this.safetyActive) throw new Error('Safety lock active');
      const numericId = Number(this.deviceId);
      if (Number.isNaN(numericId)) throw new Error(`Invalid device ID: ${this.deviceId}`);
      await this.bridge.controlShading(numericId, action);
    };

    this.registerCapabilityListener('windowcoverings_tilt_up', async () => step(ShadingAction.STEP_UP));
    if (this.hasCapability('windowcoverings_tilt_down')) {
      this.registerCapabilityListener('windowcoverings_tilt_down', async () => step(ShadingAction.STEP_DOWN));
    }
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
      
      // Only `shPos` is a position. (`shadsClosed` is a room count of closed
      // blinds and `dimmvalue` is not a position for shading actuators.)
      if (data.shPos !== undefined) {
          const previousPosition = this.lastPosition;
          // Bridge 0 = open … 100 = closed; Homey 0 = closed … 1 = open.
          const pos = bridgePositionToHomey(data.shPos);
          if (pos !== undefined && this.hasCapability('windowcoverings_set')) {
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
              // Homey: 1 = open (up), 0 = closed (down).
              const state = value >= 1 ? 'up' : value <= 0 ? 'down' : 'idle';
              this.setCapabilityValue('windowcoverings_state', state).catch(this.error);
          }
          await this.bridge.controlShading(numericId, ShadingAction.GO_TO, homeyPositionToBridge(value));
      });
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

      // Homey positions: larger = more open (up).
      if (position !== null && previousPosition !== null && position !== previousPosition) {
          return position > previousPosition ? 'up' : 'down';
      }

      if (position !== null) {
          if (position >= 1) {
              return 'up';
          }
          if (position <= 0) {
              return 'down';
          }
      }

      return 'idle';
  }
};
