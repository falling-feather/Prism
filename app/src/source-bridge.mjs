import { observeWebGL } from "./webgl-bridge.mjs";
/** Runtime observation of source drawing helpers. Original source stays authoritative. */
export function createSourceBridge() {
  const contextInfo = new WeakMap(),
    assetTags = new WeakMap();
  const lazyImages = new WeakMap();
  let imageProvider;
  function resolveImage(image) {
    const alias = image && lazyImages.get(image);
    if (!alias) return image;
    const bitmap = imageProvider.peek(alias);
    if (bitmap) return bitmap;
    imageProvider.request(alias);
    const error = Error("绘制需要图片：" + alias);
    error.prismImage = alias;
    throw error;
  }
  function paintMethod(c, name, args) {
    if (name === "drawImage") args = [resolveImage(args[0]), ...args.slice(1)];
    return c[name](...args);
  }
  const limitations = new Map();
  const identity = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const inv = (a) => {
    const d = a[0] * a[3] - a[1] * a[2];
    if (Math.abs(d) < 1e-12) return null;
    return [
      a[3] / d,
      -a[1] / d,
      -a[2] / d,
      a[0] / d,
      (a[2] * a[5] - a[3] * a[4]) / d,
      (a[1] * a[4] - a[0] * a[5]) / d,
    ];
  };
  const values = (m) => [m.a, m.b, m.c, m.d, m.e, m.f];
  const point = (m, x, y) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const rect = (m, b) => {
    const p = [
      [b[0], b[1]],
      [b[0] + b[2], b[1]],
      [b[0], b[1] + b[3]],
      [b[0] + b[2], b[1] + b[3]],
    ].map(([x, y]) => point(m, x, y));
    const xs = p.map((v) => v[0]),
      ys = p.map((v) => v[1]);
    return [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ];
  };
  const union = (a, b) =>
    !a
      ? b
      : [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[0] + a[2], b[0] + b[2]) - Math.min(a[0], b[0]),
          Math.max(a[1] + a[3], b[1] + b[3]) - Math.min(a[1], b[1]),
        ];
  function hash(text) {
    let a = 2166136261,
      b = 2246822519;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
    }
    return (
      (a >>> 0).toString(16).padStart(8, "0") +
      (b >>> 0).toString(16).padStart(8, "0")
    );
  }
  let phase = null,
    api = null,
    root = null,
    stack = [],
    groups = [],
    counts = new Map(),
    measured = new Map(),
    edges = new Map(),
    callsite = null,
    lastText = null,
    resourceRevision = 0;
  let surfaces = new WeakMap();
  function surface(canvas) {
    if (!surfaces.has(canvas)) surfaces.set(canvas, { canvas });
    return surfaces.get(canvas);
  }
  const nativeGet = Symbol.for("prism.nativeGetContext");
  const originalGet = (OffscreenCanvas.prototype[nativeGet] ||=
    OffscreenCanvas.prototype.getContext);
  const glContexts = new WeakMap();
  const ownedGL = new Set();
  const contexts = new Set();
  let contextRevision = 0;
  let startup = [];
  const styleFields = [
    "font",
    "textAlign",
    "textBaseline",
    "direction",
    "fontKerning",
    "fontStretch",
    "fontVariantCaps",
    "letterSpacing",
    "wordSpacing",
    "lineWidth",
    "lineCap",
    "lineJoin",
    "miterLimit",
    "lineDashOffset",
    "shadowBlur",
    "shadowColor",
    "shadowOffsetX",
    "shadowOffsetY",
    "imageSmoothingEnabled",
    "imageSmoothingQuality",
    "globalAlpha",
    "globalCompositeOperation",
    "filter",
    "fillStyle",
    "strokeStyle",
  ];
  function restorePath(info, path) {
    const transform = info.real.getTransform();
    info.real.beginPath();
    for (const [method, args, matrix] of path) {
      info.real.setTransform(...matrix);
      info.real[method](...args);
    }
    info.real.setTransform(transform);
    info.path = path.slice();
  }
  function checkpoint() {
    for (const reference of contexts) {
      const info = reference.deref();
      if (!info) {
        contexts.delete(reference);
        continue;
      }
      info.real.save();
      info.checkpoint = { depth: info.depth, path: info.path.slice() };
    }
  }
  function rollback() {
    for (const reference of contexts) {
      const info = reference.deref(),
        saved = info?.checkpoint;
      if (!saved) continue;
      while (info.depth > saved.depth) {
        info.real.restore();
        info.depth--;
      }
      info.real.restore();
      info.checkpoint = null;
      restorePath(info, saved.path);
    }
  }
  const paintNames = new Set([
    "drawImage",
    "fillText",
    "strokeText",
    "fill",
    "stroke",
    "fillRect",
    "strokeRect",
  ]);
  const pathNames = new Set([
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "quadraticCurveTo",
    "arc",
    "arcTo",
    "ellipse",
    "rect",
    "roundRect",
    "closePath",
  ]);
  function boundsForPath(info, matrix) {
    let b = null;
    for (const command of info.path) {
      const [name, a, m] = command;
      let local;
      if (name === "rect" || name === "roundRect")
        local = [a[0], a[1], a[2], a[3]];
      else if (name === "arc")
        local = [a[0] - a[2], a[1] - a[2], a[2] * 2, a[2] * 2];
      else if (name === "ellipse")
        local = [a[0] - a[2], a[1] - a[3], a[2] * 2, a[3] * 2];
      else {
        const pairs =
          name === "closePath"
            ? []
            : a.slice(0, name === "arcTo" ? 4 : undefined);
        if (!pairs.length) continue;
        const xs = pairs.filter((_, i) => i % 2 === 0),
          ys = pairs.filter((_, i) => i % 2 === 1);
        local = [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        ];
      }
      b = union(b, rect(m, local));
    }
    const inverse = inv(matrix);
    return b && inverse ? rect(inverse, b) : null;
  }
  function methodBounds(info, name, args) {
    const c = info.real;
    if (name === "drawImage") {
      const image = args[0];
      let x, y, w, h;
      if (args.length === 3) {
        [, x, y] = args;
        w = image.width;
        h = image.height;
      } else if (args.length === 5) {
        [, x, y, w, h] = args;
      } else [, , , , , x, y, w, h] = args;
      return [x, y, w, h];
    }
    if (name === "fillRect" || name === "strokeRect") return args.slice(0, 4);
    if (name === "fillText" || name === "strokeText") {
      const t = c.measureText(String(args[0])),
        x = args[1],
        y = args[2],
        fontSize = parseFloat(c.font.match(/[\d.]+px/)?.[0]) || 24;
      const width = t.width,
        left =
          c.textAlign === "center"
            ? x - width / 2
            : ["right", "end"].includes(c.textAlign)
              ? x - width
              : x;
      return [
        left,
        y - (t.actualBoundingBoxAscent || fontSize),
        width,
        (t.actualBoundingBoxAscent || fontSize) +
          (t.actualBoundingBoxDescent || fontSize * 0.2),
      ];
    }
    return boundsForPath(info, values(c.getTransform()));
  }
  function imageMatrix(c, image, args) {
    let sx = 0,
      sy = 0,
      sw = image.width,
      sh = image.height,
      dx,
      dy,
      dw = sw,
      dh = sh;
    if (args.length === 3) [, dx, dy] = args;
    else if (args.length === 5) [, dx, dy, dw, dh] = args;
    else [, sx, sy, sw, sh, dx, dy, dw, dh] = args;
    return mul(values(c.getTransform()), [
      dw / sw,
      0,
      0,
      dh / sh,
      dx - (sx * dw) / sw,
      dy - (sy * dh) / sh,
    ]);
  }
  function paint(info, name, args) {
    const c = info.real;
    if (info.muted) return;
    if ((name === "fill" || name === "stroke") && args[0] instanceof Path2D) {
      const origin = callsite?.origin ||
        stack.at(-1)?.origin || { file: "runtime", line: 0, column: 0 };
      limitations.set(JSON.stringify(origin), {
        kind: "path2d",
        origin,
        message: "此Path2D未提供可恢复的路径边界，暂不作为独立编辑对象",
      });
      return c[name](...args);
    }
    if (name === "fillText" || name === "strokeText") {
      const owner = [...groups]
          .reverse()
          .find((g) => g.ctx === info.proxy && g.def.kind === "text"),
        edits = owner?.textEdits || {};
      if (Object.keys(edits).length) {
        const beforeFont = c.font,
          beforeFill = c.fillStyle,
          beforeStroke = c.strokeStyle,
          beforeAlign = c.textAlign;
        if (edits.size !== undefined)
          c.font = c.font.replace(/[\d.]+px/, edits.size + "px");
        if (edits.font !== undefined)
          c.font = c.font.replace(/([\d.]+px)\s+.+$/, "$1 " + edits.font);
        if (edits.fill !== undefined) {
          c.fillStyle = edits.fill;
          if (edits.strokeOnly) c.strokeStyle = edits.fill;
        }
        if (edits.anchor !== undefined)
          c.textAlign =
            edits.anchor === "middle"
              ? "center"
              : edits.anchor === "end"
                ? "right"
                : "left";
        const adjusted = args.slice();
        if (owner.def.text.x < 0 && edits.offsetX !== undefined)
          adjusted[1] += edits.offsetX;
        if (owner.def.text.y < 0 && edits.offsetY !== undefined)
          adjusted[2] += edits.offsetY;
        owner.textEdits = {};
        try {
          return paint(info, name, adjusted);
        } finally {
          owner.textEdits = edits;
          c.font = beforeFont;
          c.fillStyle = beforeFill;
          c.strokeStyle = beforeStroke;
          c.textAlign = beforeAlign;
        }
      }
    }
    if (name === "drawImage") {
      const image = args[0],
        tag = assetTags.get(image);
      if (tag) assetTags.set(c.canvas, tag);
      if (phase === "measure" && image instanceof OffscreenCanvas) {
        const buffer = surface(image),
          list = edges.get(buffer) || [];
        list.push({
          target: surface(c.canvas),
          matrix: imageMatrix(c, image, args),
          opacity: c.globalAlpha,
        });
        edges.set(buffer, list);
      }
    }
    if (phase === "measure" && c.globalAlpha > 0) {
      let b = methodBounds(info, name, args);
      if (b && name.startsWith("stroke")) {
        const pad = c.lineWidth / 2;
        b = [b[0] - pad, b[1] - pad, b[2] + pad * 2, b[3] + pad * 2];
      }
      if (b && b.every(Number.isFinite))
        for (const g of groups.filter((g) => g.ctx === info.proxy)) {
          const inverse = inv(g.base);
          if (!inverse) continue;
          g.bounds = union(
            g.bounds,
            rect(mul(inverse, values(c.getTransform())), b),
          );
          if (name === "drawImage" && assetTags.has(args[0])) {
            g.external = true;
            g.asset = assetTags.get(args[0]);
          }
          if (name === "fillText" || name === "strokeText") {
            g.textPaint ||= {
              font: c.font,
              anchor: c.textAlign,
              baseline: c.textBaseline,
              x: args[1],
              y: args[2],
              paintMode: "stroke",
            };
            if (name === "fillText") {
              g.textPaint.fill = c.fillStyle;
              g.textPaint.paintMode = "fill";
            } else g.textPaint.fill ??= c.strokeStyle;
          }
        }
    }
    if (
      ((name === "fillText" || name === "strokeText") &&
        !groups.some((g) => g.ctx === info.proxy && g.def.kind === "text")) ||
      (!groups.some((g) => g.ctx === info.proxy) &&
        !(name === "drawImage" && !assetTags.has(args[0])))
    ) {
      const previous = callsite;
      callsite ||= {
        id:
          "runtime-" +
          hash(
            stack.map((s) => s.id).join("/") +
              "|" +
              (name.includes("Text") ? "text" : name),
          ),
        origin: stack.at(-1)?.origin || { file: "runtime", line: 0, column: 0 },
      };
      if ((name === "fill" || name === "stroke") && args[0] instanceof Path2D)
        limitations.set(callsite.id, {
          kind: "path2d",
          origin: callsite.origin,
          message: "此Path2D未提供可恢复的路径边界，暂不作为独立编辑对象",
        });
      try {
        return primitive(info, name, args);
      } finally {
        callsite = previous;
      }
    }
    return paintMethod(c, name, args);
  }
  function primitive(info, name, args) {
    const c = info.real,
      def = {
        ...callsite,
        name,
        kind: name.includes("Text")
          ? "text"
          : name === "drawImage"
            ? "image"
            : "vector",
        identity: -1,
      };
    const pair =
      name === "fillText" &&
      lastText?.ctx === c &&
      lastText.call === def.id &&
      lastText.method === "strokeText" &&
      lastText.text === String(args[0]) &&
      lastText.x === args[1] &&
      lastText.y === args[2];
    stack.push(def);
    const id = pair ? lastText.id : keyFor(def, args);
    stack.pop();
    if (name.includes("Text"))
      lastText = {
        ctx: c,
        call: def.id,
        method: name,
        id,
        text: String(args[0]),
        x: args[1],
        y: args[2],
      };
    else lastText = null;
    const edited = args.slice(),
      textEdit = def.kind === "text" ? api.textChanges?.(id) || {} : {};
    const font = c.font,
      fill = c.fillStyle,
      stroke = c.strokeStyle,
      align = c.textAlign;
    if (textEdit.text !== undefined) edited[0] = textEdit.text;
    if (textEdit.x !== undefined) edited[1] = textEdit.x;
    if (textEdit.y !== undefined) edited[2] = textEdit.y;
    if (textEdit.size !== undefined)
      c.font = c.font.replace(/[\d.]+px/, textEdit.size + "px");
    if (textEdit.font !== undefined)
      c.font = c.font.replace(/([\d.]+px)\s+.+$/, "$1 " + textEdit.font);
    if (textEdit.fill !== undefined) {
      c.fillStyle = textEdit.fill;
      if (textEdit.strokeOnly) c.strokeStyle = textEdit.fill;
    }
    if (textEdit.anchor !== undefined)
      c.textAlign =
        textEdit.anchor === "middle"
          ? "center"
          : textEdit.anchor === "end"
            ? "right"
            : "left";
    const base = values(c.getTransform());
    let bounds = methodBounds(info, name, edited);
    if (bounds && name.startsWith("stroke")) {
      const pad = c.lineWidth / 2;
      bounds = [
        bounds[0] - pad,
        bounds[1] - pad,
        bounds[2] + pad * 2,
        bounds[3] + pad * 2,
      ];
    }
    const invoke = () => {
      if (
        (name === "fill" || name === "stroke") &&
        info.path.length &&
        !(args[0] instanceof Path2D)
      ) {
        if (
          values(c.getTransform()).every((v, i) => Math.abs(v - base[i]) < 1e-9)
        )
          return c[name](...edited);
        const path = info.path.slice(),
          inverse = inv(base),
          delta = inverse ? mul(values(c.getTransform()), inverse) : identity;
        c.beginPath();
        for (const [method, a, m] of path) {
          c.setTransform(...mul(delta, m));
          c[method](...a);
        }
        c.setTransform(...mul(delta, base));
        c[name](...edited);
        c.beginPath();
        for (const [method, a, m] of path) {
          c.setTransform(...m);
          c[method](...a);
        }
        c.setTransform(...mul(delta, base));
        return;
      }
      return paintMethod(c, name, edited);
    };
    try {
      if (phase === "measure") {
        if (bounds && bounds[2]>0.00001 && bounds[3]>0.00001 && c.globalAlpha > 0) {
          const item = {
            id,
            ctx: info.proxy,
            surface: surface(c.canvas),
            def,
            base,
            bounds,
            parent: groups.at(-1)?.id || null,
            external: name === "drawImage",
            asset: assetTags.get(args[0]),
            args: edited,
          };
          if (def.kind === "text") {
            const size = parseFloat(c.font.match(/[\d.]+px/)?.[0]) || 24;
            const paintValue=name==='strokeText'?c.strokeStyle:c.fillStyle;
            const solid=typeof paintValue==='string';
            if(!solid)limitations.set('text-paint:'+def.id,{kind:'text-paint',origin:def.origin,message:'渐变或图案文字保持源码填充；当前可改正文和字号，暂不提供填充色停靠点编辑。'});
            item.declaration = {
              id,
              label: "文字 · " + String(edited[0]).slice(0, 60),
              bounds,
              parentId: null,
              origin: def.origin,
              text: {
                text: String(edited[0]),
                x: edited[1],
                y: edited[2],
                size,
                font: c.font.replace(/^.*?[\d.]+px\s*/, ""),
                fill: solid?paintValue:'#26324f',
                anchor:
                  c.textAlign === "center"
                    ? "middle"
                    : ["right", "end"].includes(c.textAlign)
                      ? "end"
                      : "start",
                width: 0,
                start: 0,
                end: 1e9,
                paintMode: name === "strokeText" ? "stroke" : "fill",
                editableFields: ["text", "x", "y", "size", "font", ...(solid?['fill']:[])],
              },
            };
          }
          measured.set(id, item);
        }
        return invoke();
      }
      const item = measured.get(id);
      if (!item?.toOutput) return invoke();
      return api.capture(id, info.proxy, invoke, {
        bounds: item.bounds,
        toOutput: item.toOutput,
        visible: item.visible,
        text: item.declaration.text?.text,
        declaration: item.declaration,
        withoutPainting: (fn) => mute(info.proxy, fn),
      });
    } finally {
      c.font = font;
      c.fillStyle = fill;
      c.strokeStyle = stroke;
      c.textAlign = align;
    }
  }
  OffscreenCanvas.prototype.getContext = function (type, ...options) {
    const c = originalGet.call(this, type, ...options);
    if ((type === "webgl" || type === "webgl2") && c) {
      if (!glContexts.has(c)) {
        ownedGL.add(c);
        glContexts.set(
          c,
          observeWebGL(c, {
            measuring: () => phase === "measure",
            snapshot: surface,
            resolveImage,
            limitation: (kind, message) =>
              limitations.set(kind, { kind, message }),
            connect(source, target, matrix) {
              const list = edges.get(source) || [];
              const output = surface(target);
              if (
                !list.some(
                  (e) =>
                    e.target === output &&
                    e.matrix.every((v, i) => v === matrix[i]),
                )
              )
                list.push({ target: output, matrix, opacity: 1 });
              edges.set(source, list);
            },
          }),
        );
      }
      return glContexts.get(c);
    }
    if (type !== "2d" || !c) return c;
    if (contextInfo.has(c)) return contextInfo.get(c).proxy;
    const info = {
      real: c,
      proxy: null,
      path: [],
      methods: new Map(),
      muted: 0,
      depth: 0,
    };
    contexts.add(new WeakRef(info));
    contextRevision++;
    const proxy = new Proxy(c, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== "function") return value;
        if (info.methods.has(key)) return info.methods.get(key);
        const fn = (...args) => {
          if (info.muted && key === "clearRect") return;
          if (key === "drawImage") {
            const tag = assetTags.get(args[0]);
            if (tag) assetTags.set(target.canvas, tag);
          }
          if (key === "save") info.depth++;
          if (key === "restore") {
            if (!info.depth) return;
            if (info.checkpoint && info.depth === info.checkpoint.depth)
              throw Error("Canvas跨绘制阶段恢复了旧save，无法稳定隔离测量");
            info.depth--;
          }
          if (
            phase === "measure" &&
            (key === "reset" ||
              (key === "clearRect" &&
                args[0] <= 0 &&
                args[1] <= 0 &&
                args[2] >= target.canvas.width &&
                args[3] >= target.canvas.height &&
                values(target.getTransform()).every(
                  (v, i) => v === identity[i],
                )))
          )
            surfaces.set(target.canvas, { canvas: target.canvas });
          if (key === "beginPath" || key === "reset") info.path = [];
          else if (pathNames.has(key))
            info.path.push([key, args, values(target.getTransform())]);
          if (paintNames.has(key) && (phase === "measure" || phase === "paint"))
            return paint(info, key, args);
          if (key === "drawImage") return paintMethod(target, key, args);
          const result = value.apply(target, args);
          if (key === "reset") {
            info.depth = 0;
            info.checkpoint = null;
          }
          return result;
        };
        info.methods.set(key, fn);
        return fn;
      },
      set(target, key, value) {
        if (key === "font" && phase) {
          const owner = [...groups]
              .reverse()
              .find((g) => g.ctx === proxy && g.def.kind === "text"),
            edits = owner?.textEdits || {};
          if (edits.size !== undefined)
            value = String(value).replace(/[\d.]+px/, edits.size + "px");
          if (edits.font !== undefined)
            value = String(value).replace(
              /([\d.]+px)\s+.+$/,
              "$1 " + edits.font,
            );
        }
        target[key] = value;
        return true;
      },
    });
    info.proxy = proxy;
    contextInfo.set(c, info);
    contextInfo.set(proxy, info);
    return proxy;
  };
  function keyFor(def, args) {
    const base = stack.map((x) => x.id).join("/");
    const identityPart = def.identity >= 0 ? String(args[def.identity]) : "";
    const groupKey = base + "|" + identityPart,
      index = counts.get(groupKey) || 0;
    counts.set(groupKey, index + 1);
    return "source-" + hash(groupKey + "#" + index);
  }
  function textArgs(def, args, id) {
    if (!def.text) return args;
    const edits = api?.textChanges?.(id) || {};
    if (!Object.keys(edits).length) return args;
    const next = args.slice(),
      m = def.text;
    for (const field of ["text", "x", "y", "size", "fill"])
      if (m[field] >= 0 && edits[field] !== undefined)
        next[m[field]] = edits[field];
    if (m.options >= 0) {
      next[m.options] = { ...next[m.options] };
      if (edits.font !== undefined) next[m.options].font = edits.font;
      if (edits.anchor !== undefined)
        next[m.options].align =
          edits.anchor === "middle"
            ? "center"
            : edits.anchor === "end"
              ? "right"
              : "left";
    }
    return next;
  }
  function run(def, args, fn) {
    const ctx = args[0];
    if (!api || !contextInfo.has(ctx)) return fn(args);
    stack.push(def);
    const outer = groups.at(-1),
      suppressed =
        outer &&
        outer.ctx === ctx &&
        outer.def.kind === "text" &&
        def.kind === "text";
    if (!def.kind || suppressed) {
      try {
        return fn(args);
      } finally {
        stack.pop();
      }
    }
    const id = keyFor(def, args),
      parent = outer?.id || null,
      edited = textArgs(def, args, id);
    if (phase === "paint") {
      const item = measured.get(id);
      try {
        if (!item?.toOutput || !item.bounds) return fn(edited);
        const current = {
          id,
          ctx,
          def,
          textEdits: api.textChanges?.(id) || {},
        };
        groups.push(current);
        try {
          return api.capture(id, ctx, () => fn(edited), {
            bounds: item.bounds,
            toOutput: item.toOutput,
            visible: item.visible,
            text: item.declaration.text?.text,
            declaration: item.declaration,
            result: item.result,
            withoutPainting: (fn) => mute(ctx, fn),
          });
        } finally {
          groups.pop();
        }
      } finally {
        stack.pop();
      }
    }
    const item = {
      id,
      ctx,
      def,
      base: values(ctx.getTransform()),
      bounds: null,
      parent,
      external: false,
      args: edited,
      textEdits: api.textChanges?.(id) || {},
    };
    groups.push(item);
    try {
      item.result = fn(edited);
      return item.result;
    } finally {
      groups.pop();
      stack.pop();
      if (item.bounds && item.bounds[2] > 0.00001 && item.bounds[3] > 0.00001)
        measured.set(id, item);
      item.surface = surface(ctx.canvas);
    }
  }
  function toOutput(canvas, visited = new Set()) {
    if (canvas.canvas === root) return { matrix: identity, opacity: 1 };
    if (visited.has(canvas)) return null;
    visited.add(canvas);
    const result = [];
    for (const edge of edges.get(canvas) || []) {
      const parent = toOutput(edge.target, new Set(visited));
      if (parent)
        result.push({
          matrix: mul(parent.matrix, edge.matrix),
          opacity: parent.opacity * edge.opacity,
        });
    }
    const unique = result.filter(
      (value, index) =>
        !result
          .slice(0, index)
          .some((previous) =>
            previous.matrix.every(
              (n, i) => Math.abs(n - value.matrix[i]) < 1e-8,
            ),
          ),
    );
    if (unique.length > 1)
      throw Error(
        "同一绘制缓冲区被合成到不同位置，需提供独立对象实例映射：" +
          JSON.stringify(unique.map((v) => v.matrix)),
      );
    return unique[0] || null;
  }
  function declaration(item) {
    const { def, args, textPaint } = item;
    let label = def.name || def.kind,
      text;
    if (def.kind === "text" && def.text) {
      const m = def.text,
        options = args[m.options] || {},
        font = textPaint?.font || ctxFont(item.ctx);
      text = {
        text: String(args[m.text]),
        x: m.x >= 0 ? Number(args[m.x]) || 0 : textPaint?.x || 0,
        y: m.y >= 0 ? Number(args[m.y]) || 0 : textPaint?.y || 0,
        size:
          Number(args[m.size]) || parseFloat(font.match(/[\d.]+px/)?.[0]) || 24,
        font: options.font || font.replace(/^.*?\d+(?:\.\d+)?px\s*/, ""),
        fill:
          typeof args[m.fill] === "string"
            ? args[m.fill]
            : typeof textPaint?.fill === "string"
              ? textPaint.fill
              : "#26324f",
        anchor:
          options.align === "left"
            ? "start"
            : options.align === "right"
              ? "end"
              : "middle",
        width: 0,
        start: 0,
        end: 1e9,
        paintMode: textPaint?.paintMode || "fill",
        editableFields: ["text", "x", "y", "size", "font", "fill"],
      };
      label = "文字 · " + text.text.slice(0, 60);
    } else if (def.kind === "image")
      label =
        def.identity >= 0
          ? "人物 · " + args[def.identity]
          : "图像 · " + (item.asset || label);
    else label = "图解 · " + label;
    return {
      id: item.id,
      label: label.slice(0, 200),
      bounds: item.bounds,
      parentId: item.parent,
      origin: def.origin,
      ...(text ? { text } : {}),
    };
  }
  function ctxFont(ctx) {
    return ctx.font || "24px sans-serif";
  }
  function mute(ctx, fn) {
    const info = contextInfo.get(ctx);
    info.muted++;
    try {
      return fn();
    } finally {
      info.muted--;
    }
  }
  async function frame(nextApi, canvas, draw) {
    if (nextApi.previewOnly) {
      phase = "preview";
      try {
        await draw();
      } finally {
        phase = null;
      }
      return;
    }
    api = nextApi;
    root = canvas;
    measured = new Map();
    edges = new Map();
    surfaces = new WeakMap();
    stack = [];
    groups = [];
    counts = new Map();
    lastText = null;
    phase = "measure";
    try {
      let settled = false,
        previousStructure = null;
      for (let pass = 0; pass < 3; pass++) {
        const revision = resourceRevision + contextRevision;
        measured = new Map();
        edges = new Map();
        surfaces = new WeakMap();
        counts = new Map();
        stack = [];
        groups = [];
        lastText = null;
        checkpoint();
        try {
          await draw();
        } finally {
          rollback();
        }
        const structure =
          revision === resourceRevision + contextRevision
            ? null
            : [...measured.keys()].sort().join(";");
        if (
          revision === resourceRevision + contextRevision ||
          structure === previousStructure
        ) {
          settled = true;
          break;
        }
        previousStructure = structure;
      }
      if (!settled) throw Error("源码图片加载后绘制结构仍不稳定");
      const ancestry = new Map(
        [...measured].map(([id, item]) => [id, item.parent]),
      );
      for (const item of measured.values()) {
        const mapping = toOutput(item.surface || surface(item.ctx.canvas));
        if (!mapping) {
          measured.delete(item.id);
          continue;
        }
        item.toOutput = mapping.matrix;
        item.visible = mapping.opacity > 0;
        item.declaration ||= declaration(item);
      }
      for (const item of measured.values()) {
        let parent = item.parent;
        while (parent && !measured.has(parent))
          parent = ancestry.get(parent) || null;
        item.parent = parent;
        item.declaration ||= declaration(item);
        item.declaration.parentId = parent;
      }
      // Buffers may contain source-owned cached artwork. Clearing every observed
      // context here destroys those caches; render(t) owns its drawing lifecycle.
      counts = new Map();
      stack = [];
      groups = [];
      lastText = null;
      phase = "paint";
      await draw();
    } finally {
      phase = null;
      api = null;
      groups = [];
      stack = [];
    }
  }
  return {
    ready() {
      startup = [...contexts];
    },
    exportState() {
      return startup.map((reference) => {
        const info = reference.deref();
        return info
          ? {
              width: info.real.canvas.width,
              height: info.real.canvas.height,
              depth: info.depth,
              styles: Object.fromEntries(
                styleFields
                  .map((key) => [key, info.real[key]])
                  .filter(([, value]) =>
                    ["string", "number", "boolean"].includes(typeof value),
                  ),
              ),
              matrix: values(info.real.getTransform()),
              dash: info.real.getLineDash(),
              path: info.path.slice(),
            }
          : null;
      });
    },
    restoreState(states) {
      if (states.length !== startup.length)
        throw Error("源码初始化Canvas结构发生变化");
      states.forEach((state, index) => {
        const info = startup[index].deref();
        if (!state || !info) return;
        if (
          info.real.canvas.width !== state.width ||
          info.real.canvas.height !== state.height ||
          info.depth !== state.depth
        )
          throw Error("源码初始化Canvas状态不稳定");
        Object.assign(info.real, state.styles);
        info.real.setTransform(...state.matrix);
        info.real.setLineDash(state.dash);
        restorePath(info, state.path);
      });
    },
    dispose() {
      for (const reference of contexts) {
        const info = reference.deref();
        if (info) {
          info.real.canvas.width = 1;
          info.real.canvas.height = 1;
        }
      }
      contexts.clear();
      for (const gl of ownedGL)
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      ownedGL.clear();
    },
    setImageProvider(provider) {
      imageProvider = provider;
    },
    lazyImage(image, alias) {
      lazyImages.set(image, alias);
      assetTags.set(image, alias);
    },
    async original(canvas, draw) {
      checkpoint();
      phase = "original";
      try {
        await draw();
      } finally {
        rollback();
        phase = null;
      }
    },
    run,
    frame,
    resourceLoaded() {
      resourceRevision++;
    },
    at(site, fn) {
      const before = callsite;
      callsite = site;
      try {
        return fn();
      } finally {
        callsite = before;
      }
    },
    tagImage(image, name) {
      assetTags.set(image, name);
      return image;
    },
    diagnostics() {
      return [...limitations.values()].slice(0, 100);
    },
  };
}
