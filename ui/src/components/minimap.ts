import type { Renderer } from "../render/renderer.js";
import type { CameraControls } from "../camera/controls.js";

// A lightweight 2D-canvas minimap (the overview is cheap to redraw and never
// touches the WebGL scene). Shows every node plus the current viewport rectangle;
// clicking recenters the camera on the nearest node.

interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private bounds: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  constructor(private canvas: HTMLCanvasElement, private renderer: Renderer, private camera: CameraControls) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    this.computeBounds();
    this.renderer.sigma.getCamera().on("updated", () => this.draw());
    window.addEventListener("resize", () => { this.resize(); this.draw(); });
    this.canvas.addEventListener("click", (e) => this.onClick(e));
    this.draw();
  }

  redraw(): void {
    this.computeBounds();
    this.draw();
  }

  private resize(): void {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
  }

  private computeBounds(): void {
    const g = this.renderer.graph;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    g.forEachNode((_, a) => {
      minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
    });
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
    const padX = (maxX - minX) * 0.05 || 1;
    const padY = (maxY - minY) * 0.05 || 1;
    this.bounds = { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
  }

  private toMini(x: number, y: number): [number, number] {
    const { minX, minY, maxX, maxY } = this.bounds;
    const mx = ((x - minX) / (maxX - minX)) * this.canvas.width;
    const my = (1 - (y - minY) / (maxY - minY)) * this.canvas.height; // flip Y
    return [mx, my];
  }

  private draw(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const g = this.renderer.graph;
    g.forEachNode((_, a) => {
      const [x, y] = this.toMini(a.x, a.y);
      ctx.fillStyle = (a.color as string) ?? "#8b949e";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    this.drawViewport();
  }

  private drawViewport(): void {
    const s = this.renderer.sigma;
    const { width, height } = s.getDimensions();
    const tl = s.viewportToGraph({ x: 0, y: 0 });
    const br = s.viewportToGraph({ x: width, y: height });
    const [x1, y1] = this.toMini(tl.x, tl.y);
    const [x2, y2] = this.toMini(br.x, br.y);
    this.ctx.strokeStyle = "#58a6ff";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { minX, minY, maxX, maxY } = this.bounds;
    const gx = minX + (mx / this.canvas.width) * (maxX - minX);
    const gy = minY + (1 - my / this.canvas.height) * (maxY - minY);
    // Recenter on the nearest node (robust; reuses the camera focus path).
    let best: string | null = null;
    let bestD = Infinity;
    this.renderer.graph.forEachNode((id, a) => {
      const d = (a.x - gx) ** 2 + (a.y - gy) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    });
    if (best) this.camera.focus(best, 0.5);
  }
}
