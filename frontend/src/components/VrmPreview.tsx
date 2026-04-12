"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { VRMLoaderPlugin, VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMAnimation,
} from "@pixiv/three-vrm-animation";

export type VrmPreviewHandle = {
  play: () => void;
  pause: () => void;
  reset: () => void;
  getDuration: () => number;
};

type Props = {
  vrmUrl: string;
  vrmaBlob: Blob | null;
  autoPlay?: boolean;
};

export const VrmPreview = forwardRef<VrmPreviewHandle, Props>(function VrmPreview(
  { vrmUrl, vrmaBlob, autoPlay = true },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const animationRef = useRef<number | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const durationRef = useRef(0);

  const [vrm, setVrm] = useState<VRM | null>(null);
  const [status, setStatus] = useState<string>("初始化中");

  useImperativeHandle(ref, () => ({
    play() {
      const action = actionRef.current;
      if (action) {
        // action.reset() 重新排程 _startTime 到 mixer 當前時間，避免
        // 累積的 mixer time 讓 action 一開始就跳到結尾。
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      }
    },
    pause() {
      const action = actionRef.current;
      if (action) {
        action.paused = true;
      }
    },
    reset() {
      const action = actionRef.current;
      if (action) {
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        action.paused = true;
      }
    },
    getDuration() {
      return durationRef.current;
    },
  }));

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
      if (vrmRef.current) vrmRef.current.update(dt);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const nw = containerRef.current.clientWidth;
      const nh = containerRef.current.clientHeight || 480;
      rendererRef.current.setSize(nw, nh);
      cameraRef.current.aspect = nw / nh;
      cameraRef.current.updateProjectionMatrix();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
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
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        if (autoPlay) {
          action.play();
        } else {
          action.play();
          action.paused = true;
        }
        mixerRef.current = mixer;
        actionRef.current = action;
        durationRef.current = clip.duration;
        setStatus(`就緒：${clip.tracks.length} tracks / ${clip.duration.toFixed(2)}s`);
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(url);
        console.error("vrma load error", err);
        setStatus("VRMA 載入錯誤（見 console）");
      },
    );
  }, [vrm, vrmaBlob, autoPlay]);

  return (
    <div>
      <div style={{ padding: "4px 8px", background: "#eee", fontSize: "0.85em", color: "#333" }}>
        狀態：{status}
      </div>
      <div ref={containerRef} style={{ width: "100%", height: 480 }} />
    </div>
  );
});
