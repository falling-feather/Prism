import { SVG_ID, validateAnimations } from "./animation.mjs";

const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v, min, max) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export class SourceRegistry {
  constructor() {
    this.types = new Map();
  }
  register(type, definition) {
    if (this.types.has(type)) throw Error(`来源 ${type} 已注册`);
    if (!type || typeof definition?.validate !== "function")
      throw Error("来源适配器缺少校验接口");
    this.types.set(type, Object.freeze({ ...definition }));
    return this;
  }
  get(type) {
    const result = this.types.get(type);
    if (!result) throw Error(`不支持的来源渲染器：${type}`);
    return result;
  }
}
export const sourceRegistry = new SourceRegistry();
function svgSource(s) {
  if (typeof s.svg !== "string" || !s.svg.includes("<svg"))
    throw Error("缺少 SVG 来源内容");
}
function noAnimationTracks(source) {
  if (source.animations !== undefined)
    throw Error("animations 仅适用于 svg-keyframes-v1 来源");
}
sourceRegistry.register("svg", {
  label: "静态 SVG",
  validate: (source) => {
    svgSource(source);
    noAnimationTracks(source);
  },
});
sourceRegistry.register("cell-native-v1", {
  label: "细胞原生 SVG",
  validate: noAnimationTracks,
});
sourceRegistry.register("svg-keyframes-v1", {
  label: "SVG 关键帧",
  validate: (s, context) => {
    svgSource(s);
    if (!["0.3.0", "0.4.0"].includes(context.version))
      throw Error("通用动画来源要求 SVGFilm 0.3.0 或更新版本");
    if (!SVG_ID.test(context.id)) throw Error("动画 sourceId 无效");
    validateAnimations(s);
  },
});

function parameterValue(d, value) {
  const valid =
    d.type === "number"
      ? finite(value, d.min, d.max)
      : d.type === "boolean"
        ? typeof value === "boolean"
        : d.type === "color"
          ? typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
          : d.type === "select"
            ? typeof value === "string" && d.options.includes(value)
            : d.type === "text"
              ? typeof value === "string" && value.length <= 10000
              : false;
  if (!valid) throw Error(`参数「${d.label}」的值或范围无效`);
}
function parameterDefinitions(parameters = {}) {
  if (!record(parameters) || Object.keys(parameters).length > 64)
    throw Error("对象参数数量或格式无效");
  for (const [key, d] of Object.entries(parameters)) {
    if (
      !SVG_ID.test(key) ||
      !record(d) ||
      typeof d.label !== "string" ||
      !d.label ||
      d.label.length > 200
    )
      throw Error("参数定义缺少稳定编号或名称");
    if (
      d.type === "number" &&
      (!finite(d.min, -1e9, 1e9) ||
        !finite(d.max, d.min, 1e9) ||
        (d.step !== undefined && !finite(d.step, 1e-9, 1e9)))
    )
      throw Error("数值参数范围无效");
    if (
      d.type === "select" &&
      (!Array.isArray(d.options) ||
        !d.options.length ||
        d.options.length > 1000 ||
        d.options.some((v) => typeof v !== "string" || v.length > 200))
    )
      throw Error("选项参数无效");
    parameterValue(d, d.default);
  }
}
export function validateCanvasSource(s, { id, version, resources }) {
  noAnimationTracks(s);
  if (version !== "0.4.0") throw Error("Canvas 程序来源要求工程 0.4.0");
  if (!SVG_ID.test(id)) throw Error("Canvas sourceId 无效");
  if (
    !finite(s.canvas?.width, 64, 4096) ||
    !finite(s.canvas?.height, 64, 4096) ||
    !Number.isInteger(s.canvas.width) ||
    !Number.isInteger(s.canvas.height)
  )
    throw Error("Canvas 来源画幅无效");
  if (
    typeof s.program !== "string" ||
    !s.program.trim() ||
    new TextEncoder().encode(s.program).byteLength > 1024 * 1024
  )
    throw Error("Canvas 程序为空或超过 1 MiB");
  if (!Array.isArray(s.objects) || s.objects.length > 20000)
    throw Error("Canvas 对象清单无效");
  const ids = new Set();
  for (const o of s.objects) {
    if (!record(o) || !SVG_ID.test(o.id)) throw Error("Canvas 对象编号无效");
    if (ids.has(o.id)) throw Error(`Canvas 对象编号重复：${o.id}`);
    ids.add(o.id);
    if (typeof o.label !== "string" || !o.label || o.label.length > 200)
      throw Error("Canvas 对象名称无效");
    if (
      !Array.isArray(o.bounds) ||
      o.bounds.length !== 4 ||
      o.bounds.some((n, i) => !finite(n, i < 2 ? -20000 : 0.001, 20000))
    )
      throw Error(`对象 ${o.id} 边界无效`);
    parameterDefinitions(o.parameters);
    if (o.ranges !== undefined) {
      if (
        !Array.isArray(o.ranges) ||
        o.ranges.length > 1000 ||
        o.ranges.some(
          (r) =>
            !Array.isArray(r) ||
            r.length !== 2 ||
            !finite(r[0], 0, s.duration) ||
            !finite(r[1], r[0] + 0.000001, s.duration),
        )
      )
        throw Error("对象有效时间范围无效");
    }
    if (o.text !== undefined) {
      const t = o.text;
      if (
        !record(t) ||
        typeof t.text !== "string" ||
        t.text.length > 10000 ||
        !finite(t.x, -20000, 20000) ||
        !finite(t.y, -20000, 20000) ||
        !finite(t.size, 0.01, 4096)
      )
        throw Error(`对象 ${o.id} 文字格式无效`);
      if (t.width !== undefined && !finite(t.width, 0, 20000))
        throw Error("文字换行宽度无效");
      if (
        t.anchor !== undefined &&
        !["start", "middle", "end"].includes(t.anchor)
      )
        throw Error("文字对齐方式无效");
    }
  }
  const byId = new Map(s.objects.map((o) => [o.id, o]));
  for (const o of s.objects) {
    const visited = new Set([o.id]);
    let parent = o.parentId;
    while (parent) {
      if (!ids.has(parent)) throw Error(`对象 ${o.id} 的父对象不存在`);
      if (visited.has(parent) || visited.size > 32)
        throw Error("对象父子关系循环或超过32层");
      visited.add(parent);
      parent = byId.get(parent).parentId;
    }
  }
  if (
    s.assets !== undefined &&
    (!record(s.assets) || Object.keys(s.assets).length > 2000)
  )
    throw Error("来源素材表无效");
  for (const [alias, key] of Object.entries(s.assets || {})) {
    if (!SVG_ID.test(alias) || !Object.hasOwn(resources, key))
      throw Error(`来源素材引用失效：${alias}`);
    if (!/^(image|font)\//.test(resources[key].mime))
      throw Error(`Canvas 素材类型不支持：${alias}`);
  }
  if (s.fonts !== undefined && (!Array.isArray(s.fonts) || s.fonts.length > 32))
    throw Error("字体清单无效");
  for (const f of s.fonts || []) {
    if (
      !record(f) ||
      !Object.hasOwn(s.assets || {}, f.asset) ||
      !resources[s.assets[f.asset]].mime.startsWith("font/") ||
      typeof f.family !== "string" ||
      !f.family ||
      f.family.length > 100
    )
      throw Error("字体资源引用或名称无效");
  }
}
sourceRegistry.register("canvas-program-v1", {
  label: "Canvas 程序动画",
  validate: validateCanvasSource,
});
sourceRegistry.register("canvas-source-v1", {
  label: "Canvas 源码对象",
  validate: validateCanvasSource,
});

export function validateSource(id, source, version, resources = {}) {
  if (!record(source) || !finite(source.duration, 0.01, 7200))
    throw Error("来源时长或格式无效");
  sourceRegistry.get(source.type).validate(source, { id, version, resources });
}
export function canvasCatalog(id, source, scene = null) {
  let objects = scene
    ? source.objects.filter(
        (o) =>
          !o.ranges ||
          o.ranges.some(
            ([start, end]) =>
              start < (scene.hold ? scene.out + 1e-7 : scene.out) &&
              end > scene.in,
          ),
      )
    : source.objects;
  if (scene) {
    const map = new Map(source.objects.map((o) => [o.id, o])),
      ids = new Set(objects.map((o) => o.id));
    for (const object of objects) {
      let parent = object.parentId;
      while (parent && !ids.has(parent)) {
        ids.add(parent);
        parent = map.get(parent)?.parentId;
      }
    }
    objects = source.objects.filter((o) => ids.has(o.id));
  }
  return {
    objects: objects.map((o) => ({
      id: `${id}:o:${o.id}`,
      label: o.label,
      parentId: o.parentId ? `${id}:o:${o.parentId}` : null,
      cx: o.bounds[0] + o.bounds[2] / 2,
      cy: o.bounds[1] + o.bounds[3] / 2,
      capabilities: [
        "transform",
        "visibility",
        ...(o.text ? ["text"] : []),
        ...(Object.keys(o.parameters || {}).length ? ["parameters"] : []),
      ],
      parameters: o.parameters || {},
    })),
    texts: objects
      .filter((o) => o.text)
      .map((o) => {
        const variant =
          scene &&
          o.textVariants?.find(
            (v) => v.start <= scene.in + 1e-7 && v.end > scene.in,
          );
        const defaults = {
          font: "sans-serif",
          fill: "#252720",
          anchor: "start",
          width: 0,
          start: 0,
          end: 1e9,
          ...o.text,
          ...variant?.text,
        };
        return {
          id: `${id}:t:${o.id}`,
          objectId: `${id}:o:${o.id}`,
          font: "sans-serif",
          fill: "#252720",
          anchor: "start",
          width: 0,
          start: 0,
          end: 1e9,
          ...defaults,
          ...(o.textVariants ? { nativeDefault: defaults } : {}),
        };
      }),
  };
}
export function validateParameters(id, source, overrides = {}) {
  if (!record(overrides)) throw Error("对象参数覆盖格式无效");
  const declarations = new Map(
    (source.objects || []).map((o) => [`${id}:o:${o.id}`, o.parameters || {}]),
  );
  for (const [objectId, values] of Object.entries(overrides)) {
    const defs = declarations.get(objectId);
    if (!defs || !record(values))
      throw Error(`参数引用的对象不存在：${objectId}`);
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(defs, key))
        throw Error(`未知参数：${objectId}.${key}`);
      parameterValue(defs[key], value);
    }
  }
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
