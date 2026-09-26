/** Source assets are immutable; scenes are editable cuts of sources. */
import { validateAnimations, SVG_ID } from "./animation.mjs";
export const VERSION = "0.3.0";
export const READABLE_VERSIONS = ["0.2.0", VERSION];
export const clone = (x) => structuredClone(x);
const frozenSources = new WeakSet();
const jsonBytes = (value) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function freezeSources(value) {
  if (!value || typeof value !== "object" || frozenSources.has(value))
    return value;
  frozenSources.add(value);
  for (const child of Object.values(value)) freezeSources(child);
  return Object.freeze(value);
}
/** Edit snapshots copy metadata, while immutable source assets and audio strings are shared. */
export function snapshotProject(project) {
  // Replacing values before cloning also preserves JSON field order across undo.
  const snapshot = clone({
    ...project,
    sources: null,
    audioTracks: project.audioTracks.map((track) => ({
      ...track,
      dataUrl: null,
    })),
  });
  snapshot.sources = freezeSources(project.sources);
  snapshot.audioTracks.forEach((track, i) => {
    track.dataUrl = project.audioTracks[i].dataUrl;
  });
  return snapshot;
}
export class EditValidator {
  constructor() {
    this.sources = null;
    this.sourceVersion = null;
    this.sourceBytes = 0;
    this.audio = new Map();
  }
  sourcesValid(p) {
    return this.sources === p.sources && this.sourceVersion === p.schemaVersion;
  }
  rememberSources(p) {
    this.sources = p.sources;
    this.sourceVersion = p.schemaVersion;
    this.sourceBytes = jsonBytes(p.sources);
  }
  hasAudio(url) {
    return this.audio.has(url);
  }
  rememberAudio(url) {
    this.nextAudio.set(url, this.audio.get(url) ?? jsonBytes(url));
  }
  byteLength(p) {
    const metadata = {
      ...p,
      sources: null,
      audioTracks: p.audioTracks.map((a) => ({ ...a, dataUrl: "" })),
    };
    return (
      jsonBytes(metadata) +
      (this.sources === p.sources ? this.sourceBytes : jsonBytes(p.sources)) -
      4 +
      p.audioTracks.reduce(
        (n, a) =>
          n +
          (this.nextAudio?.get(a.dataUrl) ??
            this.audio.get(a.dataUrl) ??
            jsonBytes(a.dataUrl)) -
          2,
        0,
      )
    );
  }
  validate(p) {
    freezeSources(p.sources);
    this.nextAudio = new Map();
    try {
      validateProject(p, this);
      this.audio = this.nextAudio;
      return p;
    } finally {
      this.nextAudio = null;
    }
  }
}
export const uid = (prefix = "id") => `${prefix}-${crypto.randomUUID()}`;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Ignore sub-nanosecond arithmetic noise when comparing edited time boundaries.
export const TIME_EPSILON = 1e-9;
export const frameCount = (seconds, fps) =>
  Math.max(0, Math.ceil((seconds - TIME_EPSILON) * fps));
export const length = (s) => s.out - s.in + (s.hold || 0);
export const duration = (p) => p.scenes.reduce((t, s) => t + length(s), 0);
export const sceneStart = (p, i) =>
  p.scenes.slice(0, i).reduce((t, s) => t + length(s), 0);
export function locate(p, t) {
  t = clamp(Number(t) || 0, 0, Math.max(0, duration(p) - 1e-6));
  let start = 0;
  for (let i = 0; i < p.scenes.length; i++) {
    const s = p.scenes[i],
      d = length(s);
    if (t < start + d - TIME_EPSILON || i === p.scenes.length - 1)
      return {
        scene: s,
        index: i,
        start,
        local: Math.max(0, t - start),
        sourceTime: s.in + Math.min(Math.max(0, t - start), s.out - s.in),
      };
    start += d;
  }
}
function finite(n, label, min, max) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
    throw Error(`${label}超出有效范围`);
}
function unique(items, label) {
  const ids = items.map((x) => x.id);
  if (
    ids.some((x) => typeof x !== "string" || !x) ||
    new Set(ids).size !== ids.length
  )
    throw Error(`${label}编号缺失或重复`);
}
export function validateProject(p, cache = null) {
  if (
    p?.schema !== "svgfilm-project" ||
    !READABLE_VERSIONS.includes(p.schemaVersion)
  )
    throw Error("不是支持的 SVGFilm 0.2／0.3 工程");
  if (!cache && jsonBytes(p) > 120 * 1024 * 1024)
    throw Error("工程超过 120 MB，请缩短或压缩音频后再导入；当前编辑保持不变");
  if (!Array.isArray(p.scenes) || p.scenes.length < 1 || p.scenes.length > 500)
    throw Error("工程须有 1–500 个镜头");
  finite(p.canvas?.width, "画幅宽度", 64, 4096);
  finite(p.canvas?.height, "画幅高度", 64, 4096);
  finite(p.canvas?.fps, "帧率", 1, 60);
  unique(p.scenes, "镜头");
  if (!p.sources || typeof p.sources !== "object" || Array.isArray(p.sources))
    throw Error("缺少素材来源");
  if (!cache?.sourcesValid(p)) {
    for (const [id, src] of Object.entries(p.sources)) {
      if (
        !src ||
        !["svg", "cell-native-v1", "svg-keyframes-v1"].includes(src.type)
      )
        throw Error("不支持的来源渲染器");
      finite(src.duration, "来源时长", 0.01, 7200);
      if (src.type === "svg" || src.type === "svg-keyframes-v1") {
        if (typeof src.svg !== "string" || !src.svg.includes("<svg"))
          throw Error("缺少 SVG 来源内容");
      }
      if (src.type === "svg-keyframes-v1") {
        if (p.schemaVersion !== VERSION)
          throw Error("通用动画来源要求 SVGFilm 0.3.0");
        if (!SVG_ID.test(id))
          throw Error(
            "动画 sourceId 须以字母开头，仅含字母数字下划线和连字符，最多96字符",
          );
        validateAnimations(src);
      } else if (src.animations !== undefined)
        throw Error("animations 仅适用于 svg-keyframes-v1 来源");
    }
    cache?.rememberSources(p);
  }
  for (const s of p.scenes) {
    const src = p.sources[s.sourceId];
    if (!Object.hasOwn(p.sources, s.sourceId))
      throw Error(`镜头 ${s.name || s.id} 缺少来源`);
    finite(s.in, "镜头入点", 0, src.duration);
    finite(s.out, "镜头出点", s.in + 0.01 - TIME_EPSILON, src.duration);
    finite(s.hold || 0, "停留时长", 0, 600);
    if (
      !Array.isArray(s.subtitles) ||
      !Array.isArray(s.texts) ||
      !Array.isArray(s.objects)
    )
      throw Error("镜头缺少文字或对象清单");
    unique(s.subtitles, "字幕");
    unique(s.texts, "文字");
    unique(s.objects, "对象");
    for (const l of s.subtitles) {
      if (typeof l.text !== "string") throw Error("字幕内容无效");
      finite(l.start, "字幕开始", 0, length(s));
      finite(
        l.end,
        "字幕结束",
        l.start + 0.001 - TIME_EPSILON,
        length(s) + 0.00001,
      );
    }
    for (const t of s.texts) {
      if (typeof t.text !== "string" || t.text.length > 10000)
        throw Error("文字内容无效");
      finite(t.x, "文字位置", -20000, 20000);
      finite(t.y, "文字位置", -20000, 20000);
      finite(t.size, "字号", 4, 500);
      finite(t.width || 0, "文字换行宽度", 0, 20000);
    }
    const ids = new Set(s.objects.map((o) => o.id));
    for (const [id, o] of Object.entries(s.objectOverrides || {})) {
      if (!ids.has(id)) throw Error("对象引用已失效");
      for (const k of ["dx", "dy", "rotation"])
        if (o[k] !== undefined) finite(o[k], "对象变换", -20000, 20000);
      if (o.scale !== undefined) finite(o.scale, "对象缩放", 0.05, 20);
    }
  }
  if (duration(p) > 7200) throw Error("全片时长超出两小时范围");
  if (!Array.isArray(p.audioTracks) || p.audioTracks.length > 16)
    throw Error("音轨数量超出范围");
  unique(p.audioTracks, "音轨");
  for (const a of p.audioTracks) {
    if (
      !cache?.hasAudio(a.dataUrl) &&
      !/^data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/.test(a.dataUrl || "")
    )
      throw Error("音频素材须完整包含在工程内");
    cache?.rememberAudio(a.dataUrl);
    finite(a.start, "音轨开始", 0, 7200);
    finite(a.offset || 0, "音频源起点", 0, 7200);
    finite(a.duration, "音轨长度", 0.01, 7200);
    finite(a.volume, "音量", 0, 1);
    finite(a.fadeIn || 0, "淡入", 0, a.duration);
    finite(a.fadeOut || 0, "淡出", 0, a.duration);
    if (
      a.mediaDuration !== undefined &&
      a.offset + a.duration > a.mediaDuration + 0.05
    )
      throw Error("音轨超出源音频范围");
  }
  if (cache && cache.byteLength(p) > 120 * 1024 * 1024)
    throw Error("工程超过 120 MB，请缩短或压缩音频后再导入；当前编辑保持不变");
  return p;
}
export function serializeProject(p) {
  const q = clone(p);
  for (const s of q.scenes)
    for (const l of s.subtitles) {
      delete l.rows;
      delete l.originalText;
    }
  validateProject(q);
  return JSON.stringify(q);
}
export function parseProject(text) {
  const p = JSON.parse(text);
  validateProject(p);
  return p;
}
export function dirty(p) {
  p.workflow ??= {};
  p.workflow.script ??= {};
  p.workflow.script.status = "needs-review";
}
function sliceCaptions(lines, a, b, renewIds = true) {
  return lines
    .filter((l) => l.end > a && l.start < b)
    .map((l) => ({
      ...clone(l),
      id: renewIds ? uid("sub") : l.id,
      start: Math.max(0, l.start - a),
      end: Math.min(b, l.end) - a,
    }))
    .filter((l) => l.end - l.start >= 0.001 - TIME_EPSILON);
}
export function splitScene(p, index, at) {
  const s = p.scenes[index],
    d = length(s);
  if (!(at > 0.05 && at < d - 0.05))
    throw Error("请将播放头放在镜头内部再拆分");
  if (at >= s.out - s.in) throw Error("请在动画区间内拆分；末尾停留可直接调整");
  const right = clone(s);
  right.id = uid("scene");
  right.name = `${s.name || "镜头"} · 后段`;
  right.in = s.in + at;
  right.subtitles = sliceCaptions(s.subtitles, at, d);
  s.out = s.in + at;
  s.hold = 0;
  s.subtitles = sliceCaptions(s.subtitles, 0, at);
  p.scenes.splice(index + 1, 0, right);
  dirty(p);
}
export function trimScene(p, index, begin, end, hold = 0) {
  const s = p.scenes[index],
    src = p.sources[s.sourceId];
  finite(begin, "入点", 0, src.duration);
  finite(end, "出点", begin + 0.01 - TIME_EPSILON, src.duration);
  finite(hold, "停留", 0, 600);
  const delta = begin - s.in,
    old = s.subtitles;
  s.in = begin;
  s.out = end;
  s.hold = hold;
  s.subtitles = sliceCaptions(old, delta, delta + length(s), false);
  dirty(p);
}
export function removeScene(p, index) {
  if (p.scenes.length === 1) throw Error("请至少保留一个镜头");
  p.scenes.splice(index, 1);
  dirty(p);
}
export function moveScene(p, index, to) {
  if (to < 0 || to >= p.scenes.length) return;
  const [s] = p.scenes.splice(index, 1);
  p.scenes.splice(to, 0, s);
  dirty(p);
}
export function duplicateScene(p, index) {
  const s = clone(p.scenes[index]);
  s.id = uid("scene");
  s.name += " · 副本";
  p.scenes.splice(index + 1, 0, s);
  dirty(p);
}
export function audioGain(a, time) {
  const t = time - a.start;
  if (a.muted || t < 0 || t >= a.duration) return 0;
  return (
    (a.volume ?? 1) *
    Math.min(1, a.fadeIn ? t / a.fadeIn : 1) *
    Math.min(1, a.fadeOut ? (a.duration - t) / a.fadeOut : 1)
  );
}
export function clock(t) {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function srtClock(t) {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function toSrt(p) {
  let i = 0,
    start = 0,
    blocks = [];
  for (const s of p.scenes) {
    for (const l of [...s.subtitles].sort((a, b) => a.start - b.start))
      blocks.push(
        `${++i}\n${srtClock(start + l.start)} --> ${srtClock(start + l.end)}\n${l.text}`,
      );
    start += length(s);
  }
  return blocks.join("\n\n") + "\n";
}
export function parseSrt(text) {
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n/);
  const out = [];
  const sec = (s) => {
    const [h, m, z] = s.replace(",", ".").split(":").map(Number);
    return h * 3600 + m * 60 + z;
  };
  for (const b of blocks) {
    const rows = b.split("\n"),
      i = rows.findIndex((s) => s.includes("-->"));
    if (i < 0) continue;
    const match = rows[i].match(
      /(\d\d:\d\d:\d\d[,.]\d{3})\s*-->\s*(\d\d:\d\d:\d\d[,.]\d{3})/,
    );
    if (!match) throw Error("字幕时间格式无效");
    const start = sec(match[1]),
      end = sec(match[2]);
    if (end <= start) throw Error("字幕结束须晚于开始");
    out.push({
      id: uid("sub"),
      start,
      end,
      text: rows.slice(i + 1).join("\n"),
    });
  }
  if (!out.length) throw Error("没有找到 SRT 字幕");
  return out;
}
export function importSrt(p, text) {
  const lines = parseSrt(text);
  if (lines.some((l) => l.end > duration(p) + 0.001))
    throw Error("字幕超过全片时长，请先调整镜头");
  let t = 0;
  for (const s of p.scenes) {
    s.subtitles = sliceCaptions(lines, t, t + length(s));
    t += length(s);
  }
  dirty(p);
}
export class History {
  constructor(limit = 40) {
    this.past = [];
    this.future = [];
    this.limit = limit;
  }
  push(p) {
    this.past.push(snapshotProject(p));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(p) {
    if (!this.past.length) return p;
    this.future.push(snapshotProject(p));
    return this.past.pop();
  }
  redo(p) {
    if (!this.future.length) return p;
    this.past.push(snapshotProject(p));
    return this.future.pop();
  }
}
