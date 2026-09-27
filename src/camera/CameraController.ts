import { MediaPipeFaceProvider } from "../tracking/MediaPipeFaceProvider";

interface FrameCallbackApi {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export interface CameraStats {
  captureFps: number;
  width: number;
  height: number;
}

export class CameraController {
  private stream: MediaStream | null = null;
  private running = false;
  private callbackHandle = 0;
  private fallbackHandle = 0;
  private captureTimes: number[] = [];
  private lastSubmitMs = 0;
  private targetInferenceFps = 30;
  private stats: CameraStats = { captureFps: 0, width: 0, height: 0 };

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly provider: MediaPipeFaceProvider
  ) {}

  async start(deviceId?: string): Promise<MediaStream> {
    this.stopTracks();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: "user"
      },
      audio: false
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.running = true;
    this.stats.width = this.video.videoWidth;
    this.stats.height = this.video.videoHeight;
    this.schedule();
    return stream;
  }

  stop(): void {
    this.running = false;
    const frameApi = this.video as unknown as FrameCallbackApi;
    if (frameApi.cancelVideoFrameCallback && this.callbackHandle) frameApi.cancelVideoFrameCallback(this.callbackHandle);
    if (this.fallbackHandle) cancelAnimationFrame(this.fallbackHandle);
    this.stopTracks();
    this.video.srcObject = null;
    this.captureTimes = [];
    this.stats.captureFps = 0;
  }

  getStats(): CameraStats {
    return { ...this.stats };
  }

  setTargetInferenceFps(fps: number): void {
    this.targetInferenceFps = Math.max(5, Math.min(60, fps));
  }

  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private schedule(): void {
    if (!this.running) return;
    const onFrame = async (now: number): Promise<void> => {
      if (!this.running) return;
      this.captureTimes.push(now);
      while (this.captureTimes.length > 1 && now - this.captureTimes[0] > 1000) this.captureTimes.shift();
      this.stats.captureFps = this.captureTimes.length;
      this.stats.width = this.video.videoWidth;
      this.stats.height = this.video.videoHeight;
      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - this.lastSubmitMs >= 1000 / this.targetInferenceFps) {
        try {
          const bitmap = await createImageBitmap(this.video);
          if (this.provider.submit(bitmap, now)) this.lastSubmitMs = now;
        } catch {
          // A device switch can invalidate one frame. The next callback resumes capture.
        }
      }
      this.schedule();
    };

    const frameApi = this.video as unknown as FrameCallbackApi;
    if (frameApi.requestVideoFrameCallback) {
      this.callbackHandle = frameApi.requestVideoFrameCallback((now) => { void onFrame(now); });
    } else {
      this.fallbackHandle = requestAnimationFrame((now) => { void onFrame(now); });
    }
  }
}
