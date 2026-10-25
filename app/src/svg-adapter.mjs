import { clone } from "./project.mjs";
import { sampleAnimation } from "./animation.mjs";
import { validateSvgContract } from "./svg-contract.mjs";
import { validateCatalog } from "./source-contract.mjs";
import {
  element,
  sanitizeSvg,
  sourceText,
  textSignature,
  paintText,
} from "./svg-utils.mjs";
export function createSvgAdapter(id, source, host, project) {
  const animated = source.type === "svg-keyframes-v1";
  if (animated) validateSvgContract(source, project.canvas);
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
        position: { x: e.getAttribute("x"), y: e.getAttribute("y") },
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
      const motion = element("g", { "data-motion-id": animation.target }, w);
      motion.append(node);
      motions.push({ node: motion, animation });
    } else w.append(node);
    wrappers.set(o.id, w);
  }
  const adapter = {
    host,
    api,
    texts,
    objects,
    nodes,
    wrappers,
    textTemplates,
    motions,
    ground: host.querySelector("[data-ground]"),
    appliedOverrides: new Map(),
    textNodes: new Map(
      texts.map((t) => {
        const group = host.querySelector(
          `[data-text-id="${CSS.escape(t.id)}"]`,
        );
        return [
          t.id,
          {
            group,
            content: group?.matches("text")
              ? group
              : group?.querySelector("[data-content]"),
          },
        ];
      }),
    ),
  };
  adapter.validateScene = (scene) => {
    if (animated) validateCatalog(scene, adapter);
  };
  adapter.renderSource = (scene, time) => {
    adapter.api?.render(id, time, time);
    for (const { node, animation } of adapter.motions) {
      const a = sampleAnimation(animation, time),
        [cx, cy] = animation.origin || [0, 0];
      node.setAttribute(
        "transform",
        `translate(${a.x} ${a.y}) translate(${cx} ${cy}) rotate(${a.rotation}) scale(${a.scale}) translate(${-cx} ${-cy})`,
      );
      node.setAttribute("opacity", a.opacity);
    }
    const ground = adapter.ground;
    if (ground) {
      let d = `M0 ${M.ground(0, time)}`;
      for (let x = 32; x <= 1280; x += 32) d += ` L${x} ${M.ground(x, time)}`;
      ground.setAttribute("d", d);
    }
    for (const t of scene.texts) {
      const { group, content: e } = adapter.textNodes.get(t.id) || {};
      if (!e) continue;
      paintText(e, t, adapter.textTemplates.get(t.id));
      if (!adapter.api)
        group.style.visibility =
          time >= t.start && time < t.end ? "visible" : "hidden";
      group.setAttribute("data-source-text", t.text);
    }
  };
  return adapter;
}
