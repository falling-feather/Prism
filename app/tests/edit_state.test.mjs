import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/project.mjs";
const make = () => ({
  schema: "svgfilm-project",
  schemaVersion: "0.3.0",
  projectId: "perf",
  title: "测试",
  canvas: { width: 640, height: 360, fps: 30 },
  sources: {
    s: { type: "svg", svg: '<svg><text>汉字"\n</text></svg>', duration: 3 },
  },
  scenes: [
    {
      id: "one",
      sourceId: "s",
      name: "一",
      in: 0,
      out: 3,
      hold: 0,
      texts: [],
      objects: [],
      objectOverrides: {},
      subtitles: [],
    },
  ],
  audioTracks: [
    {
      id: "a",
      name: "audio",
      dataUrl: "data:audio/wav;base64,AA\r\nAA",
      start: 0,
      offset: 0,
      duration: 1,
      volume: 0.5,
      fadeIn: 0,
      fadeOut: 0,
    },
  ],
});
test("light snapshots retain serialized field order as well as values", () => {
  const p = make(),
    before = JSON.stringify(p);
  assert.equal(JSON.stringify(P.snapshotProject(p)), before);
});
test("edit snapshots share immutable sources but isolate every mutable field", () => {
  assert.equal(typeof P.snapshotProject, "function");
  const p = make(),
    s = P.snapshotProject(p);
  assert.equal(s.sources, p.sources);
  assert.throws(() => {
    p.sources.s.duration = 9;
  }, TypeError);
  p.scenes[0].hold = 2;
  p.audioTracks[0].start = 1;
  p.canvas.width = 720;
  assert.equal(s.scenes[0].hold, 0);
  assert.equal(s.audioTracks[0].start, 0);
  assert.equal(s.canvas.width, 640);
});
test("undo and redo keep source identity while returning independent edit states", () => {
  const p = make(),
    h = new P.History();
  h.push(p);
  p.scenes[0].hold = 1;
  const old = h.undo(p);
  assert.equal(old.sources, p.sources);
  assert.equal(old.scenes[0].hold, 0);
  assert.equal(h.redo(old).scenes[0].hold, 1);
});
test("adding a source preserves an older snapshot and validates the new source", () => {
  const p = make(),
    s = P.snapshotProject(p),
    v = new P.EditValidator();
  v.validate(p);
  p.sources = { ...p.sources, b: { type: "svg", svg: "<svg/>", duration: 2 } };
  v.validate(p);
  assert.equal(s.sources.b, undefined);
  assert.ok(Object.isFrozen(p.sources.b));
});
test("cached UTF-8 budget is identical to real JSON including audio escapes and new keys", () => {
  const p = make(),
    v = new P.EditValidator();
  v.validate(p);
  assert.equal(
    v.byteLength(p),
    new TextEncoder().encode(JSON.stringify(p)).length,
  );
  p.extra = "汉😀";
  p.audioTracks.push({
    ...p.audioTracks[0],
    id: "b",
    dataUrl: "data:audio/wav;base64,ABCD",
  });
  v.validate(p);
  assert.equal(
    v.byteLength(p),
    new TextEncoder().encode(JSON.stringify(p)).length,
  );
});
test("cached validation still rejects invalid edits and invalid replacement media", () => {
  const p = make(),
    v = new P.EditValidator();
  v.validate(p);
  p.scenes[0].out = 5;
  assert.throws(() => v.validate(p), /范围/);
  p.scenes[0].out = 3;
  p.audioTracks[0].dataUrl = "https://example.com/audio";
  assert.throws(() => v.validate(p), /音频/);
});
test("cached validation does not skip version and source reference changes", () => {
  const p = make(),
    v = new P.EditValidator();
  v.validate(p);
  p.schemaVersion = "99";
  assert.throws(() => v.validate(p));
  p.schemaVersion = "0.3.0";
  p.sources = { s: { type: "other", duration: 3 } };
  assert.throws(() => v.validate(p), /来源/);
});
test("cached budget rejects an oversized metadata change", () => {
  const p = make(),
    v = new P.EditValidator();
  v.validate(p);
  p.title = "汉".repeat(43 * 1024 * 1024);
  assert.throws(() => v.validate(p), /120 MB/);
});
