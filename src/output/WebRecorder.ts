export class WebRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  start(canvas: HTMLCanvasElement, fps = 60): void {
    if (this.recording) return;
    const stream = canvas.captureStream(fps);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(1000);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        reject(new Error("当前没有正在录制的舞台。"));
        return;
      }
      const recorder = this.recorder;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" });
        recorder.stream.getTracks().forEach((track) => track.stop());
        this.recorder = null;
        resolve(blob);
      };
      recorder.stop();
    });
  }
}
