import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class WallSwitchDevice extends Homey.Device {
  private bridge!: XComfortBridge;
  private triggerPressed: Homey.FlowCardTriggerDevice | null = null;
  private onDeviceUpdate!: (deviceId: string, state: DeviceStateUpdate) => void;

  async onInit() {
    this.log('WallSwitchDevice init:', this.getName());
    
    const app = this.homey.app as any;
    this.bridge = app.bridge;

    if (!this.bridge) {
      this.setUnavailable('Bridge not connected');
      return;
    }
    
    // Register Flow Trigger
    this.triggerPressed = this.homey.flow.getDeviceTriggerCard('wall_switch_pressed');
    const triggerUp = this.homey.flow.getDeviceTriggerCard('wall_switch_up');
    const triggerDown = this.homey.flow.getDeviceTriggerCard('wall_switch_down');

    this.onDeviceUpdate = (deviceId: string, state: DeviceStateUpdate) => {
        // Only verify this update belongs to this device (redundant with listener registration but safe)
        if (String(deviceId) === String(this.getData().deviceId)) {
            this.log('Switch Event:', state);
            
            // Trigger specific direction events
            if (state.switch === true) {
                 triggerUp.trigger(this, {}, {}).catch(this.error);
            } else if (state.switch === false) {
                 triggerDown.trigger(this, {}, {}).catch(this.error);
            }

            if (this.triggerPressed) {
                // Determine what data to pass to tokens.
                // Assuming tokens might be { state: boolean } or similar based on driver.json
                this.triggerPressed.trigger(this, {}, { event: JSON.stringify(state) })
                    .catch(this.error);
            }
        }
    };

    // Register listener for this specific device
    this.bridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
  }

  onDeleted() {
      if (this.bridge && this.onDeviceUpdate) {
          this.bridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
          this.log('WallSwitchDevice listener removed');
      }
  }
}
