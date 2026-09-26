import { clamp, duration, locate, TIME_EPSILON as EPS } from "./project.mjs";
import * as T from "./timeline.mjs";
const $ = (s) => document.querySelector(s),
  KEY = "svgfilm-timeline-v1";
const element = (tag, cls, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
const MIN_SCALE = 0.05,
  MAX_SCALE = 240;

/** Timeline owns transient selection/gestures; the editor owns project commits. */
export class TimelineController {
  constructor(hooks) {
    this.hooks = hooks;
    this.active = null;
    this.action = "move";
    this.nodes = new Map();
    this.gesture = null;
    this.focused = false;
    this.preferences = {
      snap: true,
      threshold: 8,
      precision: "frame",
      scale: 8,
    };
    try {
      const p = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (typeof p.snap === "boolean") this.preferences.snap = p.snap;
      if ([4, 8, 12].includes(p.threshold))
        this.preferences.threshold = p.threshold;
      if (["frame", "millisecond"].includes(p.precision))
        this.preferences.precision = p.precision;
      if (Number.isFinite(p.scale))
        this.preferences.scale = clamp(p.scale, MIN_SCALE, MAX_SCALE);
    } catch {}
    this.scroll = $("#timelineScroll");
    this.body = $("#timelineBody");
    $("#timelineMagnet").onclick = () => {
      this.preferences.snap = !this.preferences.snap;
      this.settings();
      this.updateGesture();
    };
    $("#snapTolerance").onchange = (e) => {
      this.preferences.threshold = +e.target.value;
      this.settings();
      this.updateGesture();
    };
    $("#timelinePrecision").onchange = (e) => {
      this.preferences.precision = e.target.value;
      this.settings();
      this.updateGesture();
    };
    $("#timelineZoom").oninput = (e) =>
      this.zoom(MIN_SCALE * (MAX_SCALE / MIN_SCALE) ** (+e.target.value / 100));
    $("#fitTimeline").onclick = () => {
      if (!this.hooks.project()) return;
      this.zoom(
        (this.scroll.clientWidth - 24) / duration(this.hooks.project()),
        null,
        true,
      );
    };
    this.scroll.addEventListener("scroll", () => this.ruler());
    this.scroll.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoom(this.scale * Math.exp(-e.deltaY * 0.003), e.clientX);
        }
      },
      { passive: false },
    );
    this.body.onpointerdown = (e) => this.pointer(e);
    this.body.ondblclick = (e) => {
      const item = this.nodes.get(
        e.target.closest("[data-key]")?.dataset.key,
      )?.item;
      if (item) {
        this.select(item.ref);
        this.hooks.inspect(item.ref, undefined, true);
      }
    };
    $("#timelineAction").onchange = (e) => {
      this.action = e.target.value;
      this.context();
    };
    $("#applyTimelineTime").onclick = () => this.applyTime();
    $("#timelineValue").onkeydown = (e) => {
      if (this.gesture) return;
      if (e.key === "Enter") {
        e.preventDefault();
        this.applyTime();
      }
      if (e.key === "Escape") this.context();
    };
    $("#timelineAlign").onchange = (e) => {
      const command = e.target.value;
      if (command) this.command(command);
      e.target.value = "";
    };
    $("#nudgeEarlier").onclick = (e) => this.nudge(e.shiftKey ? -10 : -1);
    $("#nudgeLater").onclick = (e) => this.nudge(e.shiftKey ? 10 : 1);
    $("#clearTimelineSelection").onclick = () => this.select(null, false);
    $("#timelineDetails").onclick = () => {
      if (this.active) this.hooks.inspect(this.active, undefined, true);
    };
    $("#zoomTimelineSelection").onclick = () => this.zoomSelection();
    $("#playheadTimecode").onkeydown = (e) => {
      if (this.gesture) return;
      if (e.key === "Enter") {
        e.preventDefault();
        this.seekInput();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.target.value = T.formatTimecode(
          this.hooks.time(),
          this.hooks.project().canvas.fps,
        );
        e.target.blur();
      }
    };
    $("#playheadTimecode").onchange = () => this.seekInput();
    document.addEventListener(
      "pointerdown",
      (e) => {
        this.focused = !!e.target.closest(".timeline");
      },
      { capture: true },
    );
    document.addEventListener("keydown", (e) => this.key(e));
    document.addEventListener("keyup", (e) => {
      if (e.key === "Alt" && this.gesture) {
        this.gesture.last.altKey = false;
        this.updateGesture();
      }
    });
    this.settings(false);
  }
  get scale() {
    return this.preferences.scale;
  }
  settings(save = true) {
    $("#timelineMagnet").setAttribute(
      "aria-pressed",
      String(this.preferences.snap),
    );
    $("#snapTolerance").value = String(this.preferences.threshold);
    $("#timelinePrecision").value = this.preferences.precision;
    $("#timelineZoom").value =
      (100 * Math.log(this.scale / MIN_SCALE)) /
      Math.log(MAX_SCALE / MIN_SCALE);
    $("#zoomLabel").textContent = Math.round((this.scale / 8) * 100) + "%";
    if (save)
      try {
        localStorage.setItem(KEY, JSON.stringify(this.preferences));
      } catch {}
  }
  options(event = {}) {
    return {
      snap: this.preferences.snap && !event.altKey,
      threshold: this.preferences.threshold,
      precision: this.preferences.precision,
      scale: this.scale,
      playhead: this.hooks.time(),
    };
  }
  reset() {
    this.cancel();
    this.active = null;
    this.action = "move";
    this.focused = false;
  }
  select(ref, inspect = true) {
    this.active = ref;
    if (ref?.kind === "scene" && this.action === "move") this.action = "end";
    this.highlight();
    this.context();
    if (ref && inspect) this.hooks.inspect(ref);
  }
  highlight() {
    for (const { node, item } of this.nodes.values())
      node.classList.toggle(
        "is-selected",
        !!this.active && T.refKey(item.ref) === T.refKey(this.active),
      );
  }
  render() {
    const p = this.hooks.project();
    if (!p) return;
    if (this.gesture) {
      this.pending = true;
      return;
    }
    const items = T.items(p);
    const signature = JSON.stringify([
      this.scale,
      this.scroll.clientWidth,
      p.canvas.fps,
      items.map((i) => [
        T.refKey(i.ref),
        i.start,
        i.end,
        i.label,
        i.item.kind,
        i.item.muted,
      ]),
    ]);
    if (this.renderSignature === signature) {
      for (const item of items) {
        const record = this.nodes.get(T.refKey(item.ref));
        if (record) record.item = item;
      }
      this.highlight();
      this.context();
      this.updateHead(this.hooks.time());
      return;
    }
    this.renderSignature = signature;
    const wanted = new Set(),
      counts = { scene: 0, subtitle: 0, audio: 0 };
    const tracks = {
      scene: $("#clipTrack"),
      subtitle: $("#subtitleTrack"),
      audio: $("#audioTrack"),
    };
    this.body.style.width =
      Math.max(
        this.scroll.clientWidth,
        Math.max(duration(p), ...items.map((i) => i.end)) * this.scale + 24,
      ) + "px";
    for (const item of items) {
      const key = T.refKey(item.ref),
        kind = item.ref.kind,
        track = tracks[kind];
      wanted.add(key);
      let record = this.nodes.get(key);
      if (!record) {
        const node = element(
          "button",
          `timeline-item ${kind === "scene" ? "clip" : kind === "subtitle" ? "subclip" : "audioclip"}`,
        );
        node.type = "button";
        node.dataset.key = key;
        const text = element("span", "item-label"),
          left = element("b", "trim-handle left"),
          right = element("b", "trim-handle right");
        left.dataset.edge = "start";
        right.dataset.edge = "end";
        left.title = "拖动裁剪开头";
        right.title = "拖动裁剪结尾";
        node.append(left, text, right);
        record = { node, text, item };
        this.nodes.set(key, record);
      }
      const { node, text } = record;
      record.item = item;
      text.textContent =
        (kind === "scene"
          ? `${item.sceneIndex + 1} · `
          : kind === "audio"
            ? "♫ "
            : "") + item.label;
      node.title = `${item.label}\n${item.start.toFixed(3)}–${item.end.toFixed(3)} 秒`;
      node.setAttribute(
        "aria-label",
        `${kind === "scene" ? "镜头" : kind === "subtitle" ? "字幕" : "音频"}：${item.label}`,
      );
      Object.assign(node.style, {
        left: item.start * this.scale + "px",
        width: Math.max(2, (item.end - item.start) * this.scale) + "px",
        top: (kind === "audio" ? 5 + item.index * 34 : 5) + "px",
        opacity: kind === "audio" && item.item.muted ? 0.45 : 1,
      });
      if (kind === "scene") node.dataset.clip = item.sceneIndex;
      if (kind === "subtitle") {
        node.dataset.si = item.sceneIndex;
        node.dataset.li = item.index;
      }
      if (kind === "audio") {
        node.dataset.ai = item.index;
        node.classList.toggle("voice", item.item.kind === "voice");
      }
      if (track.children[counts[kind]] !== node)
        track.insertBefore(node, track.children[counts[kind]] || null);
      counts[kind]++;
    }
    for (const [key, { node }] of this.nodes)
      if (!wanted.has(key)) {
        node.remove();
        this.nodes.delete(key);
      }
    $("#audioTrack").style.height =
      Math.max(42, p.audioTracks.length * 34 + 8) + "px";
    $("#filmEndMarker").style.left = duration(p) * this.scale + "px";
    if (this.active && !T.findItem(p, this.active)) this.active = null;
    this.highlight();
    this.ruler();
    this.context();
    this.updateHead(this.hooks.time());
  }
  ruler() {
    const p = this.hooks.project();
    if (!p || !this.scroll.clientWidth) return;
    const start = this.scroll.scrollLeft / this.scale,
      end = (this.scroll.scrollLeft + this.scroll.clientWidth) / this.scale,
      rate = p.canvas.fps;
    const steps = [
        1 / rate,
        2 / rate,
        5 / rate,
        10 / rate,
        0.5,
        1,
        2,
        5,
        10,
        15,
        30,
        60,
        120,
        300,
        600,
        1200,
      ],
      step = steps.find((s) => s * this.scale >= 65) || 1200;
    const ticks = [];
    for (let i = Math.floor(start / step); i <= Math.ceil(end / step); i++) {
      const t = i * step;
      if (t < 0) continue;
      const span = element(
        "span",
        "major",
        step < 1
          ? T.formatTimecode(t, rate).slice(3)
          : T.formatTimecode(t, rate).slice(0, 8),
      );
      span.dataset.time = t;
      span.style.left = t * this.scale + "px";
      ticks.push(span);
    }
    if (this.scale / rate >= 4)
      for (let i = Math.floor(start * rate); i <= Math.ceil(end * rate); i++) {
        const e = element("i", "frame-tick");
        e.style.left = (i / rate) * this.scale + "px";
        ticks.push(e);
      }
    $("#ruler").replaceChildren(...ticks);
    $(".track-labels span").textContent = step < 1 ? "分:秒:帧" : "时:分:秒";
    this.body.style.setProperty("--grid-spacing", step * this.scale + "px");
  }
  updateHead(time) {
    if (!this.hooks.project()) return;
    $("#playhead").style.left = time * this.scale + "px";
    if (document.activeElement !== $("#playheadTimecode"))
      $("#playheadTimecode").value = T.formatTimecode(
        time,
        this.hooks.project().canvas.fps,
      );
    const index = locate(this.hooks.project(), time).index;
    for (const { node, item } of this.nodes.values())
      if (item.ref.kind === "scene")
        node.classList.toggle("active", index === item.sceneIndex);
  }
  context() {
    const p = this.hooks.project(),
      item = this.active && p ? T.findItem(p, this.active) : null;
    $("#timelineContext").hidden = !item;
    if (!item) return;
    const source = this.active.kind === "scene";
    if (source && this.action === "move") this.action = "end";
    $("#timelineSelectedName").textContent =
      (source
        ? "镜头 · "
        : this.active.kind === "subtitle"
          ? "字幕 · "
          : "音频 · ") + item.label;
    $("#timelineSelectedName").title = item.label;
    $("#timelineSelectedRange").textContent =
      `${item.start.toFixed(3)} → ${item.end.toFixed(3)} · ${(item.end - item.start).toFixed(3)}s`;
    $("#timelineAction").querySelector("[value=move]").disabled = source;
    $("#timelineAction").value = this.action;
    $("#timelineValue").value = (
      this.action === "end" ? item.end : item.start
    ).toFixed(3);
    for (const e of $("#timelineAlign").options)
      e.disabled =
        source &&
        ["align-start", "align-end", "join-previous"].includes(e.value);
    $("#timelineContext").title = source
      ? "镜头裁剪后自动接续；音轨保持全片时间。"
      : "Alt+左右键按帧微调所选，Shift加速到10帧；Alt拖动临时关闭磁吸。";
  }
  applyTime() {
    if (!this.active) return;
    const input = $("#timelineValue").value,
      p = this.hooks.project();
    try {
      const raw = T.parseTime(input, p.canvas.fps),
        range = T.rangeFor(
          p,
          this.active,
          this.action,
          this.preferences.precision,
        );
      if (raw < range.min - EPS || raw > range.max + EPS)
        throw Error("目标时间超出该片段允许的范围");
      const value = input.includes(":")
        ? raw
        : clamp(
            T.quantize(raw, p.canvas.fps, this.preferences.precision),
            range.min,
            range.max,
          );
      this.commit(() =>
        T.applyEdit(this.hooks.project(), this.active, this.action, value),
      );
    } catch (e) {
      this.hooks.error(e.message);
    }
  }
  command(command) {
    if (this.active)
      this.commit(() =>
        T.align(this.hooks.project(), this.active, command, this.hooks.time()),
      );
  }
  nudge(frames) {
    if (this.active)
      this.commit(() =>
        T.nudge(this.hooks.project(), this.active, this.action, frames),
      );
  }
  commit(fn) {
    this.cancel();
    this.hooks.pause();
    const ref = this.active;
    const ok = this.hooks.apply(fn);
    this.render();
    if (ok !== false && ref) this.hooks.inspect(ref);
  }
  seekInput() {
    const p = this.hooks.project();
    if (!p) return;
    try {
      const value = T.parseTime($("#playheadTimecode").value, p.canvas.fps);
      this.hooks.pause();
      this.hooks.seek(
        T.proposeSeek(p, value, { ...this.options(), snap: false }).value,
      );
      $("#playheadTimecode").blur();
      this.updateHead(this.hooks.time());
    } catch (e) {
      this.hooks.error(e.message);
    }
  }
  zoom(value, clientX = null, fit = false) {
    const p = this.hooks.project();
    if (!p) return;
    this.cancel();
    const rect = this.scroll.getBoundingClientRect(),
      head = this.hooks.time() * this.scale - this.scroll.scrollLeft;
    const local =
        clientX === null
          ? head >= 0 && head <= rect.width
            ? head
            : rect.width / 2
          : clamp(clientX - rect.left, 0, rect.width),
      anchor = (this.scroll.scrollLeft + local) / this.scale;
    this.preferences.scale = clamp(value, MIN_SCALE, MAX_SCALE);
    this.settings();
    this.render();
    this.scroll.scrollLeft = fit ? 0 : Math.max(0, anchor * this.scale - local);
    this.ruler();
  }
  zoomSelection() {
    const p = this.hooks.project(),
      item = this.active && T.findItem(p, this.active);
    if (!item) return;
    this.zoom((this.scroll.clientWidth - 80) / (item.end - item.start));
    this.scroll.scrollLeft = Math.max(
      0,
      ((item.start + item.end) / 2) * this.scale - this.scroll.clientWidth / 2,
    );
    this.ruler();
  }
  timeAt(clientX) {
    return (
      (clientX -
        this.scroll.getBoundingClientRect().left +
        this.scroll.scrollLeft) /
      this.scale
    );
  }
  pointer(event) {
    if (event.button !== 0 || !this.hooks.project()) return;
    event.preventDefault();
    event.stopPropagation();
    this.hooks.pause();
    this.focused = true;
    this.cancel();
    const record = this.nodes.get(
        event.target.closest("[data-key]")?.dataset.key,
      ),
      snapshot = this.hooks.project(),
      originalTime = this.hooks.time();
    const part = record
      ? event.target.dataset.edge ||
        (record.item.ref.kind === "scene" ? "reorder" : "move")
      : "head";
    const initial = this.timeAt(event.clientX),
      offset = record ? initial - record.item.start : 0;
    if (record) {
      this.active = record.item.ref;
      if (part !== "reorder") this.action = part;
      else this.action = "end";
      this.highlight();
      if (!$("#timelineContext").hidden) this.context();
    }
    const bodyRect = this.body.getBoundingClientRect(),
      top = record ? record.node.getBoundingClientRect().top - bodyRect.top : 0;
    const g = {
      part,
      record,
      snapshot,
      originalTime,
      last: {
        clientX: event.clientX,
        clientY: event.clientY,
        altKey: event.altKey,
      },
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      proposal: null,
      targets: T.targets(
        snapshot,
        record?.item.ref,
        part === "head" ? null : originalTime,
      ),
      controller: new AbortController(),
    };
    this.gesture = g;
    g.update = (e) => {
      g.last = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
      if (
        part !== "head" &&
        !g.moved &&
        Math.abs(e.clientX - g.startX) + Math.abs(e.clientY - g.startY) < 3
      )
        return;
      g.moved = true;
      const raw = this.timeAt(e.clientX),
        options = {
          ...this.options(e),
          playhead: originalTime,
          targets: g.targets,
        };
      if (part === "head") {
        const result = T.proposeSeek(snapshot, raw, options);
        this.hooks.seek(result.value);
        this.guide(result.guide);
        return;
      }
      record.node.classList.add("drag-source");
      if (part === "reorder") {
        g.proposal = T.reorderTarget(snapshot, record.item.ref.id, raw);
        this.guide({ time: g.proposal.time, label: g.proposal.label });
        this.ghost(
          Math.max(0, raw - offset),
          Math.max(0, raw - offset) + record.item.end - record.item.start,
          top,
          record.item.label,
        );
      } else {
        // Handle grabs preserve their offset from the exact boundary, avoiding a pixel-sized jump.
        const target =
          part === "move"
            ? raw - offset
            : (part === "start" ? record.item.start : record.item.end) +
              (raw - initial);
        g.proposal = T.proposeEdit(
          snapshot,
          record.item.ref,
          part,
          target,
          options,
        );
        this.guide(g.proposal.guide);
        this.ghost(g.proposal.start, g.proposal.end, top, record.item.label);
        $("#timelineDragReadout").hidden = false;
        $("#timelineDragReadout").textContent =
          `${part === "move" ? "移动" : part === "start" ? "入点" : "出点"} ${T.formatTimecode(g.proposal.value, snapshot.canvas.fps)} · ${g.proposal.value.toFixed(3)}s`;
        $("#timelineDragReadout").style.left =
          clamp(
            ((g.proposal.start + g.proposal.end) / 2) * this.scale,
            this.scroll.scrollLeft,
            this.scroll.scrollLeft + this.scroll.clientWidth - 200,
          ) + "px";
        $("#timelineDragReadout").style.top = top + 33 + "px";
      }
    };
    const end = (cancel) => {
      if (this.gesture !== g) return;
      if (g.previewFrame) {
        cancelAnimationFrame(g.previewFrame);
        g.previewFrame = null;
        if (!cancel) g.update(g.last);
      }
      g.controller.abort();
      cancelAnimationFrame(g.scrollFrame);
      this.gesture = null;
      record?.node.classList.remove("drag-source");
      this.guide(null);
      $("#timelineGhost").hidden = true;
      $("#timelineDragReadout").hidden = true;
      if (cancel) {
        if (part === "head") this.hooks.seek(originalTime);
        this.render();
        return;
      }
      if (record && g.moved && g.proposal) {
        const changed =
          part === "reorder"
            ? g.proposal.index !== record.item.sceneIndex
            : Math.abs(
                g.proposal.value -
                  (part === "end" ? record.item.end : record.item.start),
              ) > EPS;
        if (changed) {
          const proposal = g.proposal;
          this.commit(() =>
            part === "reorder"
              ? T.reorder(
                  this.hooks.project(),
                  record.item.ref.id,
                  proposal.index,
                )
              : T.applyEdit(
                  this.hooks.project(),
                  record.item.ref,
                  part,
                  proposal.value,
                ),
          );
        }
      } else if (record)
        this.hooks.inspect(
          record.item.ref,
          T.proposeSeek(snapshot, this.timeAt(g.last.clientX), {
            ...this.options(),
            snap: false,
          }).value,
        );
      if (this.pending || g.moved) {
        this.pending = false;
        this.render();
      } else this.context();
    };
    g.cancel = () => end(true);
    const options = { signal: g.controller.signal };
    g.queueUpdate = (e) => {
      g.last = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
      if (!g.previewFrame)
        g.previewFrame = requestAnimationFrame(() => {
          g.previewFrame = null;
          if (this.gesture === g) g.update(g.last);
        });
    };
    window.addEventListener(
      "pointermove",
      (e) => (part === "head" ? g.queueUpdate(e) : g.update(e)),
      options,
    );
    window.addEventListener("pointerup", () => end(false), options);
    window.addEventListener("pointercancel", () => end(true), options);
    window.addEventListener("blur", () => end(true), options);
    if (part === "head") g.update(event);
    this.autoScroll(g);
  }
  ghost(start, end, top, label) {
    const e = $("#timelineGhost");
    e.hidden = false;
    e.textContent = label;
    Object.assign(e.style, {
      left: start * this.scale + "px",
      width: Math.max(2, (end - start) * this.scale) + "px",
      top: top + "px",
    });
  }
  guide(point) {
    const e = $("#snapGuide");
    e.hidden = !point;
    if (!point) return;
    e.style.left = point.time * this.scale + "px";
    e.querySelector("span").textContent =
      (point.interpretation === "cut-reference"
        ? "裁剪参考 · "
        : point.kind
          ? "吸附 · "
          : "") + point.label;
    e.classList.toggle(
      "label-left",
      point.time * this.scale - this.scroll.scrollLeft >
        this.scroll.clientWidth - 200,
    );
  }
  autoScroll(g) {
    const tick = () => {
      if (this.gesture !== g) return;
      const r = this.scroll.getBoundingClientRect(),
        x = g.last.clientX,
        left = x - r.left,
        right = r.right - x,
        edge = 36,
        speed =
          left < edge
            ? -Math.min(14, (edge - left) * 0.4)
            : right < edge
              ? Math.min(14, (edge - right) * 0.4)
              : 0;
      if (speed && (g.part === "head" || g.moved)) {
        const previous = this.scroll.scrollLeft;
        this.scroll.scrollLeft += speed;
        if (this.scroll.scrollLeft !== previous)
          g.part === "head" ? g.queueUpdate(g.last) : g.update(g.last);
      }
      g.scrollFrame = requestAnimationFrame(tick);
    };
    g.scrollFrame = requestAnimationFrame(tick);
  }
  updateGesture() {
    if (this.gesture) this.gesture.update(this.gesture.last);
  }
  cancel() {
    if (this.gesture) this.gesture.cancel();
  }
  key(event) {
    if (event.defaultPrevented) return;
    const undo =
      (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
    if (this.gesture && (event.key === "Escape" || undo)) {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (this.gesture && event.key === "Alt") {
      event.preventDefault();
      this.gesture.last.altKey = true;
      this.updateGesture();
      return;
    }
    if (
      event.target.closest("input,textarea,select") ||
      document.querySelector("dialog[open]")
    )
      return;
    if (
      event.key.toLowerCase() === "n" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !document.body.classList.contains("timeline-collapsed")
    ) {
      event.preventDefault();
      $("#timelineMagnet").click();
      return;
    }
    if (this.gesture && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      return;
    }
    if (!this.focused || !this.active) return;
    if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      this.nudge(
        (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1),
      );
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.select(null, false);
    }
  }
}
