import { LABEL_COLOR } from "./theme.js";

// A clean label renderer: crisp text with a soft dark shadow instead of Sigma's
// default opaque white chip — far less clutter in dense areas.
export function drawNodeLabel(
  context: CanvasRenderingContext2D,
  data: { x: number; y: number; size: number; label?: string | null },
  settings: { labelSize: number; labelFont: string; labelWeight: string },
): void {
  if (!data.label) return;
  context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
  context.fillStyle = LABEL_COLOR;
  context.shadowColor = "rgba(6,10,15,0.95)";
  context.shadowBlur = 4;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.fillText(data.label, data.x + data.size + 4, data.y + settings.labelSize / 3);
  context.shadowBlur = 0;
}
