import { BaseDevice } from '../../lib/BaseDevice';

module.exports = class SceneDevice extends BaseDevice {
  async onDeviceReady() {
    await this.updateCapability('onoff', false);

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
    const scene = this.bridge.getScene(this.sceneId);
    if (scene?.name && scene.name !== this.getName()) {
      this.log(`Scene available: ${scene.name}`);
    }
  }

  private get sceneId(): string {
    return String(this.getData().sceneId);
  }
};
