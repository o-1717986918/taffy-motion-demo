import type { AvatarFrame, TrackingFrame } from "./contracts";

type Listener = (raw: TrackingFrame, avatar: AvatarFrame) => void;

export class MotionBus {
  private listeners = new Set<Listener>();
  private raw: TrackingFrame | null = null;
  private avatar: AvatarFrame | null = null;

  publish(raw: TrackingFrame, avatar: AvatarFrame): void {
    this.raw = raw;
    this.avatar = avatar;
    for (const listener of this.listeners) listener(raw, avatar);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.raw && this.avatar) listener(this.raw, this.avatar);
    return () => this.listeners.delete(listener);
  }

  latest(): { raw: TrackingFrame | null; avatar: AvatarFrame | null } {
    return { raw: this.raw, avatar: this.avatar };
  }
}
