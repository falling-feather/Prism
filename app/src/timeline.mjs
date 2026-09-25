import {
  clamp,
  duration,
  length,
  trimScene,
  moveScene,
  frameCount,
  TIME_EPSILON as EPS,
} from "./project.mjs";
const clean = (value) => Math.round(value * 1e12) / 1e12;
export const refKey = (ref) =>
  JSON.stringify([ref.kind, ref.sceneId || null, ref.id]);
export function items(project) {
  const result = [];
  let start = 0;
  project.scenes.forEach((scene, sceneIndex) => {
    result.push({
      ref: { kind: "scene", id: scene.id },
      scene,
      sceneIndex,
      index: sceneIndex,
      item: scene,
      start,
      end: start + length(scene),
      label: scene.name,
    });
    scene.subtitles.forEach((item, index) =>
      result.push({
        ref: { kind: "subtitle", sceneId: scene.id, id: item.id },
        scene,
        sceneIndex,
        index,
        item,
        start: start + item.start,
        end: start + item.end,
        label: item.text,
      }),
    );
    start += length(scene);
  });
  project.audioTracks.forEach((item, index) =>
    result.push({
      ref: { kind: "audio", id: item.id },
      index,
      item,
      start: item.start,
      end: item.start + item.duration,
      label: item.name,
    }),
  );
  return result;
}
export function findItem(project, ref) {
  return items(project).find((x) => refKey(x.ref) === refKey(ref)) || null;
}
export function quantize(value, fps, precision = "frame") {
  if (!Number.isFinite(value)) throw Error("时间必须是有效数字");
  if (precision === "none") return clean(value);
  const step = precision === "millisecond" ? 0.001 : 1 / fps;
  return clean(Math.round(value / step) * step);
}
export function formatTimecode(time, fps) {
  const rate = Math.round(fps),
    frame = Math.max(0, Math.round(time * fps)),
    seconds = Math.floor(frame / rate),
    pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frame % rate)}`;
}
export function parseTime(text, fps) {
  text = String(text).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const t = Number(text);
    if (Number.isFinite(t)) return t;
  }
  const match = text.match(/^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [h, m, s, f] = match.slice(1).map(Number),
      rate = Math.round(fps);
    if (m < 60 && s < 60 && f < rate)
      return ((h * 3600 + m * 60 + s) * rate + f) / fps;
  }
  throw Error("时间格式无效，请输入秒数或 HH:MM:SS:帧");
}
export function rangeFor(project, ref, part, precision = "frame") {
  const found = findItem(project, ref);
  if (!found) throw Error("片段已不存在");
  const span = found.end - found.start,
    kind = ref.kind,
    baseMin = kind === "subtitle" ? 0.001 : 0.01;
  const minimum = Math.min(
    span,
    precision === "millisecond"
      ? baseMin
      : Math.max(baseMin, 1 / project.canvas.fps),
  );
  if (kind === "subtitle") {
    const origin = found.start - found.item.start,
      end = origin + length(found.scene);
    if (part === "move") return { min: origin, max: end - span, found };
    if (part === "start")
      return { min: origin, max: found.end - minimum, found };
    if (part === "end") return { min: found.start + minimum, max: end, found };
  } else if (kind === "audio") {
    if (part === "move")
      return { min: 0, max: Math.max(0, duration(project) - minimum), found };
    if (part === "start")
      return {
        min: Math.max(0, found.start - (found.item.offset || 0)),
        max: found.end - minimum,
        found,
      };
    if (part === "end")
      return {
        min: found.start + minimum,
        max:
          found.start +
          Math.min(
            7200,
            (found.item.mediaDuration ?? (found.item.offset || 0) + span) -
              (found.item.offset || 0),
          ),
        found,
      };
  } else if (kind === "scene") {
    const s = found.scene,
      motion = s.out - s.in,
      minMotion = Math.min(
        motion,
        Math.max(
          0.01,
          precision === "millisecond" ? 0.01 : 1 / project.canvas.fps,
        ),
      );
    if (part === "start")
      return {
        min: found.start - s.in,
        max: found.start + motion - minMotion,
        found,
      };
    if (part === "end")
      return {
        min: found.start + minMotion,
        max:
          found.start +
          (s.hold ? motion : project.sources[s.sourceId].duration - s.in) +
          600,
        found,
      };
    throw Error("镜头保持自动接续，请拖动排序或调整入出点");
  }
  throw Error("不支持的时间编辑操作");
}
export function targets(project, active = null, playhead = null) {
  const result = [{ time: 0, label: "片头", kind: "boundary", priority: 1 }];
  if (active?.kind !== "scene")
    result.push({
      time: duration(project),
      label: "片尾",
      kind: "boundary",
      priority: 1,
    });
  if (Number.isFinite(playhead))
    result.push({
      time: playhead,
      label: "播放头",
      kind: "playhead",
      priority: 0,
    });
  const current = active ? findItem(project, active) : null;
  for (const item of items(project)) {
    if (active && refKey(item.ref) === refKey(active)) continue;
    // Later scene times ripple during a scene trim, so they are not stationary snap targets.
    if (
      active?.kind === "scene" &&
      item.ref.kind !== "audio" &&
      item.sceneIndex > current.sceneIndex
    )
      continue;
    const name =
      item.ref.kind === "scene"
        ? "镜头"
        : item.ref.kind === "subtitle"
          ? "字幕"
          : "音频";
    result.push(
      {
        time: item.start,
        label: `${name}开始`,
        kind: item.ref.kind,
        priority: 2,
      },
      {
        time: item.end,
        label: `${name}结束`,
        kind: item.ref.kind,
        priority: 2,
      },
    );
  }
  return result;
}
function snapValue(raw, min, max, offsets, candidates, options) {
  const scale = options.scale || 8,
    threshold = options.threshold ?? 8;
  let best = null;
  if (options.snap !== false)
    for (const point of candidates)
      for (const offset of offsets) {
        const value = point.time - offset.value,
          distance = Math.abs(value - raw) * scale;
        if (
          value < min - EPS ||
          value > max + EPS ||
          distance > threshold + EPS
        )
          continue;
        if (
          !best ||
          distance < best.distance - EPS ||
          (Math.abs(distance - best.distance) < EPS &&
            point.priority < best.guide.priority)
        )
          best = {
            value: clean(clamp(value, min, max)),
            distance,
            guide: { ...point, movingEdge: offset.edge },
          };
      }
  return best;
}
export function proposeEdit(project, ref, part, raw, options = {}) {
  const { min, max, found } = rangeFor(project, ref, part, options.precision),
    span = found.end - found.start;
  const snap = snapValue(
    raw,
    min,
    max,
    part === "move"
      ? [
          { value: 0, edge: "start" },
          { value: span, edge: "end" },
        ]
      : [{ value: 0, edge: part }],
    options.targets || targets(project, ref, options.playhead),
    options,
  );
  const value =
    snap?.value ??
    clean(
      clamp(quantize(raw, project.canvas.fps, options.precision), min, max),
    );
  if (snap && ref.kind === "scene" && part === "start")
    snap.guide.interpretation = "cut-reference";
  return {
    ref,
    part,
    value,
    start: part === "end" ? found.start : value,
    end:
      part === "move"
        ? clean(value + span)
        : part === "end"
          ? value
          : found.end,
    guide: snap?.guide || null,
  };
}
export function proposeSeek(project, raw, options = {}) {
  const max = Math.max(
    0,
    options.precision === "millisecond"
      ? duration(project) - 0.001
      : (frameCount(duration(project), project.canvas.fps) - 1) /
          project.canvas.fps,
  );
  const snap = snapValue(
    raw,
    0,
    max,
    [{ value: 0, edge: "head" }],
    options.targets || targets(project),
    options,
  );
  return {
    value:
      snap?.value ??
      clamp(quantize(raw, project.canvas.fps, options.precision), 0, max),
    guide: snap?.guide || null,
  };
}
export function applyEdit(project, ref, part, value) {
  const { min, max, found } = rangeFor(project, ref, part, "millisecond");
  if (!Number.isFinite(value) || value < min - EPS || value > max + EPS)
    throw Error("目标时间超出该片段允许的范围");
  value = clean(clamp(value, min, max));
  const item = found.item,
    delta = value - (part === "end" ? found.end : found.start);
  if (ref.kind === "subtitle") {
    if (part === "move") {
      item.start = clean(item.start + delta);
      item.end = clean(item.end + delta);
    } else item[part] = clean(item[part] + delta);
  } else if (ref.kind === "audio") {
    // Older projects may only know the currently referenced source extent. Keep
    // that lower bound fixed so trimming cannot destroy the ability to extend back.
    item.mediaDuration ??= clean((item.offset || 0) + item.duration);
    if (part === "move") item.start = value;
    else if (part === "start") {
      item.start = value;
      item.offset = clean((item.offset || 0) + delta);
      item.duration = clean(item.duration - delta);
    } else item.duration = clean(value - found.start);
    item.fadeIn = Math.min(item.fadeIn || 0, item.duration);
    item.fadeOut = Math.min(item.fadeOut || 0, item.duration);
  } else {
    const s = found.scene;
    if (part === "start")
      trimScene(
        project,
        found.sceneIndex,
        clean(s.in + delta),
        s.out,
        s.hold || 0,
      );
    else {
      const total = clean(value - found.start),
        motion = s.out - s.in,
        capacity = s.hold
          ? motion
          : project.sources[s.sourceId].duration - s.in;
      const out = clean(s.in + Math.min(total, capacity)),
        hold = clean(Math.max(0, total - capacity));
      trimScene(project, found.sceneIndex, s.in, out, hold);
    }
  }
}
export function nudge(project, ref, part, frames) {
  const range = rangeFor(project, ref, part),
    base = part === "end" ? range.found.end : range.found.start;
  applyEdit(
    project,
    ref,
    part,
    clean(clamp(base + frames / project.canvas.fps, range.min, range.max)),
  );
}
export function align(project, ref, command, playhead) {
  const current = findItem(project, ref);
  if (!current) throw Error("片段已不存在");
  if (command === "trim-start" || command === "trim-end") {
    applyEdit(
      project,
      ref,
      command === "trim-start" ? "start" : "end",
      playhead,
    );
    return;
  }
  if (ref.kind === "scene") throw Error("镜头已自动接续，可使用裁剪至播放头");
  let start;
  if (command === "align-start") start = playhead;
  else if (command === "align-end")
    start = playhead - (current.end - current.start);
  else if (command === "join-previous") {
    const previous = items(project)
      .filter(
        (i) =>
          i.ref.kind === ref.kind &&
          refKey(i.ref) !== refKey(ref) &&
          i.start < current.start + EPS &&
          (ref.kind === "subtitle"
            ? i.ref.sceneId === ref.sceneId
            : (i.item.kind || "music") === (current.item.kind || "music")),
      )
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .at(-1);
    if (!previous) throw Error("没有可贴齐的同类前段");
    start = previous.end;
  } else throw Error("不支持的对齐操作");
  applyEdit(project, ref, "move", clean(start));
}
export function reorderTarget(project, id, time) {
  const others = items(project).filter(
      (i) => i.ref.kind === "scene" && i.ref.id !== id,
    ),
    index = others.filter((i) => (i.start + i.end) / 2 < time).length;
  return {
    index,
    time: index < others.length ? others[index].start : duration(project),
    label:
      index < others.length
        ? `插入到「${others[index].label}」之前`
        : "移到片尾",
  };
}
export function reorder(project, id, index) {
  const from = project.scenes.findIndex((s) => s.id === id);
  if (from < 0) throw Error("镜头已不存在");
  moveScene(project, from, index);
}
