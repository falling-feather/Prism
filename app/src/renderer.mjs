import {
  clone,
  locate,
  uid,
  VERSION,
  READABLE_VERSIONS,
  validateProject,
} from "./project.mjs";
import { sampleAnimation } from "./animation.mjs";
import { validateSvgContract, validateCatalog } from "./svg-contract.mjs";
const NS = "http://www.w3.org/2000/svg";
export const element = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};
const attr = (e, k, fallback) => Number(e.getAttribute(k) || fallback);
const measure = document.createElement("canvas").getContext("2d");
function wrap(text, size, font, width) {
  measure.font = `${size}px ${font}`;
  return text.split("\n").flatMap((line) => {
    if (!width) return [line];
    const lines = [];
    let row = "";
    for (const c of line) {
      if (row && measure.measureText(row + c).width > width) {
        lines.push(row);
        row = "";
      }
      row += c;
    }
    lines.push(row);
    return lines;
  });
}
const textSignature = (t) =>
  JSON.stringify([
    t.text,
    t.x,
    t.y,
    t.size,
    t.font || "KaiTi, STKaiti, serif",
    t.width || 0,
    t.fill || "#252720",
    t.anchor || "start",
  ]);
function paintText(e, t, template) {
  const font = t.font || "KaiTi, STKaiti, serif";
  e.setAttribute("x", t.x);
  e.setAttribute("y", t.y);
  e.setAttribute("font-size", t.size);
  e.setAttribute("font-family", font);
  e.setAttribute("fill", t.fill || "#252720");
  e.setAttribute("text-anchor", t.anchor || "start");
  Object.assign(e.style, {
    fontSize: t.size + "px",
    fontFamily: font,
    fill: t.fill || "#252720",
    textAnchor: t.anchor || "start",
  });
  const signature = textSignature(t);
  if (e.dataset.signature === signature) return;
  e.dataset.signature = signature;
  if (template?.signature === signature) {
    e.replaceChildren(...template.children.map((n) => n.cloneNode(true)));
    return;
  }
  e.replaceChildren();
  wrap(t.text, t.size, font, t.width).forEach((row, i) => {
    element("tspan", { x: t.x, dy: i ? t.size * 1.3 : 0 }, e).textContent = row;
  });
}
function sourceText(e) {
  let text = "",
    baseline = Number(e.getAttribute("y") || 0);
  for (const n of e.childNodes) {
    if (n.nodeType === 3) {
      if (n.textContent.trim() || !/[\n\r\t]/.test(n.textContent))
        text += n.textContent;
      continue;
    }
    const dy = parseFloat(n.getAttribute?.("dy") || 0),
      y = n.hasAttribute?.("y")
        ? parseFloat(n.getAttribute("y"))
        : baseline + dy;
    if (
      text &&
      y > baseline + 1 &&
      (n.hasAttribute?.("x") || y - baseline > 10)
    )
      text += "\n";
    text += n.textContent;
    baseline = y;
  }
  return text;
}
export function sanitizeSvg(markup, scope = uid("svg"), stableIds = false) {
  const prefix = `svf-${scope.length}-${scope}`,
    rootScope = stableIds ? `${prefix}-root` : scope;
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw Error("SVG 文件无法解析");
  const svg = doc.documentElement;
  svg
    .querySelectorAll(
      "script,foreignObject,iframe,object,embed,animate,animateMotion,animateTransform,set,audio,video",
    )
    .forEach((e) => e.remove());
  const idMap = new Map();
  for (const [e, i] of [svg, ...svg.querySelectorAll("[id]")].map((e, i) => [
    e,
    i,
  ])) {
    if (e.id) {
      if (idMap.has(e.id)) throw Error("SVG 内存在重复编号");
      idMap.set(
        e.id,
        i
          ? stableIds
            ? `${prefix}-node-${e.id}`
            : `${scope}-ref${i}`
          : rootScope,
      );
      e.setAttribute(
        "data-original-id",
        e.getAttribute("data-original-id") || e.id,
      );
    }
    if (e.id || e === svg) e.id = i ? idMap.get(e.id) : rootScope;
  }
  const replaceUrls = (v) =>
    v.replace(
      /url\(\s*(['"]?)#([^'"\s)]+)\1\s*\)/g,
      (_, quote, id) => `url(#${idMap.get(id) || id})`,
    );
  const entries = [...idMap].sort((a, b) => b[0].length - a[0].length),
    reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replaceSelectors = (selector) => {
    entries.forEach(([old], i) => {
      selector = selector.replace(
        new RegExp("#" + reEscape(CSS.escape(old)) + "(?![\\w-])", "g"),
        () => `\u0001${i}\u0002`,
      );
    });
    return selector.replace(
      /\u0001(\d+)\u0002/g,
      (_, i) => "#" + CSS.escape(entries[+i][1]),
    );
  };
  const safeValue = (v) =>
    !/(?:javascript:|https?:|data:|@import|expression\s*\()/i.test(v) &&
    (!/url\(/i.test(v) || /^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/.test(v));
  const allowed = new Set(
    "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity display visibility color font-family font-size font-weight font-style text-anchor letter-spacing dominant-baseline paint-order vector-effect transform transform-origin".split(
      " ",
    ),
  );
  const cleanStyle = (style) =>
    [...style]
      .filter((k) => allowed.has(k) && safeValue(style.getPropertyValue(k)))
      .map((k) => `${k}:${replaceUrls(style.getPropertyValue(k))}`)
      .join(";");
  for (const style of [...svg.querySelectorAll("style")]) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style.textContent);
    style.textContent = [...sheet.cssRules]
      .filter((r) => r.type === CSSRule.STYLE_RULE)
      .map((r) => {
        const declarations = cleanStyle(r.style),
          selector = replaceSelectors(r.selectorText);
        return declarations
          ? `:where(#${CSS.escape(rootScope)}):is(${selector}),:where(#${CSS.escape(rootScope)}) :is(${selector}){${declarations}}`
          : "";
      })
      .join("\n");
  }
  for (const e of [svg, ...svg.querySelectorAll("*")])
    for (const a of [...e.attributes]) {
      const k = a.name.toLowerCase(),
        v = a.value;
      if (k === "style") {
        e.setAttribute("style", cleanStyle(e.style));
        continue;
      }
      if (
        k.startsWith("on") ||
        (k.endsWith("href") &&
          !v.startsWith("#") &&
          !/^data:image\/(png|jpeg|webp);base64,/.test(v)) ||
        (/url\(/i.test(v) && !safeValue(v))
      ) {
        e.removeAttribute(a.name);
        continue;
      }
      if (k.endsWith("href") && v.startsWith("#"))
        e.setAttribute(a.name, "#" + (idMap.get(v.slice(1)) || v.slice(1)));
      else if (/url\(/i.test(v)) e.setAttribute(a.name, replaceUrls(v));
    }
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return new XMLSerializer().serializeToString(svg);
}
export class Renderer {
  constructor(svg) {
    this.svg = svg;
    this.sources = new Map();
    this.project = null;
  }
  load(project) {
    validateProject(project);
    this.project = project;
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
      const animated = source.type === "svg-keyframes-v1";
      if (animated) validateSvgContract(source, project.canvas);
      const host = element("g", { "data-source-id": id }, this.svg);
      let api = null,
        texts = [],
        objects = [];
      const textTemplates = new Map();
      if (source.type === "cell-native-v1") {
        api = globalThis.PaperArt.create(host, {});
        api.setScene(id);
        globalThis.CellScenes.build(api, source.scene, host, {
          scenes: [source.scene],
        });
        api.render(id, source.duration * 0.6, source.duration * 0.6);
        texts = clone(api.textCatalog);
        objects = clone(api.objectCatalog);
        const ground = element(
          "path",
          {
            "data-ground": "1",
            fill: "none",
            stroke: "#252720",
            "stroke-width": 1.9,
          },
          host,
        );
      } else {
        const nested = new DOMParser().parseFromString(
          sanitizeSvg(source.svg, id, animated),
          "image/svg+xml",
        ).documentElement;
        host.append(document.importNode(nested, true));
        const inserted = host.querySelector("svg");
        inserted.setAttribute("width", "100%");
        inserted.setAttribute("height", "100%");
        // Outlined legacy text retains its source string; convert it once for real editing.
        host.querySelectorAll("[data-text]").forEach((g) => {
          if (g.querySelector("text")) return;
          const u = g.querySelector("use"),
            m = u
              ?.getAttribute("transform")
              ?.match(/translate\(([-.\d]+)[ ,]+([-.\d]+)\).*scale\(([-.\d]+)/);
          if (!m) return;
          const text = g.getAttribute("data-text");
          g.replaceChildren();
          element(
            "text",
            { x: m[1], y: m[2], "font-size": Math.abs(+m[3]) * 1000 },
            g,
          ).textContent = text;
        });
        let k = 0;
        const candidates = [
          ...host.querySelectorAll(
            animated
              ? "g[id],text,rect,circle,ellipse,path,polygon,polyline,line,image,use"
              : "[data-object],g[id],text,rect,circle,ellipse,path,polygon,polyline,line,image,use",
          ),
        ].filter((e) => !e.closest("defs,clipPath,mask,marker,pattern,filter"));
        for (const e of candidates) {
          const oid = animated
            ? `${id}:o:${e.getAttribute("data-original-id")}`
            : `${id}:o${k++}`;
          e.setAttribute("data-node-id", oid);
          objects.push({
            id: oid,
            label:
              e.getAttribute("data-object") ||
              e.getAttribute("data-original-id") ||
              e.id ||
              e.textContent?.slice(0, 20) ||
              e.localName,
            parentId:
              e.parentElement
                .closest("[data-node-id]")
                ?.getAttribute("data-node-id") || null,
          });
        }
        [...host.querySelectorAll("text")].forEach((e, i) => {
          const tid = animated
              ? `${id}:t:${e.getAttribute("data-original-id")}`
              : `${id}:t${i}`,
            style = getComputedStyle(e),
            rgb = style.fill.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/),
            fill = rgb
              ? "#" +
                rgb
                  .slice(1)
                  .map((v) => (+v).toString(16).padStart(2, "0"))
                  .join("")
              : style.fill;
          e.setAttribute("data-text-id", tid);
          e.setAttribute("data-content", "1");
          const meta = {
            id: tid,
            objectId: e.getAttribute("data-node-id"),
            text: sourceText(e),
            x: e.x.baseVal.numberOfItems ? e.x.baseVal.getItem(0).value : 0,
            y: e.y.baseVal.numberOfItems ? e.y.baseVal.getItem(0).value : 0,
            size: parseFloat(style.fontSize) || 24,
            font: style.fontFamily,
            fill,
            anchor: style.textAnchor || "start",
            width: 0,
            start: 0,
            end: 1e9,
          };
          e.dataset.signature = textSignature(meta);
          textTemplates.set(tid, {
            signature: e.dataset.signature,
            children: [...e.childNodes].map((n) => n.cloneNode(true)),
          });
          texts.push(meta);
        });
      }
      const nodes = new Map(),
        wrappers = new Map(),
        motions = [];
      const animations = new Map(
        (source.animations || []).map((a) => [`${id}:o:${a.target}`, a]),
      );
      for (const o of objects) {
        const node = host.querySelector(`[data-node-id="${CSS.escape(o.id)}"]`);
        if (!node) continue;
        nodes.set(o.id, node);
        let b = node.getBBox();
        const matrix = node.transform?.baseVal?.consolidate()?.matrix;
        let center = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2);
        if (matrix) center = center.matrixTransform(matrix);
        o.cx = center.x;
        o.cy = center.y;
        const w = element("g", { "data-layout-id": o.id });
        node.before(w);
        const animation = animations.get(o.id);
        if (animation) {
          const motion = element(
            "g",
            { "data-motion-id": animation.target },
            w,
          );
          motion.append(node);
          motions.push({ node: motion, animation });
        } else w.append(node);
        wrappers.set(o.id, w);
      }
      this.sources.set(id, {
        host,
        api,
        texts,
        objects,
        nodes,
        wrappers,
        textTemplates,
        motions,
      });
      host.style.display = "none";
    }
    this.captionLayer = element("g", { "data-layer": "captions" }, this.svg);
    // Freshly imported legacy/native projects receive the complete renderer-derived registry.
    for (const s of project.scenes) {
      const catalog = this.sources.get(s.sourceId);
      if (project.sources[s.sourceId].type === "svg-keyframes-v1")
        validateCatalog(s, catalog);
      if (!s.texts.length) s.texts = clone(catalog.texts);
      if (!s.objects.length) s.objects = clone(catalog.objects);
      s.objectOverrides ??= {};
    }
    this.render(0);
  }
  render(time) {
    const p = this.project,
      pos = locate(p, time);
    if (!pos) return;
    const s = pos.scene,
      src = this.sources.get(s.sourceId);
    for (const v of this.sources.values())
      v.host.style.display = v === src ? "" : "none";
    src.api?.render(s.sourceId, pos.sourceTime, pos.sourceTime);
    for (const { node, animation } of src.motions) {
      const a = sampleAnimation(animation, pos.sourceTime),
        [cx, cy] = animation.origin || [0, 0];
      node.setAttribute(
        "transform",
        `translate(${a.x} ${a.y}) translate(${cx} ${cy}) rotate(${a.rotation}) scale(${a.scale}) translate(${-cx} ${-cy})`,
      );
      node.setAttribute("opacity", a.opacity);
    }
    const ground = src.host.querySelector("[data-ground]");
    if (ground) {
      let d = `M0 ${M.ground(0, pos.sourceTime)}`;
      for (let x = 32; x <= 1280; x += 32)
        d += ` L${x} ${M.ground(x, pos.sourceTime)}`;
      ground.setAttribute("d", d);
    }
    for (const o of s.objects) {
      const w = src.wrappers.get(o.id),
        ov = s.objectOverrides[o.id] || {};
      if (!w) continue;
      w.style.display = ov.hidden ? "none" : "";
      w.setAttribute(
        "transform",
        `translate(${ov.dx || 0} ${ov.dy || 0}) translate(${o.cx || 0} ${o.cy || 0}) rotate(${ov.rotation || 0}) scale(${ov.scale ?? 1}) translate(${-o.cx || 0} ${-o.cy || 0})`,
      );
    }
    for (const t of s.texts) {
      const group = src.host.querySelector(
        `[data-text-id="${CSS.escape(t.id)}"]`,
      );
      if (!group) continue;
      const e = group.matches("text")
        ? group
        : group.querySelector("[data-content]");
      if (!e) continue;
      paintText(e, t, src.textTemplates.get(t.id));
      if (!src.api)
        group.style.visibility =
          pos.sourceTime >= t.start && pos.sourceTime < t.end
            ? "visible"
            : "hidden";
      group.setAttribute("data-source-text", t.text);
    }
    this.captionLayer.replaceChildren();
    const visible = s.subtitles.filter(
      (l) => pos.local >= l.start && pos.local < l.end,
    );
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
  snapshot() {
    return new XMLSerializer().serializeToString(this.svg);
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
