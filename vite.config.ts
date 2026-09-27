import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Connect, Plugin } from "vite";

const preparedModelDirectory = resolve(process.env.TAFFY_VOICE_MODEL_DIR ?? resolve(import.meta.dirname, "local-models"));
const preparedModelManifest = resolve(preparedModelDirectory, "manifest.json");
const vcProxy = {
  "/__vcclient_proxy": {
    target: "http://127.0.0.1:18888",
    changeOrigin: false,
    rewrite: (path: string) => path.replace(/^\/__vcclient_proxy/, "")
  }
};

function localVoiceModelPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    const url = request.url?.split("?", 1)[0];
    if (!url?.startsWith("/__taffy_voice_model/")) return next();
    if (!existsSync(preparedModelManifest)) {
      response.statusCode = 404;
      response.end("Prepared voice model is not installed.");
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (url === "/__taffy_voice_model/manifest") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(readFileSync(preparedModelManifest));
      return;
    }

    const manifest = JSON.parse(readFileSync(preparedModelManifest, "utf8")) as {
      model?: { name?: string };
      index?: { name?: string };
    };
    const fileName = url === "/__taffy_voice_model/model"
      ? manifest.model?.name
      : url === "/__taffy_voice_model/index"
        ? manifest.index?.name
        : undefined;
    if (!fileName || !/^[\w.-]+$/.test(fileName)) {
      response.statusCode = 404;
      response.end("Unknown local voice model asset.");
      return;
    }
    const filePath = resolve(preparedModelDirectory, fileName);
    if (!existsSync(filePath)) {
      response.statusCode = 404;
      response.end("Local voice model asset is missing.");
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Length", String(statSync(filePath).size));
    createReadStream(filePath).pipe(response);
  };

  return {
    name: "taffy-local-voice-model",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

function localVoiceRuntimePlugin(): Plugin {
  const launcher = resolve(import.meta.dirname, "scripts", "start-taffy-voice.ps1");
  let startInFlight: Promise<string> | null = null;
  const launch = () => new Promise<string>((done, fail) => {
    const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(executable, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher, "-NoBrowser"], {
      cwd: import.meta.dirname,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const append = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-16_000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error("本机启动器在 180 秒内没有完成。"));
    }, 180_000);
    child.once("error", (error) => { clearTimeout(timeout); fail(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) done(output);
      else fail(new Error(output.trim() || `本机启动器退出码 ${String(code)}。`));
    });
  });

  const middleware: Connect.NextHandleFunction = async (request, response, next) => {
    const path = request.url?.split("?", 1)[0];
    if (path !== "/__taffy_voice_runtime/start") return next();
    const remoteAddress = request.socket.remoteAddress?.replace(/^::ffff:/, "");
    const localRequest = remoteAddress === "127.0.0.1" || remoteAddress === "::1";
    if (request.method !== "POST" || !localRequest || request.headers["x-taffy-local-control"] !== "1") {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: "只允许当前本机页面启动 VCClient。" }));
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    try {
      if (!startInFlight) startInFlight = launch().finally(() => { startInFlight = null; });
      const output = await startInFlight;
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, output }));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  };

  return {
    name: "taffy-local-voice-runtime",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

export default defineConfig({
  plugins: [react(), localVoiceModelPlugin(), localVoiceRuntimePlugin()],
  server: {
    proxy: vcProxy,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  },
  preview: {
    proxy: vcProxy,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1800
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts"
  }
});
