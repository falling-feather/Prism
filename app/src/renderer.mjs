import {
  clone,
  locate,
  uid,
  VERSION,
  READABLE_VERSIONS,
  validateProject,
} from "./project.mjs";
import { createSourceAdapter } from "./adapter-registry.mjs";
import {
  NS,
  element,
  attr,
  wrap,
  paintText,
  sanitizeSvg,
} from "./svg-utils.mjs";
export { element, sanitizeSvg } from "./svg-utils.mjs";
export class Renderer {
  constructor(svg, options = {}) {
    this.svg = svg;
    this.options = options;
    this.sources = new Map();
    this.project = null;
  }
  load(project) {
    validateProject(project);
    for (const adapter of this.sources.values()) adapter.dispose?.();
    this.frameToken = (this.frameToken || 0) + 1;
    this.project = project;
    this.loadedSources = project.sources;
    this.loadedResources = project.resources;
    this.loadedCanvas = JSON.stringify([
      project.canvas.width,
      project.canvas.height,
      project.canvas.background,
    ]);
    this.activeSource = null;
    this.captionSignature = null;
    this.svg.replaceChildren();
    this.svg.setAttribute(
      "viewBox",
      `0 0 ${project.canvas.width} ${project.canvas.height}`,
    );
    this.svg.setAttribute("xmlns", NS);
    element(
      "rect",
      {
        width: "100%",
        height: "100%",
        fill: project.canvas.background || "#e7e5da",
      },
      this.svg,
    );
    this.sources = new Map();
    for (const [id, source] of Object.entries(project.sources)) {
      const host = element("g", { "data-source-id": id }, this.svg);
      const adapter = createSourceAdapter(id, source, host, project);
      this.sources.set(id, adapter);
      host.style.display = "none";
    }
    this.captionLayer = element("g", { "data-layer": "captions" }, this.svg);
    // Freshly imported legacy/native projects receive the complete renderer-derived registry.
    for (const s of project.scenes) {
      const catalog = this.sources.get(s.sourceId);
      catalog.validateScene?.(s);
      if (catalog.syncCatalog) catalog.syncCatalog(s);
      else {
        if (!s.texts.length) s.texts = clone(catalog.texts);
        if (!s.objects.length) s.objects = clone(catalog.objects);
      }
      s.objectOverrides ??= {};
    }
    this.render(0);
  }
  updateProject(project) {
    if (
      this.loadedSources !== project.sources ||
      this.loadedResources !== project.resources ||
      this.loadedCanvas !==
        JSON.stringify([
          project.canvas.width,
          project.canvas.height,
          project.canvas.background,
        ])
    )
      this.load(project);
    else this.project = project;
  }
  render(time, options = {}) {
    const p = this.project,
      pos = locate(p, time);
    if (!pos) return;
    const s = pos.scene,
      src = this.sources.get(s.sourceId);
    src.syncCatalog?.(s);
    if (this.activeSource !== src) {
      this.activeSource?.deactivate?.();
      for (const v of this.sources.values())
        v.host.style.display = v === src ? "" : "none";
      this.activeSource = src;
    }
    const rendering = src.renderSource(s, pos.sourceTime, {...this.options,...options});
    this.track(rendering);
    for (const o of s.objects) {
      const w = src.wrappers.get(o.id),
        ov = s.objectOverrides[o.id] || {};
      if (!w) continue;
      const signature = JSON.stringify([
        ov.hidden,
        ov.dx,
        ov.dy,
        ov.scale,
        ov.rotation,
        o.cx,
        o.cy,
      ]);
      if (src.appliedOverrides.get(o.id) === signature) continue;
      src.appliedOverrides.set(o.id, signature);
      w.style.display = ov.hidden ? "none" : "";
      w.setAttribute(
        "transform",
        `translate(${ov.dx || 0} ${ov.dy || 0}) translate(${o.cx || 0} ${o.cy || 0}) rotate(${ov.rotation || 0}) scale(${ov.scale ?? 1}) translate(${-o.cx || 0} ${-o.cy || 0})`,
      );
    }
    const visible = s.subtitles.filter(
      (l) => pos.local >= l.start && pos.local < l.end,
    );
    const captionSignature = JSON.stringify([
      visible,
      p.captionStyle,
      p.canvas.width,
      p.canvas.height,
      p.canvas.background,
    ]);
    if (this.captionSignature !== captionSignature) {
      this.captionSignature = captionSignature;
      this.captionLayer.replaceChildren();
      let baseline = p.canvas.height - 38;
      for (const l of [...visible].reverse()) {
        const size = p.captionStyle?.size || 28,
          font = p.captionStyle?.font || "KaiTi, STKaiti, serif";
        const rows = wrap(l.text, size, font, p.canvas.width - 100);
        const e = element(
          "text",
          {
            "data-subtitle-id": l.id,
            stroke: p.canvas.background || "#e7e5da",
            "stroke-width": 4,
            "paint-order": "stroke",
          },
          this.captionLayer,
        );
        paintText(e, {
          text: rows.join("\n"),
          x: p.canvas.width / 2,
          y: baseline - (rows.length - 1) * size * 1.3,
          size,
          font,
          fill: p.captionStyle?.fill || "#252720",
          anchor: "middle",
          width: 0,
        });
        baseline -= rows.length * size * 1.3 + 12;
      }
    }
    this.svg.dataset.scene = s.id;
    this.svg.dataset.time = String(time);
    this.position = pos;
    return pos;
  }
  node(id) {
    return this.sources.get(this.position.scene.sourceId)?.nodes.get(id);
  }
  wrapper(id) {
    return this.sources.get(this.position.scene.sourceId)?.wrappers.get(id);
  }
  track(rendering) {
    const token = (this.frameToken = (this.frameToken || 0) + 1);
    this.pending = Promise.resolve(rendering).then(
      () => {
        if (token === this.frameToken)
          this.svg.dispatchEvent(new CustomEvent("render-ready"));
      },
      (error) => {
        if (token !== this.frameToken) return;
        this.svg.dispatchEvent(
          new CustomEvent("render-error", { detail: error }),
        );
        throw error;
      },
    );
    // UI receives render-error; callers awaiting this.pending still receive the rejection.
    this.pending.catch(() => {});
  }
  async whenReady() {
    let pending;
    do {
      pending = this.pending;
      await pending;
    } while (pending !== this.pending);
  }
  async renderAsync(time, options = {}) {
    const position = this.render(time, options);
    await this.whenReady();
    return position;
  }
  cloneFrame() {
    const svg = this.svg.cloneNode(true);
    for (const child of [...svg.children]) {
      const id = child.getAttribute("data-source-id");
      if (!id) continue;
      if (child.style.display === "none") child.remove();
      else this.sources.get(id)?.snapshot?.(child);
    }
    return svg;
  }
  snapshot() {
    return new XMLSerializer().serializeToString(this.cloneFrame());
  }
}
export async function migrateLegacy(old) {
  if (READABLE_VERSIONS.includes(old.schemaVersion)) {
    validateProject(old);
    const next = clone(old);
    next.schemaVersion = VERSION;
    return next;
  }
  if (
    old.schema !== "svgfilm-project" ||
    old.renderer?.adapter !== "cell-native-v1"
  )
    throw Error("此旧版工程需要对应适配器，无法自动恢复");
  const story = await fetch(
    "cases/cell_structure/native_source/src/story.json",
  ).then((r) => r.json());
  const p = {
    schema: "svgfilm-project",
    schemaVersion: VERSION,
    projectId: old.projectId,
    title: old.title,
    canvas: { ...old.canvas, background: "#e7e5da" },
    workflow: clone(old.workflow),
    sources: {},
    scenes: [],
    audioTracks: [],
  };
  for (const s of old.scenes) {
    const orig = story.scenes.find((x) => x.id === s.id);
    if (!orig) throw Error(`缺少原生镜头 ${s.id}`);
    const sourceId = `cell-${s.id}`;
    p.sources[sourceId] = {
      type: "cell-native-v1",
      adapterVersion: 1,
      duration: orig.duration,
      scene: clone(orig),
    };
    p.scenes.push({
      id: uid("scene"),
      sourceId,
      name: s.title,
      in: 0,
      out: Math.min(s.duration, orig.duration),
      hold: Math.max(0, s.duration - orig.duration),
      texts: [],
      objects: [],
      objectOverrides: {},
      subtitles: s.subtitles.map((l) => ({
        id: l.id,
        text: l.text,
        start: l.start,
        end: Math.min(l.end, s.duration),
      })),
      legacy: clone(s),
    });
  }
  const response = await fetch(
    "cases/cell_structure/native_source/audio/mix.m4a",
  );
  if (!response.ok) throw Error("缺少原案例音乐");
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(new Blob([blob], { type: "audio/mp4" }));
  });
  p.audioTracks.push({
    id: uid("audio"),
    name: "细胞小工坊 · 背景音乐",
    kind: "music",
    dataUrl,
    start: 0,
    offset: 0,
    duration: Math.min(old.duration, story.duration),
    volume: 0.5,
    fadeIn: 0.5,
    fadeOut: 1,
    muted: false,
    mediaDuration: story.duration,
  });
  return p;
}
export function finishMigration(p) {
  for (const s of p.scenes) {
    if (!s.legacy) continue;
    const old = s.legacy,
      source = p.sources[s.sourceId];
    for (const tx of old.texts) {
      if (tx.text === tx.originalText) continue;
      const t = s.texts.find((t) => t.text === tx.originalText);
      if (t) {
        t.text = tx.text;
        continue;
      }
      // v1 opening/ending titles were authored as two separate lines, unlike the other 16 scenes.
      if (
        source.type === "cell-native-v1" &&
        ["opening", "ending"].includes(source.scene.id)
      ) {
        if (tx.role === "title") {
          Object.assign(s.texts[0], {
            text: tx.text,
            size: Math.min(s.texts[0].size, 55),
            width: 530,
          });
          s.texts[1].text = "";
          continue;
        }
        if (tx.role === "topic") {
          s.texts[2].text = tx.text;
          continue;
        }
      }
      throw Error("旧工程中的修改文字无法定位：" + tx.originalText);
    }
    for (const [key, ov] of Object.entries(old.objectOverrides || {})) {
      const ref = old.objects.find((x) => x.key === key);
      if (!ref) throw Error("旧工程对象引用已失效");
      const o =
        ref.label === "动画舞台"
          ? s.objects[0]
          : s.objects.filter((x) => x.label === ref.label)[ref.occurrence || 0];
      if (!o) throw Error("旧工程中的对象修改无法定位：" + ref.label);
      s.objectOverrides[o.id] = clone(ov);
    }
    delete s.legacy;
  }
  validateProject(p);
  return p;
}
export function svgProject(svg, name = "新镜头") {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const v = doc.documentElement
    .getAttribute("viewBox")
    ?.split(/[ ,]+/)
    .map(Number);
  const width = v?.[2] || attr(doc.documentElement, "width", 1280),
    height = v?.[3] || attr(doc.documentElement, "height", 720);
  const id = uid("source");
  return {
    schema: "svgfilm-project",
    schemaVersion: VERSION,
    projectId: uid("project"),
    title: name,
    canvas: { width, height, fps: 30, background: "#ffffff" },
    workflow: { script: { status: "needs-review" } },
    sources: { [id]: { type: "svg", svg: sanitizeSvg(svg), duration: 10 } },
    scenes: [
      {
        id: uid("scene"),
        sourceId: id,
        name,
        in: 0,
        out: 10,
        hold: 0,
        texts: [],
        objects: [],
        objectOverrides: {},
        subtitles: [],
      },
    ],
    audioTracks: [],
  };
}
export function svgImportNotice(markup) {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const animated =
    doc.querySelector("script,animate,animateMotion,animateTransform,set") ||
    [...doc.querySelectorAll("style,[style]")].some((e) =>
      /@keyframes|\banimation\b|\btransition\b/i.test(
        e.localName === "style" ? e.textContent : e.getAttribute("style"),
      ),
    );
  return (
    "SVG 已作为静态镜头导入，图形和文字可编辑" +
    (animated ? "；原文件中的动画未保留，请用标准工程交付动画" : "")
  );
}
