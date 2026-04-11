import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader";

import { convertBVHToVRMAnimation } from "@/lib/bvh2vrma/convertBVHToVRMAnimation";

export async function bvhTextToVrmaBlob(
  bvhText: string,
  options: { scale?: number } = {},
): Promise<Blob> {
  const bvh = new BVHLoader().parse(bvhText);
  const buf = await convertBVHToVRMAnimation(bvh, { scale: options.scale ?? 0.01 });
  return new Blob([buf], { type: "model/gltf-binary" });
}
