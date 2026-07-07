import type Sigma from "sigma";

// Thin, renderer-agnostic camera API. Everything that moves the view (toolbar,
// search, double-click, minimap) goes through here rather than poking Sigma's
// camera directly — one place owns navigation.

export class CameraControls {
  constructor(private sigma: Sigma) {}

  /** Frame the whole graph. */
  fit(duration = 500): void {
    this.sigma.getCamera().animatedReset({ duration });
  }

  /** Smoothly center and zoom onto a node. */
  focus(nodeId: string, ratio = 0.28, duration = 600): void {
    const display = this.sigma.getNodeDisplayData(nodeId);
    if (!display) return;
    this.sigma.getCamera().animate({ x: display.x, y: display.y, ratio }, { duration });
  }

  zoomIn(): void {
    this.sigma.getCamera().animatedZoom({ duration: 200 });
  }

  zoomOut(): void {
    this.sigma.getCamera().animatedUnzoom({ duration: 200 });
  }

  /** Move the camera to a framed-coordinate position (used by the minimap). */
  moveTo(x: number, y: number, duration = 250): void {
    this.sigma.getCamera().animate({ x, y }, { duration });
  }
}
