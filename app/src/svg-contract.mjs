import { SVG_ID } from "./animation.mjs";
const GRAPHICS =
  "g,text,rect,circle,ellipse,path,polygon,polyline,line,image,use";
const RESOURCES = "defs,clipPath,mask,marker,pattern,filter";
const TAGS = new Set(
  (
    "svg " +
    GRAPHICS.replaceAll(",", " ") +
    " tspan defs clipPath mask marker pattern linearGradient radialGradient stop title desc metadata filter feGaussianBlur feDropShadow feColorMatrix feOffset feFlood feComposite feBlend feMerge feMergeNode"
  ).split(" "),
);
const STYLES = new Set(
  "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity display visibility color font-family font-size font-weight font-style text-anchor letter-spacing dominant-baseline paint-order vector-effect".split(
    " ",
  ),
);
const OWNED = new Set(
  "data-original-id data-node-id data-layout-id data-motion-id data-text-id data-content data-signature data-source-id data-layer data-scene data-ground data-text".split(
    " ",
  ),
);
/** Strict authoring profile: reject lossy input instead of stripping animation. */
export function validateSvgContract(source, canvas) {
  const doc = new DOMParser().parseFromString(source.svg, "image/svg+xml"),
    svg = doc.documentElement;
  if (doc.querySelector("parsererror") || svg.localName !== "svg")
    throw Error("动画 SVG 无法解析");
  const vb = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !vb ||
    vb.length !== 4 ||
    vb.some((v, i) => v !== [0, 0, canvas.width, canvas.height][i])
  )
    throw Error("动画 SVG viewBox 须与 canvas 一致，从 0 0 开始");
  const all = [svg, ...svg.querySelectorAll("*")],
    ids = new Map(),
    objects = new Set();
  for (const e of all) {
    if (
      e.namespaceURI !== "http://www.w3.org/2000/svg" ||
      !TAGS.has(e.localName) ||
      (e !== svg && e.localName === "svg")
    )
      throw Error(`动画 SVG 不支持节点 ${e.localName}`);
    if (e.id) {
      if (!SVG_ID.test(e.id) || ids.has(e.id))
        throw Error(`SVG id 无效或重复：${e.id}`);
      ids.set(e.id, e);
    }
    if (e.matches(GRAPHICS) && !e.closest(RESOURCES)) {
      if (!e.id) throw Error(`可编辑 ${e.localName} 缺少稳定 id`);
      objects.add(e.id);
    }
    if (e.localName === "text" && e.closest(RESOURCES))
      throw Error("可编辑文字须直接放在画面中，不能藏在 defs 等资源中");
    for (const a of e.attributes) {
      if (OWNED.has(a.name) || a.name.toLowerCase().startsWith("on"))
        throw Error(`SVG 属性 ${a.name} 由工作台保留或不支持`);
    }
    for (const property of e.style) {
      if (!STYLES.has(property))
        throw Error(
          `动画 SVG 不支持 CSS ${property}；基础变换请使用 transform 属性`,
        );
    }
  }
  for (const e of all)
    for (const a of e.attributes) {
      if (a.localName === "href") {
        if (a.value.startsWith("#")) {
          if (!ids.has(a.value.slice(1)))
            throw Error(`SVG 引用不存在：${a.value}`);
        } else if (
          !(
            e.localName === "image" &&
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(
              a.value,
            )
          )
        )
          throw Error("SVG 资源须内嵌，不能引用外部地址");
      }
      if (/url\(/i.test(a.value)) {
        const values =
          a.name === "style"
            ? [...e.style].map((k) => e.style.getPropertyValue(k))
            : [a.value];
        for (const v of values.filter((v) => /url\(/i.test(v))) {
          const m = v.match(/^url\(\s*['"]?#([\w-]+)['"]?\s*\)$/);
          if (!m || !ids.has(m[1]))
            throw Error("SVG url() 须引用存在的本地 id");
        }
      }
    }
  for (const a of source.animations)
    if (!objects.has(a.target))
      throw Error(`动画 target 不存在或不可编辑：${a.target}`);
  return doc;
}
export function validateCatalog(scene, catalog) {
  for (const key of ["objects", "texts"]) {
    if (!scene[key].length) continue;
    const expected = new Map(catalog[key].map((x) => [x.id, x]));
    if (scene[key].length !== expected.size)
      throw Error(
        `${key} 清单不完整，请保留工作台登记结果或首次导入时使用空数组`,
      );
    for (const entry of scene[key]) {
      const original = expected.get(entry.id);
      if (!original) throw Error(`${key} 引用失效：${entry.id}`);
      if (key === "texts" && entry.objectId !== original.objectId)
        throw Error(`文字 objectId 引用失效：${entry.id}`);
      if (
        key === "objects" &&
        (entry.parentId !== original.parentId ||
          !Number.isFinite(entry.cx) ||
          !Number.isFinite(entry.cy))
      )
        throw Error(`组件层级或中心无效：${entry.id}`);
      if (
        key === "texts" &&
        (!Number.isFinite(entry.start) ||
          !Number.isFinite(entry.end) ||
          entry.start < 0 ||
          entry.end <= entry.start)
      )
        throw Error(`文字可见时间无效：${entry.id}`);
    }
  }
}
