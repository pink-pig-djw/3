// Dev-only harness: renders a VRM front/back so models can be compared.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(360, 640);
renderer.setClearColor(0xe8e4dc);
document.body.appendChild(renderer.domElement);

window.renderVRM = async (url) => {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(1, 2, 3); scene.add(d);
  scene.add(vrm.scene);
  const h = vrm.humanoid;
  h.getNormalizedBoneNode('leftUpperArm').rotation.z = -1.2;
  h.getNormalizedBoneNode('rightUpperArm').rotation.z = 1.2;
  vrm.update(0);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const cam = new THREE.PerspectiveCamera(30, 360 / 640, 0.1, 50);
  const shots = [];
  for (const side of [1, -1]) {
    cam.position.set(0, box.getCenter(new THREE.Vector3()).y, side * 4.2);
    cam.lookAt(0, box.getCenter(new THREE.Vector3()).y, 0);
    renderer.render(scene, cam);
    shots.push(renderer.domElement.toDataURL('image/png'));
  }
  const info = { height: box.max.y - box.min.y, meta: vrm.meta.name, springs: vrm.springBoneManager?.joints?.size,
    expressions: vrm.expressionManager?.expressions.map((e) => e.expressionName).join(','),
    hips: h.getNormalizedBoneNode('hips').getWorldPosition(new THREE.Vector3()).y };
  return { shots, info };
};
window.ready = true;
