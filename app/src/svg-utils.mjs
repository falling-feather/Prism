import { wrapLines } from "./text-layout.mjs";
import { uid } from "./project.mjs";
export const NS = "http://www.w3.org/2000/svg";
export const element = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};
export const attr = (e, k, fallback) => Number(e.getAttribute(k) || fallback);
const measure = document.createElement("canvas").getContext("2d");
export function wrap(text, size, font, width) {
  measure.font = `${size}px ${font}`;
  return wrapLines(text, width, (value) => measure.measureText(value).width);
}
export const textSignature = (t) =>
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
export function paintText(e, t, template) {
  const signature = textSignature(t);
  if (e.dataset.signature === signature) return;
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
  e.dataset.signature = signature;
  if (template?.signature === signature) {
    for (const key of ["x", "y"]) {
      if (template.position[key] === null) e.removeAttribute(key);
      else e.setAttribute(key, template.position[key]);
    }
    e.replaceChildren(...template.children.map((n) => n.cloneNode(true)));
    return;
  }
  e.replaceChildren();
  wrap(t.text, t.size, font, t.width).forEach((row, i) => {
    element("tspan", { x: t.x, dy: i ? t.size * 1.3 : 0 }, e).textContent = row;
  });
}
export function sourceText(e) {
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
