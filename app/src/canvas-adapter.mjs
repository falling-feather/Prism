import { canvasCatalog, validateCatalog } from "./source-contract.mjs";
import { resourceUrl } from "./resources.mjs";
import { element } from "./svg-utils.mjs";
import { createSandboxWorker } from "./canvas-sandbox.mjs";

export function createCanvasAdapter(id, source, host, project) {
  const catalog = canvasCatalog(id, source),
    nodes = new Map(),
    wrappers = new Map(),
    motions = new Map();
  const scoped = source.objects.some((o) => o.ranges),
    sceneCatalogs = new WeakMap(),
    visibleMotions = new Set();
  const viewport = element(
    "svg",
    {
      viewBox: `0 0 ${source.canvas.width} ${source.canvas.height}`,
      width: "100%",
      height: "100%",
    },
    host,
  );
  const foreign = element(
    "foreignObject",
    {
      x: 0,
      y: 0,
      width: source.canvas.width,
      height: source.canvas.height,
      "data-canvas-frame": id,
      "pointer-events": "none",
    },
    viewport,
  );
  const canvas = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas",
  );
  canvas.width = 1;
  canvas.height = 1;
  canvas.style.cssText = "display:block;width:100%;height:100%";
  foreign.append(canvas);
  const painter = canvas.getContext("2d"),
    proxy = element("g", { "data-proxies": id }, viewport);
  const appliedOverrides = new Map(),
    definitions = new Map(source.objects.map((o) => [o.id, o])),
    catalogById = new Map(catalog.objects.map((o) => [o.id, o]));
  let proxyScene = null,
    proxyCount = -1;
  function ensureProxies(scene) {
    if (proxyScene === scene.id && proxyCount === scene.objects.length) return;
    proxyScene = scene.id;
    proxyCount = scene.objects.length;
    proxy.replaceChildren();
    nodes.clear();
    wrappers.clear();
    motions.clear();
    visibleMotions.clear();
    appliedOverrides.clear();
    const local = scene.objects
      .map((o) => definitions.get(o.id.slice(id.length + 3)))
      .filter(Boolean);
    for (const o of local) {
      const objectId = `${id}:o:${o.id}`,
        layout = element("g", { "data-layout-id": objectId }),
        motion = element("g", { "data-motion-id": o.id }, layout);
      motion.style.display = "none";
      const node = element("g", { "data-node-id": objectId }, motion);
      element(
        "rect",
        {
          "data-proxy-bounds": "1",
          x: o.bounds[0],
          y: o.bounds[1],
          width: o.bounds[2],
          height: o.bounds[3],
          fill: "transparent",
          "pointer-events": "all",
        },
        node,
      );
      nodes.set(objectId, node);
      wrappers.set(objectId, layout);
      motions.set(o.id, motion);
    }
    for (const o of local)
      (nodes.get(`${id}:o:${o.parentId}`) || proxy).append(
        wrappers.get(`${id}:o:${o.id}`),
      );
  }
  let worker = null,
    initializing = null,
    serial = 0,
    current = null,
    queued = null,
    disposed = false,
    version = 0,
    assetController = null;
  let lastStats = {};
  const requests = new Map();
  function stop(reason) {
    version++;
    worker?.terminate();
    worker = null;
    initializing = null;
    assetController?.abort();
    assetController = null;
    for (const r of requests.values()) {
      clearTimeout(r.timer);
      r.reject(reason);
    }
    requests.clear();
  }
  function call(kind, payload) {
    const request = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          stop(
            Error(
              `来源 ${id} 的${kind === "init" ? "初始化" : "绘制"}超过 10 秒`,
            ),
          ),
        10000,
      );
      requests.set(request, { resolve, reject, timer });
      worker.postMessage({ kind, request, ...payload });
    });
  }
  function initialize() {
    if (initializing) return initializing;
    initializing = (async () => {
      const generation = version;
      if (disposed || generation !== version) throw Error("绘制已取消");
      const embedded = document.querySelector("#prism-worker");
      assetController = new AbortController();
      const signal = assetController.signal;
      let workerSource;
      if (embedded) workerSource = JSON.parse(embedded.textContent);
      else {
        const response = await fetch("/api/runtime/canvas-worker", { signal });
        if (!response.ok) throw Error("绘制运行时载入失败");
        workerSource = await response.text();
      }
      const transport = await createSandboxWorker(workerSource, signal);
      if (disposed || generation !== version) {
        transport.terminate();
        throw Error("绘制已取消");
      }
      worker = transport;
      const activeWorker = worker;
      worker.onmessage = ({ data }) => {
        if (data.kind === "asset") {
          (async () => {
            try {
              if (!Object.hasOwn(source.assets || {}, data.alias))
                throw Error("素材别名没有登记");
              const key = source.assets[data.alias],
                response = await fetch(resourceUrl(project, key), { signal });
              if (!response.ok) throw Error(`素材载入失败：${data.alias}`);
              const blob = new Blob([await response.blob()], {
                type: project.resources[key].mime,
              });
              if (worker === activeWorker)
                activeWorker.postMessage({
                  kind: "asset-reply",
                  assetRequest: data.assetRequest,
                  blob,
                });
            } catch (error) {
              if (worker === activeWorker)
                activeWorker.postMessage({
                  kind: "asset-reply",
                  assetRequest: data.assetRequest,
                  error: error.message,
                });
            }
          })();
          return;
        }
        const pending = requests.get(data.request);
        if (!pending) {
          data.bitmap?.close();
          return;
        }
        clearTimeout(pending.timer);
        requests.delete(data.request);
        if (data.error) {
          const error = Error(`来源 ${id}：${data.error}`);
          pending.reject(error);
          stop(error);
        } else pending.resolve(data);
      };
      worker.onerror = (event) => {
        stop(Error(`来源 ${id}：${event.message}`));
      };
      await call("init", { id, source });
    })();
    return initializing;
  }
  function applyFrame(result) {
    try {
      lastStats = result.stats || {};
      if (
        !(result.bitmap instanceof ImageBitmap) ||
        !Array.isArray(result.objects) ||
        result.objects.length > source.objects.length
      )
        throw Error("Canvas 返回的画面或对象清单无效");
      if (
        canvas.width !== result.bitmap.width ||
        canvas.height !== result.bitmap.height
      ) {
        canvas.width = result.bitmap.width;
        canvas.height = result.bitmap.height;
      }
      painter.clearRect(0, 0, canvas.width, canvas.height);
      painter.drawImage(result.bitmap, 0, 0);
      proxy.style.pointerEvents = result.preview ? "none" : "";
      proxy.style.visibility = result.preview ? "hidden" : "";
      if (result.preview) return;
      for (const motion of visibleMotions) motion.style.display = "none";
      visibleMotions.clear();
      for (const object of result.objects) {
        const motion = motions.get(object.id),
          node = nodes.get(`${id}:o:${object.id}`);
        if (!motion && definitions.has(object.id)) continue;
        if (
          !motion ||
          !Array.isArray(object.matrix) ||
          object.matrix.length !== 6 ||
          !object.matrix.every(Number.isFinite) ||
          !Array.isArray(object.bounds) ||
          object.bounds.length !== 4 ||
          !object.bounds.every(Number.isFinite)
        )
          throw Error("Canvas 返回了无效对象几何");
        motion.style.display = object.visible ? "" : "none";
        if (object.visible) visibleMotions.add(motion);
        motion.setAttribute("transform", `matrix(${object.matrix.join(" ")})`);
        const bounds = node.querySelector(":scope > [data-proxy-bounds]");
        if (object.text !== undefined) {
          if (typeof object.text !== "string" || object.text.length > 10000)
            throw Error("Canvas 返回了无效文字");
          node.setAttribute("data-source-text", object.text);
        }
        ["x", "y", "width", "height"].forEach((key, i) =>
          bounds.setAttribute(key, object.bounds[i]),
        );
        const wrapper = wrappers.get(`${id}:o:${object.id}`);
        wrapper.parentElement.append(wrapper);
      }
    } finally {
      result.bitmap?.close();
    }
  }
  async function drain() {
    if (current || !queued) return;
    const request = queued;
    queued = null;
    current = request;
    try {
      await initialize();
      const result = await call("render", {
        scene: request.scene,
        time: request.time,
        pixelRatio: request.pixelRatio,
        preview: request.presentIntermediate,
        segment: request.sceneId,
      });
      if (
        !disposed &&
        request.sceneId === proxyScene
      )
        applyFrame(result);
      else result.bitmap?.close();
      request.resolve();
    } catch (error) {
      request.reject(error);
    } finally {
      current = null;
      drain();
    }
  }
  return {
    host,
    ...catalog,
    nodes,
    wrappers,
    appliedOverrides,
    stats: () => ({
      ...lastStats,
      proxyObjects: nodes.size,
      sourceObjects: source.objects.length,
      pending: requests.size,
      queued: Boolean(queued),
      pixels: canvas.width * canvas.height,
    }),
    validateScene: (scene) => {
      const matching = scoped
        ? {
            objects: catalog.objects.filter((o) =>
              scene.objects.some((v) => v.id === o.id),
            ),
            texts: catalog.texts.filter((t) =>
              scene.texts.some((v) => v.id === t.id),
            ),
          }
        : catalog;
      validateCatalog(scene, matching);
      for (const object of scene.objects) {
        const original = catalogById.get(object.id);
        if (
          object.cx !== original.cx ||
          object.cy !== original.cy ||
          JSON.stringify(object.parameters || {}) !==
            JSON.stringify(original.parameters)
        )
          throw Error(`对象 ${object.id} 的声明与来源不一致`);
      }
    },
    syncCatalog: scoped
      ? (scene) => {
          const signature = `${scene.in}:${scene.out}:${scene.hold}`;
          if (sceneCatalogs.get(scene) === signature) return;
          const expected = canvasCatalog(id, source, scene);
          for (const key of ["objects", "texts"]) {
            const ids = new Map(scene[key].map((v) => [v.id, v]));
            for (const item of expected[key]) {
              const existing = ids.get(item.id);
              if (!existing) scene[key].push(structuredClone(item));
              else if (
                key === "texts" &&
                existing.nativeDefault &&
                item.nativeDefault
              ) {
                for (const [field, value] of Object.entries(item.nativeDefault))
                  if (existing[field] === existing.nativeDefault[field])
                    existing[field] = value;
                existing.nativeDefault = structuredClone(item.nativeDefault);
              }
            }
          }
          sceneCatalogs.set(scene, signature);
        }
      : null,
    renderSource(scene, time, options = {}) {
      if (disposed) return Promise.reject(Error("来源已释放"));
      ensureProxies(scene);
      return new Promise((resolve, reject) => {
        if (queued) queued.resolve();
        queued = {
          sceneId: scene.id,
          scene: structuredClone({
            texts: scene.texts,
            objectOverrides: scene.objectOverrides,
            parameterOverrides: scene.parameterOverrides,
          }),
          time,
          presentIntermediate: Boolean(options.presentIntermediate),
          pixelRatio: Math.min(
            4096 / Math.max(source.canvas.width, source.canvas.height),
            options.pixelRatio ??
              (options.outputWidth
                ? options.outputWidth / source.canvas.width
                : Math.max(
                    0.25,
                    Math.min(
                      1,
                      Math.min(
                        viewport.getBoundingClientRect().width /
                          source.canvas.width,
                        viewport.getBoundingClientRect().height /
                          source.canvas.height,
                      ) * Math.min(1.5, globalThis.devicePixelRatio || 1),
                    ),
                  )),
          ),
          resolve,
          reject,
        };
        drain();
      });
    },
    async inspect(time) {
      await initialize();
      return call("inspect", {
        time,
        pixelRatio: 1,
        scene: {
          texts: [],
          objects: [],
          objectOverrides: {},
          parameterOverrides: {},
        },
      });
    },
    async describe() {
      await initialize();
      return (await call("describe", {})).metadata;
    },
    async inspectOriginal(time) {
      await initialize();
      return call("original", {
        time,
        pixelRatio: 1,
        scene: {
          texts: [],
          objects: [],
          objectOverrides: {},
          parameterOverrides: {},
        },
      });
    },
    async compareOriginal(time) {
      await initialize();
      const scene = {
        texts: [],
        objects: [],
        objectOverrides: {},
        parameterOverrides: {},
      };
      const first = await call("original", { time, pixelRatio: 1, scene });
      let second;
      try {
        second = await call("inspect", { time, pixelRatio: 1, scene });
        const sample = new OffscreenCanvas(320, 180),
          c = sample.getContext("2d", { willReadFrequently: true });
        c.drawImage(first.bitmap, 0, 0, 320, 180);
        const a = c.getImageData(0, 0, 320, 180).data;
        c.clearRect(0, 0, 320, 180);
        c.drawImage(second.bitmap, 0, 0, 320, 180);
        const b = c.getImageData(0, 0, 320, 180).data;
        let error = 0;
        for (let i = 0; i < a.length; i++) error += Math.abs(a[i] - b[i]);
        return error / a.length;
      } finally {
        first.bitmap.close();
        second?.bitmap.close();
      }
    },
    snapshot(clone) {
      const target = clone.querySelector("[data-canvas-frame]");
      if (target) {
        const image = element("image", {
          x: 0,
          y: 0,
          width: source.canvas.width,
          height: source.canvas.height,
          href: canvas.toDataURL("image/png"),
        });
        target.replaceWith(image);
      }
      clone.querySelector("[data-proxies]")?.remove();
    },
    deactivate() {
      queued?.resolve();
      queued = null;
      stop(Error("镜头切换，绘制已取消"));
      canvas.width = 1;
      canvas.height = 1;
      proxy.replaceChildren();
      nodes.clear();
      wrappers.clear();
      motions.clear();
      visibleMotions.clear();
      appliedOverrides.clear();
      proxyScene = null;
      proxyCount = -1;
    },
    dispose() {
      disposed = true;
      queued?.resolve();
      queued = null;
      stop(Error("绘制已取消"));
    },
  };
}
