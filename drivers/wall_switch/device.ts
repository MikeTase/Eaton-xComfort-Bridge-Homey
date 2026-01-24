import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/Bridge';
import { DeviceState } from '../../lib/types';

module.exports = class WallSwitchDevice extends Homey.Device {
  private bridge!: XComfortBridge;
  private triggerPressed: Homey.FlowCardTriggerDevice | null = null;

  async onInit() {
    this.log('WallSwitchDevice init:', this.getName());
    
    const app = this.homey.app as any;
    // Dependency injection: allow bridge to be passed in for testing or advanced use
    this.bridge = app.getBridge?.() || app.bridge;

    if (!this.bridge) {
      this.setUnavailable('Bridge not connected');
      return;
    }
    
    // Register Flow Trigger
    // Ensure you define this in app.json if you want it visible, 
    // or use standard capability triggers if capabilities are used.
    // For now we assume a custom trigger 'switch_pressed'.
    this.triggerPressed = this.homey.flow.getDeviceTriggerCard('wall_switch_pressed');

    this.bridge.on('state_update', (items: DeviceState[] | DeviceState) => {
      const updates = Array.isArray(items) ? items : [items];
      const update = updates.find((d: DeviceState) => String(d.deviceId) === String(this.getData().deviceId));
      if (update) {
         this.log('Switch Event:', update);
         // Trigger flow
         if (this.triggerPressed) {
           this.triggerPressed.trigger(this, {}, { event: JSON.stringify(update) })
          .catch(this.error);
         }
      }
    });
  }
}
