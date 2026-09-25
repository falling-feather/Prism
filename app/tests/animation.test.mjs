import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/project.mjs";
const fixture = () => ({
  schema: "svgfilm-project",
  schemaVersion: "0.3.0",
  projectId: "animation-test",
  title: "动画",
  canvas: { width: 640, height: 360, fps: 30 },
  sources: {
    s: {
      type: "svg-keyframes-v1",
      duration: 3,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect id="box" width="60" height="60"/></svg>',
      animations: [
        {
          target: "box",
          origin: [30, 30],
          tracks: {
            x: [
              { time: 0, value: 0 },
              { time: 3, value: 180 },
            ],
            opacity: [
              { time: 0, value: 0 },
              { time: 1, value: 1 },
            ],
          },
        },
      ],
    },
  },
  scenes: [
    {
      id: "scene",
      sourceId: "s",
      name: "动画",
      in: 0,
      out: 3,
      hold: 0,
      texts: [],
      objects: [],
      objectOverrides: {},
      subtitles: [],
    },
  ],
  audioTracks: [],
});
test("0.3 accepts a declarative animated source while 0.2 remains readable", () => {
  P.validateProject(fixture());
  const old = fixture();
  old.schemaVersion = "0.2.0";
  old.sources.s.type = "svg";
  delete old.sources.s.animations;
  P.validateProject(old);
});
test("new animation cannot masquerade as an old project or silently use an unknown channel", () => {
  const p = fixture();
  p.schemaVersion = "0.2.0";
  assert.throws(() => P.validateProject(p), /0.3/);
  p.schemaVersion = "0.3.0";
  p.sources.s.animations[0].tracks.spin = [{ time: 0, value: 1 }];
  assert.throws(() => P.validateProject(p), /spin|通道/);
});
test("animation time/value contracts reject duplicate keys, invalid scale and missing zero pose", () => {
  for (const keys of [
    [
      { time: 0, value: 1 },
      { time: 0, value: 2 },
    ],
    [{ time: 1, value: 1 }],
    [{ time: 0, value: 0 }],
    [
      { time: 0, value: 1 },
      { time: 4, value: 1 },
    ],
  ]) {
    const p = fixture();
    p.sources.s.animations[0].tracks.scale = keys;
    assert.throws(() => P.validateProject(p));
  }
});
test("animated source targets are unique and unknown easing is rejected", () => {
  const p = fixture();
  p.sources.s.animations.push(structuredClone(p.sources.s.animations[0]));
  assert.throws(() => P.validateProject(p), /重复/);
  p.sources.s.animations.pop();
  p.sources.s.animations[0].tracks.x[0].easing = "bounce";
  assert.throws(() => P.validateProject(p), /缓动/);
});
test("sampling is seek-safe, uses starting-key easing, and holds the last key", async () => {
  const A = await import("../src/animation.mjs");
  const keys = [
    { time: 0, value: 0, easing: "ease-in" },
    { time: 2, value: 100 },
    { time: 3, value: 200 },
  ];
  assert.equal(A.sampleTrack(keys, 1), 25);
  assert.equal(A.sampleTrack(keys, 3), 200);
  assert.equal(A.sampleTrack(keys, 0), 0);
  assert.equal(A.sampleTrack(keys, 1), 25);
  assert.equal(A.sampleTrack(keys, 4), 200);
  assert.equal(
    A.sampleTrack(
      [
        { time: 0, value: 0, easing: "step" },
        { time: 1, value: 1 },
      ],
      0.99,
    ),
    0,
  );
  assert.equal(
    A.sampleTrack(
      [
        { time: 0, value: 0, easing: "step" },
        { time: 1, value: 1 },
      ],
      1,
    ),
    1,
  );
});
test("source clock survives splitting, trimming and a tail hold", async () => {
  const A = await import("../src/animation.mjs"),
    p = fixture();
  P.splitScene(p, 0, 1);
  assert.equal(
    A.sampleAnimation(p.sources.s.animations[0], P.locate(p, 1.5).sourceTime).x,
    90,
  );
  P.trimScene(p, 1, 1.5, 3, 1);
  assert.equal(
    A.sampleAnimation(p.sources.s.animations[0], P.locate(p, 1).sourceTime).x,
    90,
  );
  assert.equal(
    A.sampleAnimation(p.sources.s.animations[0], P.locate(p, 3).sourceTime).x,
    180,
  );
});
test("new profile checks every source including unreferenced assets", () => {
  const p = fixture();
  p.sources.unused = {
    type: "svg-keyframes-v1",
    duration: 3,
    svg: "<svg/>",
    animations: [
      { target: "gone", tracks: { opacity: [{ time: 0, value: 2 }] } },
    ],
  };
  assert.throws(() => P.validateProject(p), /opacity|透明|范围/);
});
export { fixture };
