import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import { BVH } from "three/examples/jsm/loaders/BVHLoader";
import { getRootBone } from "./getRootBone";
import { mapSkeletonToVRM } from "./mapSkeletonToVRM";
import { VRMAnimationExporterPlugin } from "./VRMAnimationExporterPlugin";

const _v3A = new THREE.Vector3();

function createSkeletonBoundingBox(skeleton: THREE.Skeleton): THREE.Box3 {
  const boundingBox = new THREE.Box3();
  for (const bone of skeleton.bones) {
    boundingBox.expandByPoint(bone.getWorldPosition(_v3A));
  }
  return boundingBox;
}

export async function convertBVHToVRMAnimation(
  bvh: BVH,
  options?: {
    scale?: number;
  }
): Promise<ArrayBuffer> {
  const scale = options?.scale ?? 0.01;

  const skeleton = bvh.skeleton.clone();

  const clip = bvh.clip.clone();

  // find root bone of the skeleton
  const rootBone = getRootBone(skeleton);

  // scale the entire tree by 0.01
  rootBone.traverse((bone) => {
    bone.position.multiplyScalar(scale);
  });
  rootBone.updateWorldMatrix(false, true);

  // create a map from vrm bone names to bones
  const vrmBoneMap = mapSkeletonToVRM(rootBone);
  rootBone.userData.vrmBoneMap = vrmBoneMap;

  // rename quaternion tracks. 不輸出 hips position track —
  // createVRMAnimationClip 會把 track 值直接寫到 VRM hips local position，
  // 蓋掉 VRM 本身的 rest hips 位置造成角色沉到地面以下。Phase 2 我們只需要
  // 骨骼旋轉動畫，讓 VRM hips 停在自己的 rest 位置即可。
  const filteredTracks: THREE.KeyframeTrack[] = [];
  for (const origTrack of bvh.clip.tracks) {
    const track = origTrack.clone();
    track.name = track.name.replace(/\.bones\[(.*)\]/, "$1");
    if (track.name.endsWith(".quaternion")) {
      filteredTracks.push(track);
    }
  }

  clip.tracks = filteredTracks;

  // 把 skeleton auto-ground，避免 exported glb 的 rest hips Y 是負值
  const boundingBox = createSkeletonBoundingBox(skeleton);
  if (boundingBox.min.y < 0) {
    rootBone.position.y -= boundingBox.min.y;
  }


  // export as a gltf
  const exporter = new GLTFExporter();
  exporter.register((writer) => new VRMAnimationExporterPlugin(writer));

  const gltf = await exporter.parseAsync(rootBone, {
    animations: [clip],
    binary: true,
  });
  return gltf as ArrayBuffer;
}
