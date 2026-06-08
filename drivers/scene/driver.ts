import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortScene } from '../../lib/types';

interface ActivateSceneArgs {
  device?: {
    activateScene?: () => Promise<void>;
  };
}

module.exports = class SceneDriver extends BaseDriver {
  async onInit() {
    super.onInit();

    const activateSceneAction = this.homey.flow.getActionCard('activate_xcomfort_scene');
    if (activateSceneAction) {
      activateSceneAction.registerRunListener(async (args: ActivateSceneArgs) => {
        const device = args.device;
        if (!device || typeof device.activateScene !== 'function') {
          throw new Error('No xComfort scene selected');
        }

        await device.activateScene();
        return true;
      });
    }
  }

  private async listUnpairedScenes() {
    const scenes = await this.getScenesFromBridge();
    const candidates = scenes
      .filter((scene) => scene.show !== false)
      .sort((left, right) => {
        const leftOrder = typeof left.order === 'number' ? left.order : Number.MAX_SAFE_INTEGER;
        const rightOrder = typeof right.order === 'number' ? right.order : Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.name.localeCompare(right.name);
      })
      .map((scene) => this.formatScene(scene));

    return this.filterUnpairedPairingDevices(candidates);
  }

  private formatScene(scene: XComfortScene) {
    const name = this.getDisplayNameWithBridge(scene.name || `Scene ${scene.sceneId}`, scene);
    return {
      name,
      data: this.getBridgeSceneData(scene),
      settings: {
        scene_order: typeof scene.order === 'number' ? String(scene.order) : '-',
        scene_devices: String(typeof scene.deviceCount === 'number' ? scene.deviceCount : Array.isArray(scene.devices) ? scene.devices.length : 0),
      },
    };
  }

  private getBridgeSceneData(scene: XComfortScene): Record<string, unknown> {
    const bridgeId = this.getItemBridgeId(scene);
    const sceneId = String(scene.sceneId);
    return {
      id: bridgeId ? `${bridgeId}_scene_${sceneId}` : `scene_${sceneId}`,
      sceneId,
      ...(bridgeId ? { bridgeId } : {}),
    };
  }

  async onPairListDevices() {
    return this.listUnpairedScenes();
  }
};
