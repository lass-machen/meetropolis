import type Phaser from 'phaser';
import { acquireMemberAsset } from '../../lib/memberAssets';

export type AssetRef = { key: string; url: string };

type MemberFileType = 'image' | 'spritesheet';

// Load one protected file through the shared member-asset adapter.
// The blob URL is released once this file completes or fails; the decoded
// texture stays in the cache, so the URL is no longer needed afterwards.
async function loadMemberFile(
  scene: Phaser.Scene,
  key: string,
  ref: string,
  type: MemberFileType,
  addFile: (url: string) => void,
): Promise<void> {
  if (scene.textures.exists(key)) return;
  const { url, release } = await acquireMemberAsset(ref);
  const successEvent = `filecomplete-${type}-${key}`;
  return new Promise<void>((resolve, reject) => {
    const onError = (file: unknown) => {
      const failed = file as { key?: unknown; type?: unknown };
      if (failed.key !== key || failed.type !== type) return;
      scene.load.off(successEvent, onSuccess);
      scene.load.off('loaderror', onError);
      release();
      reject(new Error(`Failed to load ${type} "${key}" from ${ref}`));
    };
    const onSuccess = () => {
      scene.load.off('loaderror', onError);
      release();
      resolve();
    };
    addFile(url);
    scene.load.once(successEvent, onSuccess);
    scene.load.on('loaderror', onError);
    if (!scene.load.isLoading()) scene.load.start();
  });
}

// Load a protected member image into the texture cache.
export function loadMemberImage(scene: Phaser.Scene, key: string, ref: string): Promise<void> {
  return loadMemberFile(scene, key, ref, 'image', (url) => {
    scene.load.image(key, url);
  });
}

// Load a protected member spritesheet into the texture cache.
export function loadMemberSpritesheet(
  scene: Phaser.Scene,
  key: string,
  ref: string,
  frameConfig: Phaser.Types.Loader.FileTypes.ImageFrameConfig,
): Promise<void> {
  return loadMemberFile(scene, key, ref, 'spritesheet', (url) => {
    scene.load.spritesheet(key, url, frameConfig);
  });
}

export async function loadAssets(scene: Phaser.Scene, assets: AssetRef[]): Promise<void> {
  for (const asset of assets) {
    await loadMemberImage(scene, asset.key, asset.url);
  }
}
