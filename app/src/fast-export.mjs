import { frameCount, length } from "./project.mjs";

const MAX_BATCH_BYTES = 16 * 1024 * 1024;
function codecFor(width, height, fps) {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16),
    rate = blocks * fps;
  const level =
    blocks <= 3600 && rate <= 108000
      ? "1f"
      : blocks <= 8192 && rate <= 245760
        ? "28"
        : blocks <= 8704 && rate <= 522240
          ? "2a"
          : "34";
  return "avc1.4200" + level;
}
/** A bounded video-only encoder. Each batch is drained before another is accepted. */
export class FastExporter {
  constructor(renderer, isCancelled = async () => false) {
    this.renderer = renderer;
    this.isCancelled = isCancelled;
    this.encoder = null;
    this.cancelled = false;
  }
  compatibilityReason(start, end) {
    if (!globalThis.VideoEncoder || !globalThis.VideoFrame)
      return "当前浏览器没有可用的 WebCodecs";
    let time = 0;
    const visited = new Set();
    for (const scene of this.renderer.project.scenes) {
      const next = time + length(scene);
      if (next > start && time < end && !visited.has(scene.sourceId)) {
        visited.add(scene.sourceId);
        const host = this.renderer.sources.get(scene.sourceId)?.host;
        const effect = host?.querySelector(
          "filter,mask,pattern,textPath,foreignObject",
        );
        if (effect)
          return `镜头「${scene.name}」包含${effect.localName}效果，使用兼容渲染`;
      }
      time = next;
    }
    return null;
  }
  async guard() {
    if (this.cancelled || (await this.isCancelled())) throw Error("导出已取消");
    if (this.error) throw this.error;
  }
  wait(promise, ms, message) {
    let timer,
      poll,
      polling = false;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), ms);
        poll = setInterval(async () => {
          if (polling) return;
          polling = true;
          try {
            await this.guard();
          } catch (error) {
            reject(error);
          } finally {
            polling = false;
          }
        }, 150);
      }),
    ]).finally(() => {
      clearTimeout(timer);
      clearInterval(poll);
    });
  }
  async start({ width, height, start, end }) {
    this.close();
    this.cancelled = false;
    this.error = null;
    const reason = this.compatibilityReason(start, end);
    if (reason) return { supported: false, reason };
    const fps = this.renderer.project.canvas.fps;
    let config = {
      codec: codecFor(width, height, fps),
      width,
      height,
      framerate: fps,
      bitrate: Math.max(
        2000000,
        Math.min(36000000, Math.round(width * height * fps * 0.3)),
      ),
      hardwareAcceleration: "prefer-hardware",
      latencyMode: "quality",
      avc: { format: "annexb" },
    };
    let support = await this.wait(
      VideoEncoder.isConfigSupported(config),
      10000,
      "编码能力检测超时",
    );
    if (!support.supported) {
      config = { ...config, hardwareAcceleration: "no-preference" };
      support = await this.wait(
        VideoEncoder.isConfigSupported(config),
        10000,
        "编码能力检测超时",
      );
    }
    if (!support.supported)
      return {
        supported: false,
        reason: "当前浏览器不支持此画幅／帧率的 H.264 编码",
      };
    await this.guard();
    this.width = width;
    this.height = height;
    this.startTime = start;
    this.fps = fps;
    this.frames = frameCount(end - start, fps);
    this.index = 0;
    this.batchFrames = Math.max(1, Math.min(60, Math.ceil(fps)));
    this.chunks = [];
    this.bytes = 0;
    this.encoded = 0;
    this.busy = false;
    this.stats = {
      maxEncodeQueue: 0,
      maxBatchBytes: 0,
      encodedBytes: 0,
      batches: 0,
      codec: config.codec,
      hardwarePreference: config.hardwareAcceleration,
    };
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.context = this.canvas.getContext("2d");
    this.encoder = new VideoEncoder({
      output: (chunk) => {
        if (this.bytes + chunk.byteLength > MAX_BATCH_BYTES) {
          this.error = Error("快速导出单批数据超过16 MiB");
          this.wake?.();
          return;
        }
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.chunks.push(bytes);
        this.bytes += bytes.length;
        this.encoded++;
        this.stats.maxBatchBytes = Math.max(
          this.stats.maxBatchBytes,
          this.bytes,
        );
      },
      error: (error) => {
        this.error = error;
        this.wake?.();
      },
    });
    this.encoder.ondequeue = () => this.wake?.();
    this.encoder.configure(config);
    return {
      supported: true,
      frames: this.frames,
      batchFrames: this.batchFrames,
      ...this.stats,
    };
  }
  async queueSpace() {
    while (this.encoder.encodeQueueSize > 3) {
      await this.wait(
        new Promise((resolve) => {
          this.wake = resolve;
        }),
        10000,
        "视频编码队列等待超时",
      ).finally(() => {
        this.wake = null;
      });
      await this.guard();
    }
  }
  async draw(time) {
    this.renderer.render(time);
    const stage = this.renderer.svg,
      svg = stage.cloneNode(false);
    svg.setAttribute("width", this.width);
    svg.setAttribute("height", this.height);
    for (const child of stage.children) {
      if (
        child.hasAttribute("data-source-id") &&
        child.style.display === "none"
      )
        continue;
      svg.appendChild(child.cloneNode(true));
    }
    const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      ),
      image = new Image();
    image.src = url;
    try {
      await this.wait(image.decode(), 10000, "SVG画面转换超时");
      // Match the render page's white background for transparent SVG canvases.
      this.context.fillStyle = "#ffffff";
      this.context.fillRect(0, 0, this.width, this.height);
      this.context.drawImage(image, 0, 0, this.width, this.height);
    } finally {
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
    }
  }
  async batch() {
    if (this.busy) throw Error("上一批视频数据尚未取走");
    if (!this.encoder || this.encoder.state !== "configured")
      throw Error("快速编码器尚未初始化");
    this.busy = true;
    try {
      await this.guard();
      const stop = Math.min(this.frames, this.index + this.batchFrames);
      for (; this.index < stop; this.index++) {
        if (this.index % 8 === 0) await this.guard();
        await this.draw(this.startTime + this.index / this.fps);
        const timestamp = Math.round((this.index * 1000000) / this.fps),
          duration =
            Math.round(((this.index + 1) * 1000000) / this.fps) - timestamp;
        const frame = new VideoFrame(this.canvas, { timestamp, duration });
        try {
          this.encoder.encode(frame, {
            keyFrame: this.index % Math.max(1, Math.round(this.fps * 2)) === 0,
          });
        } finally {
          frame.close();
        }
        this.stats.maxEncodeQueue = Math.max(
          this.stats.maxEncodeQueue,
          this.encoder.encodeQueueSize,
        );
        await this.queueSpace();
      }
      await this.wait(this.encoder.flush(), 15000, "视频编码结束等待超时");
      await this.guard();
      if (this.encoded !== this.index)
        throw Error("快速编码的帧数不匹配，未生成完整视频");
      const chunks = this.chunks;
      this.chunks = [];
      this.stats.encodedBytes += this.bytes;
      this.bytes = 0;
      this.stats.batches++;
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(Error("无法读取编码数据"));
        reader.readAsDataURL(new Blob(chunks));
      });
      return {
        data,
        completed: this.index,
        done: this.index === this.frames,
        stats: { ...this.stats },
      };
    } finally {
      this.busy = false;
    }
  }
  close() {
    this.cancelled = true;
    this.wake?.();
    if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
    this.encoder = null;
    this.chunks = [];
    this.bytes = 0;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
  }
}
