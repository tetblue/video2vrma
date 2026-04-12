"use client";

import { useEffect, useRef, useState } from "react";
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
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const animationRef = useRef<number | null>(null);
  const vrmRef = useRef<VRM | null>(null);

  const [vrm, setVrm] = useState<VRM | null>(null);
  const [status, setStatus] = useState<string>("初始化中");

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

    setStatus("載入 VRM 中...");
    loader.load(
      vrmUrl,
      (gltf) => {
        const loaded: VRM | undefined = gltf.userData.vrm;
        if (!loaded) {
          setStatus("載入失敗：gltf.userData.vrm 是 undefined");
          return;
        }
        scene.add(loaded.scene);
        // VRM 預設 rest pose 面向 +Z (VRM 規格)，但我們的相機在 +Z 往 -Z 看，
        // 所以實際上 rest pose 是背對相機；加 Y 180° 讓角色正面朝相機
        loaded.scene.rotation.y = Math.PI;
        vrmRef.current = loaded;
        setVrm(loaded);
        setStatus("VRM 就緒，等待 VRMA");
      },
      (progress) => {
        if (progress.total > 0) {
          setStatus(`載入 VRM ${Math.round((progress.loaded / progress.total) * 100)}%`);
        }
      },
      (err) => {
        console.error("vrm load error", err);
        setStatus("VRM 載入錯誤（見 console）");
      },
    );

    const tick = () => {
      animationRef.current = requestAnimationFrame(tick);
      const dt = clockRef.current.getDelta();
      if (mixerRef.current) mixerRef.current.update(dt);
      // vrm.update 必須在 mixer.update 之後呼叫，才能 apply humanoid bone pose
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
    if (!vrm || !vrmaBlob) return;

    setStatus("載入 VRMA 中...");
    const url = URL.createObjectURL(vrmaBlob);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        const vrmAnim: VRMAnimation | undefined = gltf.userData.vrmAnimations?.[0];
        if (!vrmAnim) {
          setStatus("VRMA 載入成功但沒有 vrmAnimations");
          return;
        }
        const clip = createVRMAnimationClip(vrmAnim, vrm);
        if (clip.tracks.length === 0) {
          setStatus("VRMA clip 沒有任何 track");
          return;
        }
        if (mixerRef.current) mixerRef.current.stopAllAction();
        const mixer = new THREE.AnimationMixer(vrm.scene);
        mixer.clipAction(clip).play();
        mixerRef.current = mixer;
        setStatus(`播放中：${clip.tracks.length} tracks / ${clip.duration.toFixed(2)}s`);
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(url);
        console.error("vrma load error", err);
        setStatus("VRMA 載入錯誤（見 console）");
      },
    );
  }, [vrm, vrmaBlob]);

  return (
    <div>
      <div style={{ padding: "4px 8px", background: "#eee", fontSize: "0.85em", color: "#333" }}>
        狀態：{status}
      </div>
      <div ref={containerRef} style={{ width: "100%", height: 480 }} />
    </div>
  );
}
