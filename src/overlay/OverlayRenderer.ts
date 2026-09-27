import { FaceLandmarker, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { AvatarFrame, TrackingFrame } from "../core/contracts";

export interface OverlayOptions {
  enabled: boolean;
  mesh: boolean;
  contours: boolean;
  points: boolean;
  bounds: boolean;
  axes: boolean;
  pose: boolean;
  hands: boolean;
  mirrored: boolean;
}

type Connector = { start: number; end: number };

const featureConnectors: Connector[] = [
  ...FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  ...FaceLandmarker.FACE_LANDMARKS_LIPS,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS
];

const upperBodyLandmarks = new Set([11, 12, 13, 14, 15, 16, 23, 24]);
const upperBodyConnectors = PoseLandmarker.POSE_CONNECTIONS.filter(
  (connector) => upperBodyLandmarks.has(connector.start) && upperBodyLandmarks.has(connector.end)
);

export class OverlayRenderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建覆盖层画布。 ");
    this.context = context;
  }

  draw(frame: TrackingFrame, avatar: AvatarFrame, options: OverlayOptions): void {
    this.resize();
    const { context, canvas } = this;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!options.enabled) return;
    const facePoints = frame.face.landmarks;
    const posePoints = frame.pose?.landmarks;
    const hands = frame.hands ?? [];
    const hasFace = frame.face.present && Boolean(facePoints?.length);
    // Draw partial landmarks too: this makes camera framing/occlusion visible
    // instead of hiding all pose feedback until the lock threshold is reached.
    const hasPose = options.pose && Boolean(posePoints?.length);
    const hasHands = options.hands && hands.length > 0;
    if (!hasFace && !hasPose && !hasHands) return;
    const transform = this.getTransform(options.mirrored);

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    if (hasFace && facePoints) {
      const point = (index: number): [number, number] => transform(facePoints[index * 3], facePoints[index * 3 + 1]);
      if (options.mesh) this.drawConnectors(FaceLandmarker.FACE_LANDMARKS_TESSELATION, point, "rgba(82, 228, 210, 0.16)", 0.65);
      if (options.contours) {
        this.drawConnectors(featureConnectors, point, "rgba(124, 245, 231, 0.88)", 1.35);
        this.drawConnectors(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, point, "rgba(255, 107, 107, 0.9)", 1.8);
      }
      if (options.points) {
        context.fillStyle = "rgba(237, 248, 246, 0.82)";
        for (let index = 0; index < facePoints.length / 3; index += 4) {
          const [x, y] = point(index);
          context.beginPath();
          context.arc(x, y, 1.2 * devicePixelRatio, 0, Math.PI * 2);
          context.fill();
        }
      }

      const all = Array.from({ length: facePoints.length / 3 }, (_, index) => point(index));
      const xs = all.map(([x]) => x);
      const ys = all.map(([, y]) => y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      if (options.bounds) {
        context.strokeStyle = "rgba(255, 199, 107, 0.9)";
        context.lineWidth = 1.2 * devicePixelRatio;
        context.setLineDash([5 * devicePixelRatio, 5 * devicePixelRatio]);
        context.strokeRect(minX, minY, maxX - minX, maxY - minY);
        context.setLineDash([]);
      }
      if (options.axes) this.drawAxes(point(1), avatar);
      this.drawConfidence(minX, minY, frame.face.confidence, "FACE");
    }

    if (hasPose && posePoints) {
      const posePoint = (index: number): [number, number] => transform(posePoints[index * 4], posePoints[index * 4 + 1]);
      context.beginPath();
      for (const connector of upperBodyConnectors) {
        const startVisibility = posePoints[connector.start * 4 + 3] ?? 0;
        const endVisibility = posePoints[connector.end * 4 + 3] ?? 0;
        if (Math.min(startVisibility, endVisibility) < 0.18) continue;
        const [x1, y1] = posePoint(connector.start);
        const [x2, y2] = posePoint(connector.end);
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
      }
      context.strokeStyle = "rgba(255, 199, 107, 0.92)";
      context.lineWidth = 2.2 * devicePixelRatio;
      context.stroke();
      context.fillStyle = "rgba(124, 245, 231, 0.95)";
      for (const index of upperBodyLandmarks) {
        if ((posePoints[index * 4 + 3] ?? 0) < 0.28) continue;
        const [x, y] = posePoint(index);
        context.beginPath();
        context.arc(x, y, 2.5 * devicePixelRatio, 0, Math.PI * 2);
        context.fill();
      }
      const labelIndex = (posePoints[11 * 4 + 3] ?? 0) >= 0.18 ? 11 : 12;
      const [labelX, labelY] = posePoint(labelIndex);
      this.drawConfidence(labelX, labelY, frame.pose?.confidence ?? 0, "POSE");
    }
    if (hasHands) {
      for (const hand of hands) {
        const values = hand.landmarks;
        if (values.length < 21 * 4) continue;
        const point = (index: number): [number, number] => transform(values[index * 4], values[index * 4 + 1]);
        this.drawConnectors(HandLandmarker.HAND_CONNECTIONS, point, "rgba(240, 116, 170, 0.92)", 1.8);
        this.context.fillStyle = "rgba(255, 226, 239, 0.98)";
        for (let index = 0; index < 21; index += 1) {
          const [x, y] = point(index);
          this.context.beginPath();
          this.context.arc(x, y, 2.1 * devicePixelRatio, 0, Math.PI * 2);
          this.context.fill();
        }
        const semanticSide = options.mirrored
          ? (hand.handedness === "Left" ? "Right" : "Left")
          : hand.handedness;
        const semantic = semanticSide === "Left" ? avatar.hands.left : avatar.hands.right;
        const [x, y] = point(0);
        this.drawConfidence(x, y, hand.confidence, `HAND ${hand.handedness[0]} · ${semantic.gesture.toUpperCase()}`);
      }
    }
    context.restore();
  }

  clear(): void {
    this.resize();
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawConnectors(
    connectors: Connector[],
    point: (index: number) => [number, number],
    color: string,
    width: number
  ): void {
    this.context.beginPath();
    for (const connector of connectors) {
      const [x1, y1] = point(connector.start);
      const [x2, y2] = point(connector.end);
      this.context.moveTo(x1, y1);
      this.context.lineTo(x2, y2);
    }
    this.context.strokeStyle = color;
    this.context.lineWidth = width * devicePixelRatio;
    this.context.stroke();
  }

  private drawAxes([x, y]: [number, number], avatar: AvatarFrame): void {
    const length = 45 * devicePixelRatio;
    const { yaw, pitch, roll } = avatar.headEuler;
    const cos = Math.cos(roll);
    const sin = Math.sin(roll);
    const axes: Array<{ color: string; dx: number; dy: number }> = [
      { color: "#ff6b6b", dx: cos * length, dy: sin * length },
      { color: "#52e4d2", dx: -sin * length, dy: cos * length },
      { color: "#ffc76b", dx: yaw * length * 1.5, dy: pitch * length * 1.5 }
    ];
    this.context.lineWidth = 2.1 * devicePixelRatio;
    for (const axis of axes) {
      this.context.beginPath();
      this.context.moveTo(x, y);
      this.context.lineTo(x + axis.dx, y + axis.dy);
      this.context.strokeStyle = axis.color;
      this.context.stroke();
    }
  }

  private drawConfidence(x: number, y: number, confidence: number, kind: string): void {
    const dpr = devicePixelRatio;
    const label = `${kind}  ${(confidence * 100).toFixed(0)}%`;
    this.context.font = `${10 * dpr}px Cascadia Code, monospace`;
    const width = this.context.measureText(label).width + 14 * dpr;
    this.context.fillStyle = "rgba(7, 19, 24, 0.82)";
    this.context.fillRect(x, Math.max(0, y - 25 * dpr), width, 20 * dpr);
    this.context.fillStyle = "#7cf5e7";
    this.context.fillText(label, x + 7 * dpr, Math.max(14 * dpr, y - 11 * dpr));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    const height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private getTransform(mirrored: boolean): (x: number, y: number) => [number, number] {
    const displayWidth = this.canvas.width;
    const displayHeight = this.canvas.height;
    const videoWidth = this.video.videoWidth || 1280;
    const videoHeight = this.video.videoHeight || 720;
    const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const cropX = (renderedWidth - displayWidth) / 2;
    const cropY = (renderedHeight - displayHeight) / 2;
    return (x, y) => {
      const px = x * renderedWidth - cropX;
      return [mirrored ? displayWidth - px : px, y * renderedHeight - cropY];
    };
  }
}
