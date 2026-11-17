import {
  AssetManager,
  BufferAttribute,
  Color,
  FrontSide,
  Group,
  LessEqualDepth,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import {
  FINGER_TIPS,
  JOINT_COUNT,
  JOINTS,
  THUMB_TIP,
  type HandState,
  type Side,
} from './hand-tracking.js';

const VERTEX = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  attribute float wristDist;
  varying float vWristDist;
  varying vec3 vNormalView;
  varying vec3 vToEye;

  void main() {
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vNormalView = normalize(transformedNormal);
    vToEye = -mvPosition.xyz;
    vWristDist = wristDist;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 baseColor;
  uniform vec3 rimColor;
  uniform float opacity;
  uniform float glow;
  uniform float fadeFrom;
  uniform float fadeTo;
  varying float vWristDist;
  varying vec3 vNormalView;
  varying vec3 vToEye;

  void main() {
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(vToEye);
    float facing = max(dot(n, v), 0.0);
    float rim = pow(1.0 - facing, 2.2);
    float wrap = 0.5 + 0.5 * n.y;
    vec3 color = baseColor * (0.5 + 0.5 * wrap) + rimColor * rim * (0.85 + glow);
    color += baseColor * glow * 0.25;
    // Fade out towards the wrist so the hand does not end in a hard stump.
    float alpha = smoothstep(fadeFrom, fadeTo, vWristDist) * opacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Depth-only pass: lets the hand hide its own far side, so the see-through
// wrist fade does not show fingers through the palm.
const DEPTH_FRAGMENT = /* glsl */ `
  uniform float opacity;
  uniform float fadeFrom;
  uniform float fadeTo;
  varying float vWristDist;
  varying vec3 vNormalView;
  varying vec3 vToEye;
  void main() {
    float alpha = smoothstep(fadeFrom, fadeTo, vWristDist) * opacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(0.0);
  }
`;

const TIP_GEOMETRY = new SphereGeometry(0.011, 16, 12);

/**
 * A rendered hand: the generic WebXR hand mesh with our own soft material,
 * driven directly by 25 joint matrices. The same class draws the hand the
 * person is really moving and the mirrored one.
 */
export class HandVisual {
  readonly root = new Group();
  private readonly bones: (Object3D | undefined)[] = [];
  private readonly material: ShaderMaterial;
  /** Small lights on the thumb tip and four fingertips, for the chimes. */
  private readonly tipLights: Mesh[] = [];
  private readonly tipMaterials: MeshBasicMaterial[] = [];
  private opacity = 0;
  private targetOpacity = 0;

  constructor(readonly side: Side) {
    const gltf = AssetManager.getGLTF(`hand-${side}`, { shared: true });
    if (!gltf) {
      throw new Error(`Hand model for the ${side} hand did not load.`);
    }
    const model = gltf.scene;
    this.root.name = `mirror-hand-${side}`;
    this.root.add(model);

    const uniforms = {
      baseColor: { value: new Color(0xd9c9b8) },
      rimColor: { value: new Color(0xffe2b0) },
      opacity: { value: 0 },
      glow: { value: 0 },
      fadeFrom: { value: -0.03 },
      fadeTo: { value: 0.012 },
    };
    this.material = new ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: FrontSide,
      transparent: true,
      depthWrite: false,
      depthFunc: LessEqualDepth,
    });
    const depthMaterial = new ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: DEPTH_FRAGMENT,
      side: FrontSide,
      colorWrite: false,
    });

    const skinned = model.getObjectByProperty('type', 'SkinnedMesh') as
      | SkinnedMesh
      | undefined;
    if (skinned) {
      skinned.frustumCulled = false;
      // How far every vertex sits along the hand, measured from the wrist
      // towards the knuckles. Only the stub behind the wrist fades out.
      const wrist = model.getObjectByName('wrist');
      const knuckle = model.getObjectByName('middle-finger-phalanx-proximal');
      const wristPosition = new Vector3();
      const along = new Vector3(0, 0, -1);
      model.updateMatrixWorld(true);
      if (wrist && knuckle) {
        wrist.getWorldPosition(wristPosition);
        knuckle.getWorldPosition(along);
        skinned.worldToLocal(wristPosition);
        skinned.worldToLocal(along);
        along.sub(wristPosition).normalize();
      }
      const positions = skinned.geometry.attributes.position;
      const distances = new Float32Array(positions.count);
      const vertex = new Vector3();
      let lowest = 0;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).sub(wristPosition);
        distances[i] = vertex.dot(along);
        lowest = Math.min(lowest, distances[i]);
      }
      uniforms.fadeFrom.value = lowest + 0.002;
      uniforms.fadeTo.value = Math.max(lowest + 0.03, 0.014);
      (globalThis as { __handFade?: number[] }).__handFade = [lowest];
      skinned.geometry.setAttribute(
        'wristDist',
        new BufferAttribute(distances, 1),
      );
      skinned.material = depthMaterial;
      skinned.renderOrder = 1;
      const colorPass = skinned.clone();
      colorPass.material = this.material;
      colorPass.renderOrder = 2;
      colorPass.frustumCulled = false;
      skinned.parent?.add(colorPass);
    }

    for (const name of JOINTS) {
      this.bones.push(model.getObjectByName(name));
    }

    for (let i = 0; i < 5; i++) {
      const material = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const light = new Mesh(TIP_GEOMETRY, material);
      light.visible = false;
      light.renderOrder = 5;
      this.root.add(light);
      this.tipLights.push(light);
      this.tipMaterials.push(material);
    }

    this.root.visible = false;
  }

  /** Fade the hand in or out. */
  show(visible: boolean): void {
    this.targetOpacity = visible ? 1 : 0;
  }

  setGlow(amount: number): void {
    this.material.uniforms.glow.value = amount;
  }

  /**
   * Light a fingertip. `finger` is 0 for the thumb, 1–4 for index to pinky.
   * Pass an intensity of 0 to switch it off.
   */
  setTipLight(finger: number, color: number, intensity: number): void {
    const material = this.tipMaterials[finger];
    material.color.setHex(color);
    material.opacity = Math.min(1, intensity);
    this.tipLights[finger].visible = intensity > 0.01;
  }

  clearTipLights(): void {
    for (let i = 0; i < 5; i++) {
      this.tipMaterials[i].opacity = 0;
      this.tipLights[i].visible = false;
    }
  }

  /** Pose the mesh from a hand state and advance the fade. */
  update(state: HandState, delta: number): void {
    const wanted = state.tracked ? this.targetOpacity : 0;
    const rate = wanted > this.opacity ? 3.5 : 6;
    this.opacity += Math.sign(wanted - this.opacity) *
      Math.min(Math.abs(wanted - this.opacity), rate * delta);
    this.material.uniforms.opacity.value = this.opacity;
    this.root.visible = this.opacity > 0.01;
    if (!this.root.visible || !state.tracked) {
      return;
    }
    const matrices = state.matrices;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const bone = this.bones[i];
      if (bone) {
        bone.matrix.fromArray(matrices, i * 16);
        bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
      }
    }
    for (let i = 0; i < 5; i++) {
      const light = this.tipLights[i];
      if (light.visible) {
        const joint = i === 0 ? THUMB_TIP : FINGER_TIPS[i - 1];
        light.position.set(
          matrices[joint * 16 + 12],
          matrices[joint * 16 + 13],
          matrices[joint * 16 + 14],
        );
      }
    }
  }
}
