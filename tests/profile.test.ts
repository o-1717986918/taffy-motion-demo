import { describe, expect, it } from "vitest";
import { boneAliases, morphAliases, resolveAliases } from "../src/profiles/taffy-1883";

describe("model profile alias matching", () => {
  it("matches Japanese Taffy bones and morphs by semantic name", () => {
    const bones = resolveAliases(["センター", "首", "頭", "左目", "右目"], boneAliases);
    const morphs = resolveAliases(["まばたき", "あ", "にやり", "困る"], morphAliases);
    expect(bones.head).toBe("頭");
    expect(bones.neck).toBe("首");
    expect(morphs.blinkBoth).toBe("まばたき");
    expect(morphs.mouthA).toBe("あ");
    expect(morphs.sad).toBe("困る");
  });

  it("returns null when a capability is unavailable", () => {
    const bones = resolveAliases(["center"], boneAliases);
    expect(bones.head).toBeNull();
  });
});
