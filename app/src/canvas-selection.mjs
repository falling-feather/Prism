import { clone, clamp, snapshotProject } from "./project.mjs";
import {
  canonicalIds,
  containsRect,
  unionBounds,
  translateOverrides,
  scaleOverrides,
} from "./selection.mjs";
const $ = (s) => document.querySelector(s);
const GRAPHICS =
  "path,rect,circle,ellipse,polygon,polyline,line,text,use,image";
const box = (r) => ({
  left: r.left,
  top: r.top,
  right: r.right,
  bottom: r.bottom,
});

/** Owns view-only selection state; mutations are committed through the editor's history. */
export class CanvasSelection {
  constructor(renderer, hooks) {
    this.renderer = renderer;
    this.hooks = hooks;
    this.ids = [];
    this.mode = "select";
    this.deep = false;
    this.scaleMode = "group";
    this.gesture = null;
    $("#selectMode").onclick = () => this.setMode("select");
    $("#marqueeMode").onclick = () => this.setMode("marquee");
    $("#deepSelect").onchange = (e) => {
      this.deep = e.target.checked;
      this.clear();
    };
    $("#clearSelection").onclick = () => this.clear();
    $("#editSelection").onclick = () => this.hooks.edit();
    $("#scaleMode").onchange = (e) => {
      this.scaleMode = e.target.value;
      this.hooks.changed(this.ids);
    };
    $("#applySelectionScale").onclick = () =>
      this.hooks.scale(+$("#selectionScale").value / 100);
    $("#stage").onpointerdown = (e) => this.pointer(e);
    $("#stage").ondblclick = (e) => {
      const id = this.hit(e.target, true);
      if (!id) return;
      this.hooks.pause();
      this.deep = true;
      $("#deepSelect").checked = true;
      this.set([id]);
      this.hooks.edit();
    };
    $("#selectionLabel").onpointerdown = (e) => {
      if (e.button === 0) this.transformGesture(e, "move");
    };
    $("#resizeHandle").onpointerdown = (e) => {
      if (e.button === 0) this.transformGesture(e, "scale");
    };
    document.addEventListener("keydown", (e) => {
      if (
        e.key !== "Escape" ||
        document.querySelector("dialog[open]") ||
        document.body.classList.contains("workspace-resizing")
      )
        return;
      if (this.gesture) {
        e.preventDefault();
        this.gesture.cancel();
      } else if (!e.target.closest("input,textarea,select")) this.clear();
    });
    this.resizeObserver = new ResizeObserver(() => this.refresh());
    this.resizeObserver.observe($("#stageWrap"));
  }
  get primary() {
    return this.ids.length === 1 ? this.ids[0] : null;
  }
  parents() {
    const result = new Map(),
      ids = new Set(this.hooks.scene().objects.map((o) => o.id));
    for (const id of ids) {
      let node = this.renderer.node(id)?.parentElement;
      while (node) {
        const parent = node.getAttribute("data-node-id");
        if (ids.has(parent)) {
          result.set(id, parent);
          break;
        }
        node = node.parentElement;
      }
    }
    return result;
  }
  set(ids, notify = true) {
    const valid = new Set(this.hooks.scene().objects.map((o) => o.id));
    this.ids = canonicalIds(
      ids.filter((id) => valid.has(id)),
      this.parents(),
    );
    this.refresh();
    if (notify) this.hooks.changed(this.ids);
  }
  clear(notify = true) {
    if (this.gesture) this.gesture.cancel();
    this.ids = [];
    this.refresh();
    if (notify && this.renderer.project) this.hooks.changed(this.ids);
  }
  setMode(mode) {
    this.mode = mode;
    $("#selectMode").setAttribute("aria-pressed", String(mode === "select"));
    $("#marqueeMode").setAttribute("aria-pressed", String(mode === "marquee"));
    $("#stage").classList.toggle("marquee-mode", mode === "marquee");
  }
  hit(target, deep = this.deep) {
    const valid = new Set(this.hooks.scene().objects.map((o) => o.id));
    let node = target.closest("[data-node-id]");
    while (node && !valid.has(node.getAttribute("data-node-id")))
      node = node.parentElement?.closest("[data-node-id]");
    if (!node || node.matches("[data-layer],[data-scene]")) return null;
    if (!deep) {
      let p = node.parentElement;
      while (p && p !== this.renderer.svg) {
        if (p.matches("[data-layer],[data-scene]")) break;
        if (valid.has(p.getAttribute("data-node-id"))) node = p;
        p = p.parentElement;
      }
    }
    return node.getAttribute("data-node-id");
  }
  visibleBounds(node, cache = new Map()) {
    if (!node) return null;
    const shown = (element) => {
      if (getComputedStyle(element).visibility !== "visible") return false;
      for (let p = element; p && p !== this.renderer.svg; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.display === "none" || +style.opacity === 0) return false;
      }
      return true;
    };
    // Non-DOM renderers supply geometry proxies; their transparent fill is intentional.
    if (node.querySelector("[data-proxy-bounds]")) {
      return unionBounds(
        [...node.querySelectorAll("[data-proxy-bounds]")]
          .filter(shown)
          .map((leaf) => box(leaf.getBoundingClientRect())),
      );
    }
    const paints = (value) =>
      value !== "none" &&
      value !== "transparent" &&
      !/rgba\([^)]*,\s*0\s*\)/.test(value);
    const rectangles = [];
    const leaves = node.matches(GRAPHICS)
      ? [node]
      : [...node.querySelectorAll(GRAPHICS)];
    for (const leaf of leaves) {
      if (cache.has(leaf)) {
        const r = cache.get(leaf);
        if (r) rectangles.push(r);
        continue;
      }
      const pieces = [];
      if (!leaf.closest("defs,clipPath,mask,marker,pattern") && shown(leaf)) {
        const style = getComputedStyle(leaf),
          stroke =
            paints(style.stroke) && +style.strokeOpacity > 0
              ? parseFloat(style.strokeWidth) || 0
              : 0;
        const filled = paints(style.fill) && +style.fillOpacity > 0;
        if (filled || stroke || leaf.matches("image,use")) {
          if (leaf.matches("text")) {
            const walker = document.createTreeWalker(
              leaf,
              NodeFilter.SHOW_TEXT,
            );
            for (let text = walker.nextNode(); text; text = walker.nextNode())
              if (text.textContent && shown(text.parentElement)) {
                const range = document.createRange();
                range.selectNodeContents(text);
                const r = range.getBoundingClientRect();
                if (r.width || r.height) pieces.push(box(r));
              }
          } else {
            const r = leaf.getBoundingClientRect();
            if (r.width || r.height) pieces.push(box(r));
          }
          if (stroke) {
            const m = leaf.getScreenCTM(),
              fixed = style.vectorEffect === "non-scaling-stroke",
              x = (stroke / 2) * (fixed ? 1 : Math.hypot(m.a, m.c)),
              y = (stroke / 2) * (fixed ? 1 : Math.hypot(m.b, m.d));
            for (const r of pieces) {
              r.left -= x;
              r.right += x;
              r.top -= y;
              r.bottom += y;
            }
          }
        }
      }
      const combined = unionBounds(pieces);
      cache.set(leaf, combined);
      if (combined) rectangles.push(combined);
    }
    return unionBounds(rectangles);
  }
  candidates() {
    const all = this.hooks.scene().objects,
      parents = this.parents(),
      hasChildren = new Set(parents.values()),
      result = new Map(),
      cache = new Map();
    for (const o of all) {
      const node = this.renderer.node(o.id);
      if (!node || node.matches("[data-layer],[data-scene]")) continue;
      if (this.deep && hasChildren.has(o.id)) continue;
      // Retain inner components when their larger parent lies outside the marquee.
      // set() then keeps only the largest fully enclosed groups.
      const id = o.id,
        root = node;
      const bounds = this.visibleBounds(root, cache);
      if (bounds) result.set(id, { id, bounds });
    }
    return [...result.values()];
  }
  capture() {
    const svg = this.renderer.svg,
      inverse = svg.getScreenCTM().inverse(),
      scene = this.hooks.scene(),
      cache = new Map();
    return this.ids.map((id) => {
      const node = this.renderer.node(id),
        wrapper = this.renderer.wrapper(id),
        o = scene.objects.find((o) => o.id === id);
      const r = this.visibleBounds(node, cache);
      if (!wrapper || !r) throw Error("请先显示所选组件再调整位置或大小");
      const points = [
          [r.left, r.top],
          [r.right, r.top],
          [r.left, r.bottom],
          [r.right, r.bottom],
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(inverse)),
        m = inverse.multiply(wrapper.parentElement.getScreenCTM());
      return {
        id,
        parent: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
        pivot: { x: o.cx || 0, y: o.cy || 0 },
        bounds: {
          left: Math.min(...points.map((p) => p.x)),
          top: Math.min(...points.map((p) => p.y)),
          right: Math.max(...points.map((p) => p.x)),
          bottom: Math.max(...points.map((p) => p.y)),
        },
      };
    });
  }
  move(dx, dy) {
    return translateOverrides(this.hooks.scene(), this.capture(), dx, dy);
  }
  scale(factor) {
    return scaleOverrides(
      this.hooks.scene(),
      this.capture(),
      factor,
      this.scaleMode,
    );
  }
  refresh() {
    if (!this.renderer.project) return;
    const cache = new Map(),
      nodes = this.ids
        .map((id) => ({
          id,
          bounds: this.visibleBounds(this.renderer.node(id), cache),
        }))
        .filter((o) => o.bounds),
      rects = nodes.map((o) => o.bounds),
      outer = unionBounds(rects),
      origin = $("#stageWrap").getBoundingClientRect();
    const position = (e, r) =>
      Object.assign(e.style, {
        left: r.left - origin.left + "px",
        top: r.top - origin.top + "px",
        width: r.right - r.left + "px",
        height: r.bottom - r.top + "px",
      });
    const frame = $("#selection");
    frame.hidden = !outer;
    if (outer) {
      position(frame, outer);
      $("#selectionLabel").textContent =
        this.ids.length > 1
          ? `${this.ids.length} 个组件 · 拖动整体移动`
          : this.hooks.scene().objects.find((o) => o.id === this.primary)
              ?.label || "组件";
    }
    const items = $("#selectionItems");
    items.replaceChildren();
    if (nodes.length > 1)
      nodes.forEach((o, i) => {
        const e = document.createElement("div");
        e.className = "selection-item";
        e.dataset.id = o.id;
        position(e, rects[i]);
        items.append(e);
      });
    $("#selectionActions").hidden = !this.ids.length;
    $(".viewer-footer").classList.toggle("has-selection", !!this.ids.length);
    $("#selectedCount").textContent = `已选 ${this.ids.length} 个组件`;
    $("#scaleMode").value = this.scaleMode;
    $("#applySelectionScale").disabled = nodes.length !== this.ids.length;
    $("#resizeHandle").hidden = nodes.length !== this.ids.length;
  }
  listen(move, finish, cancel) {
    if (this.gesture) this.gesture.cancel();
    const controller = new AbortController(),
      options = { signal: controller.signal };
    const end = (aborted) => {
      controller.abort();
      this.gesture = null;
      aborted ? cancel() : finish();
    };
    this.gesture = { cancel: () => end(true) };
    window.addEventListener("pointermove", move, options);
    window.addEventListener("pointerup", () => end(false), options);
    window.addEventListener("pointercancel", () => end(true), options);
    window.addEventListener("blur", () => end(true), options);
  }
  pointer(event) {
    if (event.button !== 0) return;
    this.hooks.pause();
    event.preventDefault();
    const id = this.hit(event.target);
    if (this.mode === "marquee" || !id) {
      this.marquee(event, id);
      return;
    }
    if (event.shiftKey)
      this.set(
        this.ids.includes(id)
          ? this.ids.filter((x) => x !== id)
          : [...this.ids, id],
      );
    else if (!this.ids.includes(id)) this.set([id]);
    if (this.ids.length) this.transformGesture(event, "move");
  }
  marquee(event, hit) {
    const origin = { x: event.clientX, y: event.clientY },
      previous = [...this.ids],
      area = $("#stageWrap").getBoundingClientRect();
    let end = origin,
      moved = false;
    const rect = () => ({
      left: Math.min(origin.x, end.x),
      right: Math.max(origin.x, end.x),
      top: Math.min(origin.y, end.y),
      bottom: Math.max(origin.y, end.y),
    });
    const clear = () => {
      $("#marquee").hidden = true;
    };
    this.listen(
      (e) => {
        end = {
          x: clamp(e.clientX, area.left, area.right),
          y: clamp(e.clientY, area.top, area.bottom),
        };
        moved = Math.abs(end.x - origin.x) + Math.abs(end.y - origin.y) > 4;
        const r = rect(),
          box = $("#marquee");
        box.hidden = !moved;
        Object.assign(box.style, {
          left: r.left - area.left + "px",
          top: r.top - area.top + "px",
          width: r.right - r.left + "px",
          height: r.bottom - r.top + "px",
        });
      },
      () => {
        clear();
        let ids = moved
          ? this.candidates()
              .filter((o) => containsRect(rect(), o.bounds))
              .map((o) => o.id)
          : hit
            ? [hit]
            : [];
        if (event.shiftKey)
          ids = moved
            ? [...previous, ...ids]
            : previous.includes(hit)
              ? previous.filter((x) => x !== hit)
              : [...previous, ...ids];
        this.set(ids);
      },
      clear,
    );
  }
  transformGesture(event, kind) {
    event.preventDefault();
    event.stopPropagation();
    this.hooks.pause();
    if (!this.ids.length) return;
    let entries;
    try {
      entries = this.capture();
    } catch (e) {
      this.hooks.error(e.message);
      return;
    }
    const scene = this.hooks.scene(),
      before = snapshotProject(this.hooks.project()),
      base = { objectOverrides: clone(scene.objectOverrides) },
      inverse = this.renderer.svg.getScreenCTM().inverse(),
      start = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        inverse,
      ),
      bounds = unionBounds(entries.map((e) => e.bounds)),
      width = bounds.right - bounds.left,
      height = bounds.bottom - bounds.top;
    const min = Math.max(
        ...entries.map((e) => 0.05 / (base.objectOverrides[e.id]?.scale ?? 1)),
      ),
      max = Math.min(
        ...entries.map((e) => 20 / (base.objectOverrides[e.id]?.scale ?? 1)),
      );
    let moved = false;
    const redraw = () => {
      this.renderer.render(this.hooks.time());
      this.refresh();
    };
    this.listen(
      (e) => {
        const current = new DOMPoint(e.clientX, e.clientY).matrixTransform(
            inverse,
          ),
          dx = current.x - start.x,
          dy = current.y - start.y;
        if (
          !moved &&
          Math.abs(e.clientX - event.clientX) +
            Math.abs(e.clientY - event.clientY) <
            3
        )
          return;
        moved = true;
        if (kind === "move")
          scene.objectOverrides = translateOverrides(base, entries, dx, dy);
        else {
          const factor = clamp(
            1 +
              (2 * (dx * width + dy * height)) /
                Math.max(1, width * width + height * height),
            min,
            max,
          );
          scene.objectOverrides = scaleOverrides(
            base,
            entries,
            factor,
            this.scaleMode,
          );
        }
        redraw();
      },
      () => {
        if (moved) this.hooks.commit(before);
      },
      () => {
        scene.objectOverrides = base.objectOverrides;
        redraw();
      },
    );
  }
}
