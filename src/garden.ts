import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';

let glowTexture: CanvasTexture | null = null;

/** A soft round glow, shared by every light in the scene. */
export function getGlowTexture(): CanvasTexture {
  if (glowTexture) {
    return glowTexture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new CanvasTexture(canvas);
  glowTexture.colorSpace = SRGBColorSpace;
  return glowTexture;
}

function glowSprite(color: number, size: number, opacity = 1): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.scale.setScalar(size);
  sprite.renderOrder = 4;
  return sprite;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

function petalGeometry(): BufferGeometry {
  const length = 0.05;
  const geometry = new SphereGeometry(1, 10, 8);
  geometry.scale(0.021, 0.0042, length);
  geometry.translate(0, 0, length);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const along = position.getZ(i) / (length * 2);
    // Taper to a point and curl the tip slightly upward.
    position.setX(i, position.getX(i) * (1 - 0.62 * along * along));
    position.setY(i, position.getY(i) + 0.013 * along * along);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const PETAL_GEOMETRY = petalGeometry();
const RINGS = [
  { count: 8, scale: 1, open: 0.2, closed: 1.42, offset: 0 },
  { count: 8, scale: 0.84, open: 0.62, closed: 1.48, offset: 0.39 },
  { count: 5, scale: 0.62, open: 1.0, closed: 1.52, offset: 0.2 },
] as const;

/** A water lily whose petals follow a hand opening and closing. */
export class Lotus {
  readonly group = new Group();
  private readonly petals: { mesh: Mesh; ring: number }[] = [];
  private readonly petalMaterial: MeshStandardMaterial;
  private readonly heart: Mesh;
  private readonly glow: Sprite;
  private open = 0;
  private pulse = 0;

  constructor(tint = 0xf7c9d8) {
    this.petalMaterial = new MeshStandardMaterial({
      color: tint,
      roughness: 0.55,
      metalness: 0,
      emissive: new Color(tint),
      emissiveIntensity: 0.22,
    });
    RINGS.forEach((ring, ringIndex) => {
      for (let i = 0; i < ring.count; i++) {
        const pivot = new Group();
        pivot.rotation.y = (i / ring.count) * Math.PI * 2 + ring.offset;
        const mesh = new Mesh(PETAL_GEOMETRY, this.petalMaterial);
        mesh.scale.setScalar(ring.scale);
        mesh.position.z = 0.006;
        mesh.rotation.x = -ring.closed;
        pivot.add(mesh);
        this.group.add(pivot);
        this.petals.push({ mesh, ring: ringIndex });
      }
    });
    this.heart = new Mesh(
      new SphereGeometry(0.011, 16, 12),
      new MeshBasicMaterial({ color: 0xffd98a, toneMapped: false }),
    );
    this.heart.position.y = 0.008;
    this.group.add(this.heart);
    this.glow = glowSprite(0xffc58a, 0.12, 0.4);
    this.glow.position.y = 0.02;
    this.group.add(this.glow);

    const pad = new Mesh(
      new CircleGeometry(0.085, 28),
      new MeshStandardMaterial({ color: 0x1f4a3c, roughness: 0.75 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = -0.006;
    this.group.add(pad);
  }

  /** 0 = closed bud, 1 = fully open. */
  setOpen(amount: number): void {
    this.open = clamp01(amount);
  }

  /** A brief brightening, for when a movement is completed. */
  flash(): void {
    this.pulse = 1;
  }

  update(delta: number): void {
    this.pulse = Math.max(0, this.pulse - delta * 1.4);
    const t = smooth(this.open);
    for (const petal of this.petals) {
      const ring = RINGS[petal.ring];
      const target = -(ring.closed + (ring.open - ring.closed) * t);
      petal.mesh.rotation.x += (target - petal.mesh.rotation.x) *
        Math.min(1, delta * 9);
    }
    this.petalMaterial.emissiveIntensity = 0.18 + 0.3 * t + 0.6 * this.pulse;
    const glowSize = 0.1 + 0.2 * t + 0.14 * this.pulse;
    this.glow.scale.setScalar(glowSize);
    (this.glow.material as SpriteMaterial).opacity = 0.25 + 0.5 * t +
      0.25 * this.pulse;
    this.heart.scale.setScalar(0.6 + 0.6 * t);
  }
}

const DIM = new Color(0x4a3a5e);
const WARM = new Color(0xffd08a);

/** A paper lantern that rings when its finger is touched to the thumb. */
export class Lantern {
  readonly group = new Group();
  private readonly body: Mesh;
  private readonly bodyMaterial: MeshBasicMaterial;
  private readonly glow: Sprite;
  private lit = 0;
  private cue = 0;
  private cueTarget = 0;
  private swing = 0;
  private clock = Math.random() * 10;

  constructor(readonly tint: number) {
    this.bodyMaterial = new MeshBasicMaterial({
      color: DIM.clone(),
      toneMapped: false,
    });
    this.body = new Mesh(new SphereGeometry(1, 20, 16), this.bodyMaterial);
    this.body.scale.set(0.026, 0.034, 0.026);
    const cap = new Mesh(
      new CylinderGeometry(0.012, 0.012, 0.006, 16),
      new MeshBasicMaterial({ color: 0x2a2238, toneMapped: false }),
    );
    cap.position.y = 0.035;
    const base = cap.clone();
    base.position.y = -0.035;
    this.glow = glowSprite(tint, 0.14, 0);
    this.group.add(this.body, cap, base, this.glow);
  }

  /** Mark this lantern as the one to ring next. */
  setCue(on: boolean): void {
    this.cueTarget = on ? 1 : 0;
  }

  /** Ring it. */
  ring(): void {
    this.lit = 1;
    this.swing = 1;
  }

  update(delta: number): void {
    this.clock += delta;
    this.lit = Math.max(0, this.lit - delta * 0.55);
    this.cue += (this.cueTarget - this.cue) * Math.min(1, delta * 6);
    this.swing = Math.max(0, this.swing - delta * 0.8);
    const breathing = 0.5 + 0.5 * Math.sin(this.clock * 2.6);
    const level = Math.max(this.lit, this.cue * (0.3 + 0.25 * breathing));
    this.bodyMaterial.color.copy(DIM).lerp(WARM, clamp01(level * 1.1));
    (this.glow.material as SpriteMaterial).opacity = 0.9 * level;
    this.glow.scale.setScalar(0.12 + 0.16 * level);
    this.group.rotation.z = Math.sin(this.clock * 5) * 0.12 * this.swing;
  }
}

/** A point of light to reach for. */
export class Firefly {
  readonly group = new Group();
  private readonly glow: Sprite;
  private readonly core: Mesh;
  private clock = Math.random() * 10;
  private level = 0;
  private target = 0;
  /** 0..1: how nearly it has been caught. Makes it swell. */
  charge = 0;

  constructor(color = 0xd6ff9a) {
    this.core = new Mesh(
      new SphereGeometry(0.0075, 12, 10),
      new MeshBasicMaterial({
        color: 0xffffe0,
        transparent: true,
        toneMapped: false,
      }),
    );
    this.glow = glowSprite(color, 0.11, 0);
    this.group.add(this.glow, this.core);
    this.group.visible = false;
  }

  show(visible: boolean): void {
    this.target = visible ? 1 : 0;
  }

  get visible(): boolean {
    return this.level > 0.02;
  }

  update(delta: number): void {
    this.clock += delta;
    this.level += (this.target - this.level) * Math.min(1, delta * 5);
    this.group.visible = this.level > 0.02;
    const flicker = 0.85 + 0.15 * Math.sin(this.clock * 7.3);
    const size = (0.1 + 0.1 * this.charge) * flicker;
    this.glow.scale.setScalar(size);
    (this.glow.material as SpriteMaterial).opacity = this.level *
      (0.7 + 0.3 * this.charge);
    (this.core.material as MeshBasicMaterial).opacity = this.level;
    this.core.scale.setScalar(1 + this.charge);
  }
}

/** Deterministic pseudo-random numbers, so the sky is the same every time. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * The setting: a still pond at night, with a round stone basin in front of
 * the seat that the activities happen on. Built once, in seat space.
 */
export class Garden {
  readonly group = new Group();
  /** The basin is positioned from the seat height after calibration. */
  readonly basin = new Group();
  private readonly motes: Points;
  private readonly moteBase: Float32Array;
  private clock = 0;

  constructor() {
    this.group.name = 'garden';
    const random = seeded(7);

    // Far ground: dark water that fades into the horizon colour, so there is
    // no hard edge where the water meets the sky.
    const ground = new Mesh(
      new CircleGeometry(90, 64),
      new ShaderMaterial({
        uniforms: {
          nearColor: { value: new Color(0x070c1c) },
          farColor: { value: new Color().setRGB(0.3, 0.2, 0.34, SRGBColorSpace) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vPlane;
          void main() {
            vPlane = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 nearColor;
          uniform vec3 farColor;
          varying vec2 vPlane;
          void main() {
            float d = length(vPlane);
            // Mist over the water: thickens with distance like fog.
            float t = 1.0 - exp(-max(d - 1.0, 0.0) / 11.0);
            gl_FragColor = vec4(mix(nearColor, farColor, t), 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.002;
    this.group.add(ground);

    // The basin: a shallow bowl of water at about chest height.
    const water = new Mesh(
      new CircleGeometry(0.46, 56),
      new MeshStandardMaterial({
        color: 0x101c3a,
        roughness: 0.18,
        metalness: 0.2,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    const rim = new Mesh(
      new RingGeometry(0.455, 0.5, 64),
      new MeshStandardMaterial({ color: 0x5a5470, roughness: 0.9 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.004;
    const pedestal = new Mesh(
      new CylinderGeometry(0.5, 0.36, 1, 48, 1, true),
      new MeshStandardMaterial({ color: 0x2c2940, roughness: 0.95 }),
    );
    pedestal.position.y = -0.5;
    this.basin.add(water, rim, pedestal);
    this.group.add(this.basin);

    // Moon, low enough to sit inside a narrow field of view.
    const moon = new Mesh(
      new CircleGeometry(1.5, 40),
      new MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false, fog: false }),
    );
    moon.position.set(-9, 8.4, -38);
    moon.lookAt(0, 1.2, 0);
    const halo = glowSprite(0xffe2b8, 16, 0.32);
    halo.position.copy(moon.position);
    this.group.add(moon, halo);

    // Stars.
    const starCount = 420;
    const stars = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const azimuth = random() * Math.PI * 2;
      const elevation = 0.06 + random() * 1.4;
      const radius = 80;
      stars[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius;
      stars[i * 3 + 1] = Math.sin(elevation) * radius;
      stars[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius;
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new BufferAttribute(stars, 3));
    const starField = new Points(
      starGeometry,
      new PointsMaterial({
        color: 0xdfe6ff,
        size: 1.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    starField.frustumCulled = false;
    this.group.add(starField);

    // Distant drifting lights over the water.
    const moteCount = 70;
    this.moteBase = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      const azimuth = random() * Math.PI * 2;
      const radius = 2.2 + random() * 9;
      this.moteBase[i * 3] = Math.cos(azimuth) * radius;
      this.moteBase[i * 3 + 1] = 0.25 + random() * 1.9;
      this.moteBase[i * 3 + 2] = Math.sin(azimuth) * radius;
    }
    const moteGeometry = new BufferGeometry();
    moteGeometry.setAttribute(
      'position',
      new BufferAttribute(this.moteBase.slice(), 3),
    );
    this.motes = new Points(
      moteGeometry,
      new PointsMaterial({
        map: getGlowTexture(),
        color: 0xffe0a0,
        size: 0.09,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  /** Put the basin at the right height and distance for this seat. */
  place(workY: number): void {
    this.basin.position.set(0, workY - 0.13, -0.48);
  }

  update(delta: number): void {
    this.clock += delta;
    const position = this.motes.geometry.attributes.position;
    const t = this.clock;
    for (let i = 0; i < position.count; i++) {
      const phase = i * 1.7;
      position.setXYZ(
        i,
        this.moteBase[i * 3] + Math.sin(t * 0.21 + phase) * 0.35,
        this.moteBase[i * 3 + 1] + Math.sin(t * 0.33 + phase * 1.3) * 0.18,
        this.moteBase[i * 3 + 2] + Math.cos(t * 0.17 + phase) * 0.35,
      );
    }
    position.needsUpdate = true;
  }
}
