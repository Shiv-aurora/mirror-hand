import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

// Hand meshes: the generic WebXR hand from @webxr-input-profiles/assets (MIT),
// bundled locally so the app has no runtime CDN dependency.
export default defineAssets({
  'hand-left': {
    url: publicAssetUrl('hands/left.glb'),
    type: AssetType.GLTF,
    name: 'Left hand',
    priority: 'critical',
  },
  'hand-right': {
    url: publicAssetUrl('hands/right.glb'),
    type: AssetType.GLTF,
    name: 'Right hand',
    priority: 'critical',
  },
});
