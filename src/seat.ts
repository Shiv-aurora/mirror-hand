import { Euler, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/**
 * The "seat frame": a coordinate frame fixed to where the person is sitting.
 * Origin is on the floor under the head (or a seated height below it when the
 * browser has no floor), -Z is the way they were facing when
 * calibrated, +X is their right. The mirror plane is X = 0 in this frame — the
 * body's midline — and it stays put when the head turns.
 */
export class Seat {
  readonly matrix = new Matrix4();
  readonly inverse = new Matrix4();
  /** Reflection across the midline, expressed in player (XR origin) space. */
  readonly mirror = new Matrix4();
  headY = 1.18;
  calibrated = false;

  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly quat = new Quaternion();
  private readonly pos = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly flipX = new Matrix4().makeScale(-1, 1, 1);

  /** Head pose is given in player space. */
  calibrate(headPosition: Vector3, headQuaternion: Quaternion): void {
    this.euler.setFromQuaternion(headQuaternion, 'YXZ');
    const yaw = this.euler.y;
    this.euler.set(0, yaw, 0, 'YXZ');
    this.quat.setFromEuler(this.euler);
    // With a floor-level reference space the head is about a metre up. If
    // the browser could only give a head-level space, the head reads near
    // zero; then put our own floor a seated height below it.
    const floor = headPosition.y < 0.3 ? headPosition.y - 1.18 : 0;
    this.pos.set(headPosition.x, floor, headPosition.z);
    this.matrix.compose(this.pos, this.quat, this.one);
    this.inverse.copy(this.matrix).invert();
    this.mirror.copy(this.matrix).multiply(this.flipX).multiply(this.inverse);
    // Seated eye height is usually 1.05–1.3 m; clamp so a standing or
    // lying-down start still gives a usable layout.
    this.headY = Math.min(1.75, Math.max(0.85, headPosition.y - floor));
    this.calibrated = true;
  }

  /** Height of the activity zone: roughly chest height when seated. */
  get workY(): number {
    return this.headY - 0.3;
  }
}
