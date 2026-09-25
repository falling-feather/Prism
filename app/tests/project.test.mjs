import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/project.mjs";
const fixture = () => ({
  schema: "svgfilm-project",
  schemaVersion: "0.2.0",
  projectId: "lesson",
  title: "测试",
  canvas: { width: 1280, height: 720, fps: 30 },
  workflow: { script: { status: "confirmed" } },
  sources: {
    s: {
      type: "svg",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>原文</text></svg>',
      duration: 10,
    },
  },
  scenes: [
    {
      id: "clip",
      sourceId: "s",
      name: "一幕",
      in: 0,
      out: 10,
      hold: 0,
      texts: [],
      objects: [],
      objectOverrides: {},
      subtitles: [{ id: "caption", text: "跨切点字幕", start: 3, end: 8 }],
    },
  ],
  audioTracks: [],
});
test("splitting preserves source time and rebases crossing captions", () => {
  assert.equal(typeof P.splitScene, "function");
  const p = fixture();
  P.splitScene(p, 0, 5);
  assert.deepEqual(
    p.scenes.map((s) => [s.in, s.out]),
    [
      [0, 5],
      [5, 10],
    ],
  );
  assert.deepEqual(
    p.scenes.map((s) => s.subtitles.map((l) => [l.start, l.end])),
    [[[3, 5]], [[0, 3]]],
  );
  assert.notEqual(p.scenes[0].id, p.scenes[1].id);
});
test("trimming drops out-of-range captions and rebases retained text", () => {
  const p = fixture();
  P.trimScene(p, 0, 4, 9, 1);
  assert.equal(P.duration(p), 6);
  assert.deepEqual(
    p.scenes[0].subtitles.map((l) => [l.start, l.end]),
    [[0, 4]],
  );
});
test("portable save keeps independent SVG source and drops stale subtitle rows", () => {
  const p = fixture();
  p.scenes[0].subtitles[0].rows = ["旧内容"];
  const saved = P.serializeProject(p);
  const q = P.parseProject(saved);
  assert.match(q.sources.s.svg, /原文/);
  assert.equal(q.scenes[0].subtitles[0].rows, undefined);
});
test("scene lookup uses edited order and holds at source out point", () => {
  const p = fixture();
  P.splitScene(p, 0, 5);
  p.scenes.reverse();
  p.scenes[0].hold = 2;
  assert.equal(P.locate(p, 6).sourceTime, 10);
  assert.equal(P.locate(p, 7.5).sourceTime, 0.5);
});
test("decimal cut boundaries locate the following scene without a negative source time", () => {
  const p = fixture();
  p.scenes = [0.1, 0.2, 1].map((out, i) => ({
    ...structuredClone(p.scenes[0]),
    id: String(i),
    out,
    subtitles: [],
  }));
  const at = P.locate(p, 0.3);
  assert.equal(at.index, 2);
  assert.equal(at.local, 0);
  assert.equal(at.sourceTime, 0);
  assert.equal(P.locate(p, 0.3 - 0.000001).index, 1);
  assert.equal(P.frameCount(0.1 + 0.2, 30), 9);
  assert.equal(P.frameCount(0.301, 30), 10);
});
test("trimming and splitting discard caption fragments shorter than the schema minimum", () => {
  const p = fixture();
  Object.assign(p.scenes[0], {
    in: 4.713,
    out: 10,
    hold: 0.763,
    subtitles: [{ id: "s", text: "句尾", start: 4.016, end: 4.371 }],
  });
  P.trimScene(p, 0, 9.084, 10, 0.763);
  assert.deepEqual(p.scenes[0].subtitles, []);
  P.validateProject(p);
  const q = fixture();
  q.scenes[0].subtitles = [
    { id: "s", text: "跨边界", start: 7.9995, end: 8.5 },
  ];
  P.trimScene(q, 0, 0, 8);
  assert.deepEqual(q.scenes[0].subtitles, []);
  P.validateProject(q);
  const r = fixture();
  r.scenes[0].subtitles = [
    { id: "s", text: "跨边界", start: 7.9995, end: 8.5 },
  ];
  P.splitScene(r, 0, 8);
  assert.deepEqual(r.scenes[0].subtitles, []);
  assert.equal(r.scenes[1].subtitles[0].end, 0.5);
  P.validateProject(r);
});
test("invalid ranges and missing source are rejected before replacing work", () => {
  const p = fixture();
  p.scenes[0].out = 20;
  assert.throws(() => P.validateProject(p), /范围/);
  p.scenes[0].out = 10;
  delete p.sources.s;
  assert.throws(() => P.validateProject(p), /来源/);
});
test("audio gain observes track offset and both fades", () => {
  const a = { start: 2, duration: 8, volume: 0.6, fadeIn: 2, fadeOut: 2 };
  assert.equal(P.audioGain(a, 1), 0);
  assert.equal(P.audioGain(a, 3), 0.3);
  assert.equal(P.audioGain(a, 9), 0.3);
  assert.equal(P.audioGain(a, 10), 0);
});
test("overlapping fades use the same product envelope as encoded audio", () => {
  assert.equal(
    P.audioGain({ start: 0, duration: 2, volume: 1, fadeIn: 2, fadeOut: 2 }, 1),
    0.25,
  );
});
test("SRT roundtrip preserves multiline captions and millisecond timing", () => {
  const p = fixture();
  p.scenes[0].subtitles = [
    { id: "s", text: "第一行\n第二行", start: 0.125, end: 2.25 },
  ];
  assert.deepEqual(
    P.parseSrt(P.toSrt(p)).map((s) => [s.start, s.end, s.text]),
    [[0.125, 2.25, "第一行\n第二行"]],
  );
});
test("oversized UTF-8 projects are rejected before an unreadable save is accepted", () => {
  const p = fixture();
  p.title = "汉".repeat(43 * 1024 * 1024);
  assert.throws(() => P.serializeProject(p), /120 MB/);
});
