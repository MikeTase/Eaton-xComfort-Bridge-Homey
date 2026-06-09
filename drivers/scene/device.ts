import { BaseDevice } from '../../lib/BaseDevice';

module.exports = class SceneDevice extends BaseDevice {
  async onDeviceReady() {
    // Scenes are momentary actions; Homey renders the 'button' class better
    // than 'other'. Migrate devices paired under the old class in place.
    if (typeof this.setClass === 'function' && this.getClass?.() !== 'button') {
      await this.setClass('button').catch(this.error);
    }

    await this.updateCapability('onoff', false);
    await this.syncSceneMetadata();

    this.registerCapabilityListener('onoff', async (value) => {
      if (!value) {
        return;
      }

      await this.activateScene();
    });
  }

  async activateScene(): Promise<void> {
    if (!this.bridge) {
      throw new Error('Bridge offline');
    }

    await this.bridge.activateScene(this.sceneId);
    await this.updateCapability('onoff', true);
    setTimeout(() => {
      this.updateCapability('onoff', false).catch(this.error);
    }, 750);
  }

  protected onBridgeChanged(): void {
    void this.syncSceneMetadata();
  }

  private async syncSceneMetadata(): Promise<void> {
    const scene = this.bridge.getScene(this.sceneId);
    if (scene?.name && scene.name !== this.getName()) {
      this.log(`Scene available: ${scene.name}`);
    }

    if (!scene) {
      return;
    }

    const nextSettings = {
      scene_order: typeof scene.order === 'number' ? String(scene.order) : '-',
      scene_type: scene.sceneType || '-',
      scene_conditions: scene.conditionSummary || '-',
      scene_schedule: scene.scheduleSummary || '-',
      scene_devices: String(
        typeof scene.deviceCount === 'number'
          ? scene.deviceCount
          : Array.isArray(scene.devices)
            ? scene.devices.length
            : 0,
      ),
    };
    const currentSettings = this.getSettings() as Record<string, unknown>;
    const hasChanges = Object.entries(nextSettings)
      .some(([key, value]) => currentSettings[key] !== value);
    if (hasChanges) {
      await this.setSettings(nextSettings).catch(this.error);
    }
  }

  private get sceneId(): string {
    return String(this.getData().sceneId);
  }
};
