"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { VRMLoaderPlugin, VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMAnimation,
} from "@pixiv/three-vrm-animation";

type Props = {
  vrmUrl: string;
  vrmaBlob: Blob | null;
};

export function VrmPreview({ vrmUrl, vrmaBlob }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight || 480;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.setClearColor(0x222233);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 20);
    camera.position.set(0, 1.2, 3);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.0, 0);
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(1, 2, 3);
    scene.add(dir);

    const grid = new THREE.GridHelper(4, 8, 0x888888, 0x444444);
    scene.add(grid);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    loader.load(
      vrmUrl,
      (gltf) => {
        const vrm: VRM | undefined = gltf.userData.vrm;
        if (!vrm) {
          console.error("loaded gltf has no VRM userData");
          return;
        }
        scene.add(vrm.scene);
        vrm.scene.rotation.y = Math.PI;
        vrmRef.current = vrm;
      },
      undefined,
      (err) => console.error("vrm load error", err),
    );

    const tick = () => {
      animationRef.current = requestAnimationFrame(tick);
      const dt = clockRef.current.getDelta();
      if (mixerRef.current) mixerRef.current.update(dt);
      if (vrmRef.current) vrmRef.current.update(dt);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const nw = containerRef.current.clientWidth;
      const nh = containerRef.current.clientHeight || 480;
      rendererRef.current.setSize(nw, nh);
      cameraRef.current.aspect = nw / nh;
      cameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [vrmUrl]);

  useEffect(() => {
    if (!vrmaBlob || !vrmRef.current) return;
    const vrm = vrmRef.current;
    const url = URL.createObjectURL(vrmaBlob);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        const vrmAnim: VRMAnimation | undefined = gltf.userData.vrmAnimations?.[0];
        if (!vrmAnim) {
          console.error("no vrmAnimations in loaded gltf");
          URL.revokeObjectURL(url);
          return;
        }
        const clip = createVRMAnimationClip(vrmAnim, vrm);
        const mixer = new THREE.AnimationMixer(vrm.scene);
        mixer.clipAction(clip).play();
        mixerRef.current = mixer;
        URL.revokeObjectURL(url);
      },
      undefined,
      (err) => {
        console.error("vrma load error", err);
        URL.revokeObjectURL(url);
      },
    );
  }, [vrmaBlob]);

  return <div ref={containerRef} style={{ width: "100%", height: 480 }} />;
}
