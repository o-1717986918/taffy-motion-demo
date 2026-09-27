import type { VoiceStartOptions } from "./voice/VoiceChangerController";

export {};

declare global {
  interface Window {
    taffyDesktop?: Readonly<{
      isDesktop: true;
      platform: string;
      loadVoiceSettings: () => Promise<Partial<VoiceStartOptions> | null>;
      saveVoiceSettings: (settings: VoiceStartOptions) => Promise<Partial<VoiceStartOptions>>;
    }>;
  }
}
