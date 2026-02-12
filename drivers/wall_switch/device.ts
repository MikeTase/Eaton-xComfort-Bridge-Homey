import * as Homey from 'homey';
import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class WallSwitchDevice extends BaseDevice {
  private triggerPressed: Homey.FlowCardTriggerDevice | null = null;
  private onDeviceUpdate!: (deviceId: string, state: DeviceStateUpdate) => void;
  private debug: boolean = false;

  async onInit() {
    try {
        await super.onInit();
    } catch (e) {
        return;
    }

    this.debug = process.env.XCOMFORT_DEBUG === '1';

    if (!this.hasCapability('onoff')) {
      await this.addCapability('onoff').catch(this.error);
    }
    
    // Allow UI interaction to update state (or handle errors if strictly read-only)
    this.registerCapabilityListener('onoff', async (value) => {
        // Since wall switches are input devices, we mainly track state. 
        // Allowing this listener removes the "missing capability listener" error
        // and allows the user to manually correct the state in the app if needed.
        if (this.debug) {
          this.log('Wall switch state manually set to:', value);
        }
    });

    // Register Flow Trigger
    this.triggerPressed = this.homey.flow.getDeviceTriggerCard('wall_switch_pressed');
    const triggerUp = this.homey.flow.getDeviceTriggerCard('wall_switch_up');
    const triggerDown = this.homey.flow.getDeviceTriggerCard('wall_switch_down');

    this.onDeviceUpdate = (deviceId: string, state: DeviceStateUpdate) => {
        // Only verify this update belongs to this device (redundant with listener registration but safe)
        if (String(deviceId) === String(this.getData().deviceId)) {
            if (this.debug) {
              this.log('Switch Event:', state);
            }
            
            if (typeof state.switch === 'boolean') {
                this.setCapabilityValue('onoff', state.switch).catch(this.error);
            }

            // Trigger specific direction events
            if (state.switch === true) {
                 if (triggerUp) triggerUp.trigger(this, {}, {}).catch(this.error);
            } else if (state.switch === false) {
                 if (triggerDown) triggerDown.trigger(this, {}, {}).catch(this.error);
            }

            if (this.triggerPressed) {
                // Determine what data to pass to tokens.
                if (Object.keys(state).length > 0) {
                     this.triggerPressed.trigger(this, { event: JSON.stringify(state) }, {})
                        .catch(this.error);
                }
            }
        }
    };

    // Register listener for this specific device
    this.bridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
  }

  protected onBridgeChanged(newBridge: XComfortBridge, oldBridge: XComfortBridge): void {
      if (this.onDeviceUpdate) {
          oldBridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
          newBridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
      }
  }

  onDeleted() {
      if (this.bridge && this.onDeviceUpdate) {
          this.bridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
          this.log('WallSwitchDevice listener removed');
      }
      super.onDeleted();
  }
}
