import { wrapLines } from "./text-layout.mjs";
import { createCaptureSession } from "./canvas-capture.mjs";

let source,
  canvas,
  context,
  runtime,
  programFactory,
  assets = new Map(),
  declarations,
  prefix;
let assetSerial = 0;
let activeSegment = null,
  runtimeInitializations = 0;
const assetRequests = new Map();
const imageLoads = new Map();
const pendingImages = new Map(),
  usedImages = new Set();
function peekImage(alias) {
  usedImages.add(alias);
  const bitmap = assets.get(alias);
  if (bitmap) {
    assets.delete(alias);
    assets.set(alias, bitmap);
  }
  return bitmap;
}
function requestImage(alias) {
  usedImages.add(alias);
  if (!assets.has(alias) && !pendingImages.has(alias))
    pendingImages.set(alias, loadImage(alias));
}
const send = self.postMessage.bind(self);
function assetBlob(alias) {
  if (!Object.hasOwn(source.assets || {}, alias))
    return Promise.reject(Error(`素材别名不存在：${alias}`));
  const assetRequest = ++assetSerial;
  return new Promise((resolve, reject) => {
    assetRequests.set(assetRequest, { resolve, reject });
    send({ kind: "asset", assetRequest, alias });
  });
}
const validNumber = (n) =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e9;
function poseMatrix(pose = {}) {
  if (pose.matrix) {
    if (
      ["x", "y", "scale", "rotation", "origin"].some((key) =>
        Object.hasOwn(pose, key),
      )
    )
      throw Error("运动矩阵与分量变换不能同时提供");
    if (
      !Array.isArray(pose.matrix) ||
      pose.matrix.length !== 6 ||
      !pose.matrix.every(validNumber)
    )
      throw Error("对象运动矩阵无效");
    return pose.matrix;
  }
  const { x = 0, y = 0, scale = 1, rotation = 0, origin = [0, 0] } = pose;
  if (
    ![x, y, scale, rotation, ...origin].every(validNumber) ||
    origin.length !== 2 ||
    scale <= 0
  )
    throw Error("对象运动参数无效");
  const a = (rotation * Math.PI) / 180,
    c = Math.cos(a) * scale,
    s = Math.sin(a) * scale,
    [cx, cy] = origin;
  return [c, s, -s, c, x + cx - c * cx + s * cy, y + cy - s * cx - c * cy];
}
function applyLayout(ctx, object, edit) {
  const [x, y, w, h] = object.bounds,
    cx = x + w / 2,
    cy = y + h / 2;
  ctx.translate(edit.dx || 0, edit.dy || 0);
  ctx.translate(cx, cy);
  ctx.rotate(((edit.rotation || 0) * Math.PI) / 180);
  ctx.scale(edit.scale ?? 1, edit.scale ?? 1);
  ctx.translate(-cx, -cy);
}
async function initialize(data) {
  source = data.source;
  prefix = data.id;
  declarations = new Map(source.objects.map((o) => [o.id, o]));
  canvas = new OffscreenCanvas(source.canvas.width, source.canvas.height);
  context = canvas.getContext("2d");
  for (const f of source.fonts || []) {
    const face = new FontFace(
      f.family,
      await (await assetBlob(f.asset)).arrayBuffer(),
      { weight: f.weight || "normal", style: f.style || "normal" },
    );
    await face.load();
    self.fonts.add(face);
  }
  programFactory = new Function(
    "__prismSourceAssets",
    '"use strict";\n' + source.program,
  );
  await initializeRuntime();
}
async function initializeRuntime(state) {
  for (let attempt = 0; attempt < 64; attempt++) {
    try {
      runtime = await programFactory({
        image: loadImage,
        peekImage,
        requestImage,
      });
      runtimeInitializations++;
      if (state) runtime.restoreState?.(state);
      break;
    } catch (error) {
      if (!error.prismImage) throw error;
      await Promise.all(pendingImages.values());
      pendingImages.clear();
      if (attempt === 63)
        throw Error("初始化图像依赖过多，请将复杂预绘制拆成按时间绘制");
    }
  }
  if (!runtime || typeof runtime.render !== "function")
    throw Error("程序须返回包含 render(ctx, time, api) 的对象");
}
async function loadImage(alias) {
  if (assets.has(alias)) return assets.get(alias);
  if (!imageLoads.has(alias))
    imageLoads.set(
      alias,
      (async () => {
        const blob = await assetBlob(alias);
        if (!blob.type.startsWith("image/"))
          throw Error(`素材不是图片：${alias}`);
        const bitmap = await createImageBitmap(blob);
        if (bitmap.width > 16384 || bitmap.height > 16384) {
          bitmap.close();
          throw Error(`图片尺寸过大：${alias}`);
        }
        assets.set(alias, bitmap);
        return bitmap;
      })().finally(() => imageLoads.delete(alias)),
    );
  return imageLoads.get(alias);
}
async function render(data) {
  const started = performance.now();
  const {
      time,
      scene,
      pixelRatio = 1,
      inspecting = false,
      original = false,
    } = data,
    records = [],
    seen = new Set(),
    stack = [];
  const segment = `${data.segment ?? ""}:${Math.floor(time / 15)}`;
  if (
    source.type === "canvas-source-v1" &&
    runtime.dispose &&
    activeSegment !== null &&
    segment !== activeSegment
  ) {
    const state = runtime.exportState?.();
    runtime.dispose();
    runtime = null;
    await initializeRuntime(state);
  }
  activeSegment = segment;
  usedImages.clear();
  pendingImages.clear();
  const placeholder = new OffscreenCanvas(1, 1);
  const textMap = new Map(scene.texts.map((t) => [t.objectId, t]));
  const captureSession = createCaptureSession({
    source,
    prefix,
    scene,
    time,
    records,
    inspecting,
  });
  const width = Math.round(source.canvas.width * pixelRatio),
    height = Math.round(source.canvas.height * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.reset();
  const api = Object.freeze({
    width: source.canvas.width,
    height: source.canvas.height,
    previewOnly:
      Boolean(data.preview) &&
      !Object.keys(scene.objectOverrides || {}).length &&
      !Object.keys(scene.parameterOverrides || {}).length &&
      !scene.texts.some(
        (t) =>
          Object.keys(
            captureSession.textChanges(t.objectId?.slice(prefix.length + 3)),
          ).length,
      ),
    capture: captureSession.capture,
    textChanges: captureSession.textChanges,
    parameterChanges: captureSession.parameterChanges,
    image(alias) {
      if (!Object.hasOwn(source.assets || {}, alias))
        throw Error(`图片素材不存在：${alias}`);
      const bitmap = peekImage(alias);
      if (bitmap) return bitmap;
      requestImage(alias);
      return placeholder;
    },
    params(id) {
      const object = declarations.get(id);
      if (!object) throw Error(`对象不存在：${id}`);
      return Object.freeze({
        ...Object.fromEntries(
          Object.entries(object.parameters || {}).map(([k, d]) => [
            k,
            d.default,
          ]),
        ),
        ...scene.parameterOverrides?.[`${prefix}:o:${id}`],
      });
    },
    object(id, draw, pose = {}) {
      const o = declarations.get(id);
      if (!o) throw Error(`未登记的对象：${id}`);
      if (seen.has(id)) throw Error(`同一帧重复绘制对象：${id}`);
      if ((o.parentId || null) !== (stack.at(-1) || null))
        throw Error(`对象 ${id} 的绘制层级与清单不符`);
      seen.add(id);
      const edit = scene.objectOverrides[`${prefix}:o:${id}`] || {},
        matrix = poseMatrix(pose),
        bounds = pose.bounds || o.bounds;
      if (
        !Array.isArray(bounds) ||
        bounds.length !== 4 ||
        !bounds.every(validNumber) ||
        bounds[2] < 0 ||
        bounds[3] < 0
      )
        throw Error(`对象 ${id} 的动态边界无效`);
      const opacity = pose.opacity ?? 1;
      if (!validNumber(opacity) || opacity < 0 || opacity > 1)
        throw Error("对象透明度无效");
      records.push({
        id,
        bounds,
        matrix,
        visible: !edit.hidden && opacity > 0,
      });
      if (edit.hidden || opacity === 0) return;
      context.save();
      stack.push(id);
      try {
        applyLayout(context, o, edit);
        context.transform(...matrix);
        context.globalAlpha *= opacity;
        const result = draw(context, api.params(id), time);
        if (result?.then) throw Error("object 内的绘制函数须同步完成");
      } catch (error) {
        throw Error(`对象 ${id}：${error.message}`);
      } finally {
        stack.pop();
        context.restore();
      }
    },
    text(id, pose = {}) {
      const t = textMap.get(`${prefix}:o:${id}`);
      if (!t) throw Error(`文字对象不存在：${id}`);
      if (time < t.start || time >= t.end) return;
      context.font = `${t.size}px ${t.font}`;
      const lines = wrapLines(
          t.text,
          t.width,
          (s) => context.measureText(s).width,
        ),
        width = Math.max(0, ...lines.map((s) => context.measureText(s).width));
      const x =
        t.x -
        (t.anchor === "middle" ? width / 2 : t.anchor === "end" ? width : 0);
      api.object(
        id,
        (ctx) => {
          ctx.font = `${t.size}px ${t.font}`;
          ctx.fillStyle = t.fill;
          ctx.textAlign =
            t.anchor === "middle"
              ? "center"
              : t.anchor === "end"
                ? "right"
                : "left";
          ctx.textBaseline = "alphabetic";
          lines.forEach((line, i) =>
            ctx.fillText(line, t.x, t.y + i * t.size * 1.3),
          );
        },
        {
          ...pose,
          bounds: [x, t.y - t.size, width, t.size * 1.3 * lines.length],
        },
      );
      records.at(-1).text = t.text;
    },
  });
  const maxPasses = source.type === "canvas-source-v1" ? 64 : 4;
  for (let pass = 0; pass < maxPasses; pass++) {
    records.length = 0;
    seen.clear();
    stack.length = 0;
    context.reset();
    context.scale(pixelRatio, pixelRatio);
    const previousState = runtime.exportState?.();
    try {
      if (original) {
        if (typeof runtime.renderOriginal !== "function")
          throw Error("此来源没有原始画面对照入口");
        await runtime.renderOriginal(context, time);
      } else await runtime.render(context, time, api);
    } catch (error) {
      if (!error.prismImage) throw error;
      await Promise.all(pendingImages.values());
      pendingImages.clear();
      runtime.dispose?.();
      runtime = null;
      await initializeRuntime(previousState);
      if (pass === maxPasses - 1)
        throw Error("当前帧图片依赖过多，未能稳定绘制");
      continue;
    }
    if (!pendingImages.size) break;
    await Promise.all(pendingImages.values());
    pendingImages.clear();
    if (pass === maxPasses - 1)
      throw Error("图片依赖未能在四次绘制内稳定，请使用固定的素材别名");
  }
  let bytes = [...assets.values()].reduce(
    (sum, b) => sum + b.width * b.height * 4,
    0,
  );
  for (const [alias, bitmap] of assets) {
    if (bytes > 96 * 1024 ** 2 && !usedImages.has(alias)) {
      bytes -= bitmap.width * bitmap.height * 4;
      bitmap.close();
      assets.delete(alias);
    }
  }
  if (bytes > 256 * 1024 * 1024)
    throw Error("当前帧的解码图片超过 256 MiB，请降低素材分辨率");
  return {
    bitmap: canvas.transferToImageBitmap(),
    objects: records,
    preview: api.previewOnly && source.type === "canvas-source-v1",
    stats: {
      decodedImages: assets.size,
      imageBytes: bytes,
      usedImages: usedImages.size,
      renderMs: performance.now() - started,
      previewOnly: api.previewOnly,
      runtimeInitializations,
    },
  };
}
self.onmessage = async ({ data }) => {
  if (data.kind === "asset-reply") {
    const pending = assetRequests.get(data.assetRequest);
    if (!pending) return;
    assetRequests.delete(data.assetRequest);
    data.error ? pending.reject(Error(data.error)) : pending.resolve(data.blob);
    return;
  }
  try {
    if (data.kind === "init") {
      await initialize(data);
      send({ request: data.request, kind: "ready" });
    } else if (data.kind === "describe") {
      send({
        request: data.request,
        metadata: {
          ...(runtime.metadata || { duration: source.duration }),
          limitations: runtime.diagnostics?.() || [],
        },
      });
    } else if (
      data.kind === "render" ||
      data.kind === "inspect" ||
      data.kind === "original"
    ) {
      const result = await render({
        ...data,
        inspecting: data.kind === "inspect",
        original: data.kind === "original",
      });
      send({ request: data.request, ...result }, [result.bitmap]);
    } else throw Error("未知绘制请求");
  } catch (error) {
    send({
      request: data.request,
      error: String(error.message || error).slice(0, 2000),
    });
  }
};
