import {
  CanvasTexture,
  CircleGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';

const FONT =
  "'Inter', 'SF Pro Text', 'Segoe UI', 'Noto Sans', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const COLORS = {
  ink: '#f6efe6',
  soft: 'rgba(246, 239, 230, 0.72)',
  faint: 'rgba(246, 239, 230, 0.5)',
  accent: '#ffcf8a',
  panel: 'rgba(14, 18, 40, 0.78)',
  panelEdge: 'rgba(255, 207, 138, 0.28)',
} as const;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Break text into lines that fit `maxWidth` with the current font. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

export interface PanelContent {
  /** Small label above the title, e.g. "2 of 3". */
  eyebrow?: string;
  title: string;
  body?: string;
  /** Quiet line at the bottom. */
  note?: string;
  /** 0..1 progress bar under the text; omit for none. */
  progress?: number;
  /** Bars for the progress chart, each 0..1, oldest first. */
  chart?: readonly number[];
}

/**
 * The one text surface in the experience: a soft dark card floating just
 * below eye level. All instructions are text, so nothing depends on hearing.
 */
export class TextPanel {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private opacity = 0;
  private target = 0;
  private current: PanelContent = { title: '' };
  private pending: PanelContent | null = null;
  private lastKey = '';

  constructor(
    readonly width = 0.74,
    readonly height = 0.37,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1480;
    this.canvas.height = 740;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(width, height), this.material);
    this.mesh.name = 'text-panel';
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  /** Show new content. If something is already showing, cross-fade to it. */
  set(content: PanelContent): void {
    const key = JSON.stringify(content);
    if (key === this.lastKey) {
      return;
    }
    // A change to only the progress value redraws in place, with no fade.
    const sameText =
      content.title === this.current.title &&
      content.body === this.current.body &&
      content.eyebrow === this.current.eyebrow &&
      content.note === this.current.note;
    this.lastKey = key;
    if (sameText && this.opacity > 0.5 && !this.pending) {
      this.current = content;
      this.draw();
      return;
    }
    if (this.opacity < 0.05) {
      this.current = content;
      this.draw();
      this.pending = null;
    } else {
      this.pending = content;
    }
    this.target = 1;
  }

  /** What the panel is showing, or about to show. */
  get content(): PanelContent {
    return this.pending ?? this.current;
  }

  hide(): void {
    this.target = 0;
    this.pending = null;
    this.lastKey = '';
  }

  update(delta: number): void {
    const goal = this.pending ? 0 : this.target;
    const step = 4 * delta;
    this.opacity += Math.sign(goal - this.opacity) *
      Math.min(Math.abs(goal - this.opacity), step);
    if (this.pending && this.opacity <= 0.02) {
      this.current = this.pending;
      this.pending = null;
      this.draw();
    }
    this.material.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01;
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const c = this.current;
    ctx.clearRect(0, 0, w, h);

    roundedRect(ctx, 6, 6, w - 12, h - 12, 56);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.stroke();

    const pad = 96;
    const inner = w - pad * 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Measure first so the block can be centred vertically.
    ctx.font = `600 84px ${FONT}`;
    const titleLines = wrap(ctx, c.title, inner);
    ctx.font = `400 50px ${FONT}`;
    const bodyLines = c.body ? wrap(ctx, c.body, inner) : [];
    const chartHeight = c.chart ? 190 : 0;
    const blockHeight =
      (c.eyebrow ? 62 : 0) +
      titleLines.length * 96 +
      (bodyLines.length ? 22 + bodyLines.length * 66 : 0) +
      (chartHeight ? chartHeight + 28 : 0) +
      (c.progress !== undefined ? 54 : 0);
    const footer = c.note ? 78 : 0;
    let y = Math.max(70, (h - footer - blockHeight) / 2);

    if (c.eyebrow) {
      ctx.font = `600 36px ${FONT}`;
      ctx.fillStyle = COLORS.accent;
      y += 38;
      ctx.fillText(c.eyebrow.toUpperCase(), w / 2, y);
      y += 24;
    }
    ctx.font = `600 84px ${FONT}`;
    ctx.fillStyle = COLORS.ink;
    for (const line of titleLines) {
      y += 80;
      ctx.fillText(line, w / 2, y);
      y += 16;
    }
    if (bodyLines.length) {
      y += 22;
      ctx.font = `400 50px ${FONT}`;
      ctx.fillStyle = COLORS.soft;
      for (const line of bodyLines) {
        y += 50;
        ctx.fillText(line, w / 2, y);
        y += 16;
      }
    }
    if (c.chart) {
      y += 28;
      this.drawChart(c.chart, pad + 80, y, inner - 160, chartHeight);
      y += chartHeight;
    }
    if (c.progress !== undefined) {
      y += 34;
      const barW = 520;
      const x = (w - barW) / 2;
      roundedRect(ctx, x, y, barW, 14, 7);
      ctx.fillStyle = 'rgba(246, 239, 230, 0.16)';
      ctx.fill();
      const filled = Math.max(14, barW * Math.min(1, Math.max(0, c.progress)));
      roundedRect(ctx, x, y, filled, 14, 7);
      ctx.fillStyle = COLORS.accent;
      ctx.fill();
    }
    if (c.note) {
      ctx.font = `400 34px ${FONT}`;
      ctx.fillStyle = COLORS.faint;
      ctx.fillText(c.note, w / 2, h - 58);
    }
    this.texture.needsUpdate = true;
  }

  private drawChart(
    values: readonly number[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const ctx = this.ctx;
    const count = Math.max(values.length, 7);
    const gap = 14;
    const barW = Math.min(64, (w - gap * (count - 1)) / count);
    const total = barW * values.length + gap * (values.length - 1);
    let bx = x + (w - total) / 2;
    ctx.fillStyle = 'rgba(246, 239, 230, 0.14)';
    ctx.fillRect(x, y + h - 2, w, 2);
    values.forEach((value, index) => {
      const barH = Math.max(6, (h - 8) * Math.min(1, Math.max(0, value)));
      const last = index === values.length - 1;
      roundedRect(ctx, bx, y + h - 2 - barH, barW, barH, Math.min(10, barW / 2));
      ctx.fillStyle = last ? COLORS.accent : 'rgba(255, 207, 138, 0.42)';
      ctx.fill();
      bx += barW + gap;
    });
  }
}

/** Draw a short label onto its own small texture. */
function labelMesh(text: string, width: number): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = `600 58px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(text, 256, 68);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const mesh = new Mesh(
    new PlaneGeometry(width, width / 4),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.renderOrder = 11;
  return mesh;
}

const DWELL_SECONDS = 1.1;
const DWELL_RADIUS = 0.05;
const AIM_SECONDS = 0.3;

/**
 * A big round button. It can be pressed three ways: hold a fingertip on it
 * for about a second (no pinch needed), point a hand ray at it and pinch, or
 * look at it and pinch (gaze, on devices that have it).
 */
export class PadButton {
  readonly group = new Group();
  /** The mesh rays are tested against. */
  readonly hit: Mesh;
  private readonly fill: Mesh;
  private readonly ring: Mesh;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly fillMaterial: MeshBasicMaterial;
  private progress = 0;
  private cooldown = 0;
  private readonly worldPosition = new Vector3();
  hovered = false;
  enabled = true;
  private hoverTime = 0;

  constructor(
    readonly action: string,
    label: string,
    readonly radius = 0.042,
  ) {
    this.group.name = `pad-${action}`;
    this.hit = new Mesh(
      new CircleGeometry(radius, 40),
      new MeshBasicMaterial({
        color: 0x1a2046,
        transparent: true,
        opacity: 0.86,
        toneMapped: false,
      }),
    );
    this.fillMaterial = new MeshBasicMaterial({
      color: 0xffcf8a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    });
    this.fill = new Mesh(new CircleGeometry(radius, 40), this.fillMaterial);
    this.fill.position.z = 0.001;
    this.fill.scale.setScalar(0.001);
    this.ringMaterial = new MeshBasicMaterial({
      color: 0xffcf8a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
    });
    this.ring = new Mesh(
      new RingGeometry(radius * 0.96, radius * 1.06, 48),
      this.ringMaterial,
    );
    this.ring.position.z = 0.002;
    const text = labelMesh(label, radius * 3.4);
    text.position.set(0, -radius * 1.55, 0.002);
    this.group.add(this.hit, this.fill, this.ring, text);
  }

  /**
   * Advance the hold-to-press timer. `fingertip` is a world-space point, or
   * null when no finger is available. Returns true on the frame it fires.
   */
  update(delta: number, fingertip: Vector3 | null): boolean {
    this.cooldown = Math.max(0, this.cooldown - delta);
    let touching = false;
    if (fingertip && this.enabled && this.group.visible && this.cooldown === 0) {
      this.group.getWorldPosition(this.worldPosition);
      touching = this.worldPosition.distanceTo(fingertip) < DWELL_RADIUS;
    }
    if (touching) {
      this.progress = Math.min(1, this.progress + delta / DWELL_SECONDS);
    } else {
      this.progress = Math.max(0, this.progress - delta * 2.5);
    }
    this.fill.scale.setScalar(Math.max(0.001, this.progress));
    this.hoverTime = this.hovered ? this.hoverTime + delta : 0;
    const lift = this.hovered || touching ? 1 : 0.55;
    // There is no gaze cursor on glasses, so the button itself has to show
    // that it is being looked at: it brightens and grows a little.
    const size = this.hovered ? 1.1 : 1;
    this.ring.scale.setScalar(
      this.ring.scale.x + (size - this.ring.scale.x) * Math.min(1, delta * 12),
    );
    this.ringMaterial.opacity += (lift - this.ringMaterial.opacity) *
      Math.min(1, delta * 10);
    if (this.progress >= 1) {
      this.fire();
      return true;
    }
    return false;
  }

  /** Reset after any kind of press so it cannot fire twice in a row. */
  fire(): void {
    this.progress = 0;
    this.cooldown = 1.5;
  }

  get ready(): boolean {
    return this.enabled && this.group.visible && this.cooldown === 0;
  }

  /**
   * A pinch only presses a button that has been looked at (or pointed at)
   * for a moment. The finger-touch activity is full of pinches, and a glance
   * that happens to cross a button must not press it.
   */
  get aimed(): boolean {
    return this.hoverTime >= AIM_SECONDS;
  }
}
