/** svg-keyframes-v1: pure, source-time based motion; no DOM or wall clock. */
export const SVG_ID = /^[A-Za-z][A-Za-z0-9_-]{0,95}$/;
export const CHANNELS = Object.freeze({
  x: [-20000, 20000],
  y: [-20000, 20000],
  scale: [0.001, 100],
  rotation: [-36000, 36000],
  opacity: [0, 1],
});
export const EASINGS = Object.freeze([
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step",
]);
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    throw Error(`${label}包含未知字段或格式无效`);
}
function number(value, min, max, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw Error(`${label}超出范围`);
}
export function validateAnimations(source) {
  if (!Array.isArray(source.animations) || source.animations.length > 2000)
    throw Error("animations 须是最多2000项目标的数组");
  const targets = new Set();
  let count = 0;
  for (const a of source.animations) {
    fields(a, ["target", "origin", "tracks"], "动画");
    if (typeof a.target !== "string" || !SVG_ID.test(a.target))
      throw Error("动画 target 须是有效 SVG id");
    if (targets.has(a.target)) throw Error("动画目标重复");
    targets.add(a.target);
    if (a.origin !== undefined) {
      if (!Array.isArray(a.origin) || a.origin.length !== 2)
        throw Error("origin 须是 [x,y]");
      a.origin.forEach((v) => number(v, -20000, 20000, "动画 origin"));
    }
    if (!record(a.tracks) || !Object.keys(a.tracks).length)
      throw Error("动画 tracks 不能为空");
    for (const [channel, keys] of Object.entries(a.tracks)) {
      if (!Object.hasOwn(CHANNELS, channel))
        throw Error(`未知动画通道 ${channel}`);
      if (!Array.isArray(keys) || !keys.length || keys.length > 1000)
        throw Error(`${channel} 须有1–1000个关键帧`);
      count += keys.length;
      if (count > 100000) throw Error("单来源关键帧总数超过100000");
      let previous = -1;
      for (const [i, key] of keys.entries()) {
        fields(key, ["time", "value", "easing"], "关键帧");
        number(key.time, 0, source.duration, "关键帧时间");
        if ((i === 0 && key.time !== 0) || key.time <= previous)
          throw Error("关键帧须从0开始且时间严格递增");
        previous = key.time;
        number(key.value, ...CHANNELS[channel], channel);
        if (key.easing !== undefined && !EASINGS.includes(key.easing))
          throw Error("未知关键帧缓动");
      }
    }
  }
}
export function sampleTrack(keys, time) {
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys.at(-1).time) return keys.at(-1).value;
  let left = 0,
    right = keys.length - 1;
  while (right - left > 1) {
    const mid = (left + right) >> 1;
    if (keys[mid].time <= time) left = mid;
    else right = mid;
  }
  const a = keys[left],
    b = keys[right],
    u = (time - a.time) / (b.time - a.time);
  const t =
    a.easing === "step"
      ? 0
      : a.easing === "ease-in"
        ? u * u
        : a.easing === "ease-out"
          ? 1 - (1 - u) ** 2
          : a.easing === "ease-in-out"
            ? u < 0.5
              ? 2 * u * u
              : 1 - (-2 * u + 2) ** 2 / 2
            : u;
  return a.value + (b.value - a.value) * t;
}
export function sampleAnimation(animation, time) {
  const pose = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
  for (const [channel, keys] of Object.entries(animation.tracks))
    pose[channel] = sampleTrack(keys, time);
  return pose;
}
