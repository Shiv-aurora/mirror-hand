import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { JOINT_COUNT, type HandState } from './hand-tracking.js';

/** Joint pairs that make the hand's skeleton: palm fan, thumb, four fingers. */
const BONES: [number, number][] = [
  [0, 1], [0, 5], [0, 10], [0, 15], [0, 20],
  [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8], [8, 9],
  [10, 11], [11, 12], [12, 13], [13, 14],
  [15, 16], [16, 17], [17, 18], [18, 19],
  [20, 21], [21, 22], [22, 23], [23, 24],
];
/** Joints joined to their reflection by a line: the wrist and the five tips. */
const LINKS = [0, 4, 9, 14, 19, 24];
const TIPS = new Set([4, 9, 14, 19, 24]);

const PLANE_DEPTH = 0.5;
const PLANE_HEIGHT = 0.3;

const overlayMaterial = (color: number): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

/**
 * Demo view only (switched on through the debug hook, never by the app): a
 * picture of how the mirror works. It draws the tracked joints of the leading
 * hand, the mirror plane through the middle of the body, and each joint's
 * reflection on the other side. Everything is in seat space, where the mirror
 * plane is X = 0.
 */
export class ExplainOverlay {
  readonly group = new Group();
  /** 0 off, 1 the tracked joints, 2 and the plane, 3 and the reflection. */
  private level = 0;
  private leadShown = 0;
  private planeShown = 0;
  private mirrorShown = 0;
  private clock = 0;

  private readonly leadMaterial = overlayMaterial(0xffcf8a);
  private readonly mirrorMaterial = overlayMaterial(0x8ff2dc);
  private readonly linkMaterial = overlayMaterial(0xffffff);
  private readonly pulseMaterial = overlayMaterial(0xffffff);
  private readonly sheetMaterial = new MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly edgeMaterial = new MeshBasicMaterial({
    color: 0xffe2b0,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  private readonly leadJoints: InstancedMesh;
  private readonly leadBones: InstancedMesh;
  private readonly mirrorJoints: InstancedMesh;
  private readonly mirrorBones: InstancedMesh;
  private readonly links: InstancedMesh;
  private readonly pulses: InstancedMesh;
  private readonly plane = new Group();

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly direction = new Vector3();
  private readonly scale = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly identity = new Quaternion();
  private readonly alongX = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 2,
  );
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'explain';
    this.group.visible = false;

    const dot = new SphereGeometry(0.0042, 12, 8);
    const bone = new CylinderGeometry(0.0014, 0.0014, 1, 6);
    const link = new CylinderGeometry(0.0008, 0.0008, 1, 6);
    const pulse = new SphereGeometry(0.0034, 10, 8);

    this.leadJoints = new InstancedMesh(dot, this.leadMaterial, JOINT_COUNT);
    this.leadBones = new InstancedMesh(bone, this.leadMaterial, BONES.length);
    this.mirrorJoints = new InstancedMesh(dot, this.mirrorMaterial, JOINT_COUNT);
    this.mirrorBones = new InstancedMesh(bone, this.mirrorMaterial, BONES.length);
    this.links = new InstancedMesh(link, this.linkMaterial, LINKS.length);
    this.pulses = new InstancedMesh(pulse, this.pulseMaterial, LINKS.length);
    for (const mesh of [
      this.leadJoints,
      this.leadBones,
      this.mirrorJoints,
      this.mirrorBones,
      this.links,
      this.pulses,
    ]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
    }

    // The mirror plane: a faint sheet standing on the body's midline, with a
    // brighter frame so its shape reads from the side.
    const sheet = new Mesh(
      new PlaneGeometry(PLANE_DEPTH, PLANE_HEIGHT),
      this.sheetMaterial,
    );
    sheet.rotation.y = Math.PI / 2;
    sheet.renderOrder = 3;
    this.plane.add(sheet);
    const bar = 0.0022;
    const rails: [number, number, number, number][] = [
      // depth, height, y, z of each side of the frame
      [PLANE_DEPTH, bar, PLANE_HEIGHT / 2, 0],
      [PLANE_DEPTH, bar, -PLANE_HEIGHT / 2, 0],
      [bar, PLANE_HEIGHT, 0, PLANE_DEPTH / 2],
      [bar, PLANE_HEIGHT, 0, -PLANE_DEPTH / 2],
    ];
    for (const [depth, height, y, z] of rails) {
      const rail = new Mesh(new BoxGeometry(bar, height, depth), this.edgeMaterial);
      rail.position.set(0, y, z);
      rail.renderOrder = 3;
      this.plane.add(rail);
    }
    this.group.add(this.plane);
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(3, Math.round(level)));
  }

  /** Stand the plane on the work area for the current seat. */
  place(workY: number): void {
    this.plane.position.set(0, workY - 0.02 + PLANE_HEIGHT / 2, -0.43);
  }

  /**
   * @param lead The hand that is really moving (seat space).
   * @param reflected Its mirror image on the other side.
   * @param mirroring False whenever the app's mirror is off; then nothing shows.
   */
  update(
    lead: HandState,
    reflected: HandState,
    mirroring: boolean,
    dt: number,
  ): void {
    const on = mirroring && lead.tracked ? this.level : 0;
    const ease = Math.min(1, dt * 4);
    this.leadShown += ((on >= 1 ? 1 : 0) - this.leadShown) * ease;
    this.planeShown += ((on >= 2 ? 1 : 0) - this.planeShown) * ease;
    this.mirrorShown += ((on >= 3 ? 1 : 0) - this.mirrorShown) * ease;
    const visible = this.leadShown + this.planeShown + this.mirrorShown > 0.01;
    this.group.visible = visible;
    if (!visible) {
      return;
    }
    this.clock += dt;

    this.leadMaterial.opacity = 0.95 * this.leadShown;
    this.mirrorMaterial.opacity = 0.9 * this.mirrorShown;
    this.linkMaterial.opacity = 0.34 * this.mirrorShown;
    this.pulseMaterial.opacity = 0.95 * this.mirrorShown;
    this.sheetMaterial.opacity = 0.085 * this.planeShown;
    this.edgeMaterial.opacity = 0.6 * this.planeShown;

    this.skeleton(lead, this.leadJoints, this.leadBones);
    this.skeleton(reflected, this.mirrorJoints, this.mirrorBones);

    for (let i = 0; i < LINKS.length; i++) {
      const point = lead.points[LINKS[i]];
      // The line runs straight across the plane: same height and depth, the
      // side swapped.
      this.position.set(0, point.y, point.z);
      this.scale.set(1, Math.abs(point.x) * 2, 1);
      this.matrix.compose(this.position, this.alongX, this.scale);
      this.links.setMatrixAt(i, this.matrix);
      // A bead travels from the real joint to its reflection, over and over.
      const phase = (this.clock * 0.85 + i * 0.17) % 1;
      const travel = phase * phase * (3 - 2 * phase);
      this.position.set(point.x * (1 - 2 * travel), point.y, point.z);
      const swell = Math.sin(Math.PI * phase);
      this.scale.setScalar(0.4 + 0.6 * swell);
      this.matrix.compose(this.position, this.identity, this.scale);
      this.pulses.setMatrixAt(i, this.matrix);
    }
    this.links.instanceMatrix.needsUpdate = true;
    this.pulses.instanceMatrix.needsUpdate = true;
  }

  private skeleton(
    hand: HandState,
    joints: InstancedMesh,
    bones: InstancedMesh,
  ): void {
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.scale.setScalar(TIPS.has(i) ? 1.35 : 1);
      this.matrix.compose(hand.points[i], this.identity, this.scale);
      joints.setMatrixAt(i, this.matrix);
    }
    for (let i = 0; i < BONES.length; i++) {
      const from = hand.points[BONES[i][0]];
      const to = hand.points[BONES[i][1]];
      this.direction.copy(to).sub(from);
      const length = this.direction.length();
      if (length > 1e-5) {
        this.quaternion.setFromUnitVectors(
          this.up,
          this.direction.multiplyScalar(1 / length),
        );
      }
      this.position.copy(from).add(to).multiplyScalar(0.5);
      this.scale.set(1, length, 1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      bones.setMatrixAt(i, this.matrix);
    }
    joints.instanceMatrix.needsUpdate = true;
    bones.instanceMatrix.needsUpdate = true;
  }
}
