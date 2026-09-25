const KEY = "svgfilm-workspace-v1";
const DEFAULTS = {
  scenes: true,
  inspector: false,
  timeline: false,
  height: 260,
};
export class WorkspaceLayout {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = { ...DEFAULTS };
    this.frame = 0;
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
      for (const key of ["scenes", "inspector", "timeline"])
        if (typeof stored[key] === "boolean") this.state[key] = stored[key];
      if (Number.isFinite(stored.height)) this.state.height = stored.height;
    } catch {}
    for (const [key, id] of [
      ["scenes", "toggleScenes"],
      ["inspector", "toggleInspector"],
      ["timeline", "toggleTimeline"],
    ])
      document.getElementById(id).onclick = () =>
        this.set(key, !this.state[key]);
    document.getElementById("closeInspector").onclick = () =>
      this.set("inspector", false);
    const grip = document.getElementById("timelineResize");
    grip.onpointerdown = (e) => this.resize(e);
    grip.ondblclick = () => {
      this.state.height = DEFAULTS.height;
      this.apply();
    };
    grip.onkeydown = (e) => {
      const { min, max } = this.limits();
      let value = this.height;
      if (e.key === "ArrowUp") value += 24;
      else if (e.key === "ArrowDown") value -= 24;
      else if (e.key === "Home") value = min;
      else if (e.key === "End") value = max;
      else return;
      e.preventDefault();
      this.state.height = value;
      this.apply();
    };
    window.addEventListener("resize", () => this.apply(false));
    this.observer = new ResizeObserver(() => this.apply(false));
    this.observer.observe(document.querySelector(".viewer-toolbar"));
    this.observer.observe(document.querySelector(".viewer-footer"));
    this.apply(false);
  }
  limits() {
    const header = document
        .querySelector("header")
        .getBoundingClientRect().height,
      toolbar = document
        .querySelector(".viewer-toolbar")
        .getBoundingClientRect().height,
      footer = document
        .querySelector(".viewer-footer")
        .getBoundingClientRect().height,
      style = getComputedStyle(document.querySelector("#stageArea")),
      padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      max = Math.max(
        128,
        innerHeight - header - toolbar - footer - padding - 120,
      );
    return { min: Math.min(160, max), max };
  }
  set(key, value) {
    this.state[key] = value;
    this.apply();
  }
  reset() {
    this.state = { ...DEFAULTS };
    this.apply();
  }
  apply(save = true) {
    const body = document.body;
    body.classList.toggle("workspace-scenes-hidden", !this.state.scenes);
    body.classList.toggle("workspace-inspector-hidden", !this.state.inspector);
    body.classList.toggle("timeline-collapsed", !this.state.timeline);
    const { min, max } = this.limits();
    this.height = Math.min(max, Math.max(min, this.state.height));
    body.style.setProperty(
      "--timeline-size",
      this.state.timeline ? `${this.height}px` : "var(--timeline-toolbar-size)",
    );
    for (const [key, id] of [
      ["scenes", "toggleScenes"],
      ["inspector", "toggleInspector"],
      ["timeline", "toggleTimeline"],
    ]) {
      const b = document.getElementById(id);
      b.setAttribute("aria-expanded", String(this.state[key]));
      b.classList.toggle("active", this.state[key]);
    }
    document.getElementById("toggleTimeline").textContent = this.state.timeline
      ? "收起时间轴 ▾"
      : "展开时间轴 ▴";
    const grip = document.getElementById("timelineResize");
    grip.setAttribute("aria-valuemin", String(Math.round(min)));
    grip.setAttribute("aria-valuemax", String(Math.round(max)));
    grip.setAttribute("aria-valuenow", String(Math.round(this.height)));
    if (save)
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
      } catch {}
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.onChange());
  }
  resize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = event.clientY,
      height = this.height,
      previous = this.state.height,
      controller = new AbortController(),
      options = { signal: controller.signal };
    document.body.classList.add("workspace-resizing");
    const end = (cancel) => {
      controller.abort();
      document.body.classList.remove("workspace-resizing");
      if (cancel) this.state.height = previous;
      this.apply();
    };
    window.addEventListener(
      "pointermove",
      (e) => {
        const { min, max } = this.limits();
        this.state.height = Math.min(
          max,
          Math.max(min, height + start - e.clientY),
        );
        this.apply(false);
      },
      options,
    );
    window.addEventListener("pointerup", () => end(false), options);
    window.addEventListener("pointercancel", () => end(true), options);
    window.addEventListener("blur", () => end(true), options);
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") end(true);
      },
      options,
    );
  }
}
