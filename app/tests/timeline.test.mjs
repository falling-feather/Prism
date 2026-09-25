import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../src/timeline.mjs";
import { validateProject, sceneStart } from "../src/project.mjs";
const sub = { kind: "subtitle", sceneId: "a", id: "one" },
  audio = { kind: "audio", id: "voice" },
  scene = { kind: "scene", id: "a" };
const fixture = () => ({
  schema: "svgfilm-project",
  schemaVersion: "0.2.0",
  canvas: { width: 1280, height: 720, fps: 30 },
  sources: { source: { type: "svg", svg: "<svg/>", duration: 10 } },
  scenes: [
    {
      id: "a",
      sourceId: "source",
      name: "一",
      in: 0,
      out: 8,
      hold: 0,
      texts: [],
      objects: [],
      objectOverrides: {},
      subtitles: [
        { id: "one", text: "一", start: 1, end: 3 },
        { id: "two", text: "二", start: 4, end: 6 },
      ],
    },
    {
      id: "b",
      sourceId: "source",
      name: "二",
      in: 0,
      out: 8,
      hold: 0,
      texts: [],
      objects: [],
      objectOverrides: {},
      subtitles: [],
    },
  ],
  audioTracks: [
    {
      id: "voice",
      kind: "voice",
      name: "配音",
      dataUrl: "data:audio/wav;base64,AAAA",
      start: 2,
      offset: 1,
      duration: 5,
      mediaDuration: 20,
      volume: 0.5,
      fadeIn: 1,
      fadeOut: 2,
    },
  ],
});
test("magnet chooses the playhead and preserves the moved subtitle length", () => {
  assert.equal(typeof T.proposeEdit, "function");
  const p = fixture(),
    r = T.proposeEdit(p, sub, "move", 2.04, {
      playhead: 2,
      scale: 100,
      threshold: 8,
      snap: true,
    });
  assert.equal(r.value, 2);
  assert.equal(r.end - r.start, 2);
  assert.equal(r.guide.kind, "playhead");
});
test("the trailing edge can snap to another subtitle without changing duration", () => {
  const p = fixture();
  p.audioTracks = [];
  const r = T.proposeEdit(p, sub, "move", 1.95, {
    scale: 100,
    threshold: 8,
    snap: true,
  });
  assert.equal(r.value, 2);
  assert.equal(r.guide.movingEdge, "end");
});
test("magnet radius is measured in pixels at each zoom", () => {
  const p = fixture();
  assert.equal(
    T.proposeEdit(p, sub, "move", 1.8, {
      playhead: 2,
      scale: 20,
      threshold: 8,
      snap: true,
    }).value,
    2,
  );
  assert.equal(
    T.proposeEdit(p, sub, "move", 1.8, {
      playhead: 2,
      scale: 200,
      threshold: 8,
      snap: true,
    }).guide,
    null,
  );
});
test("Alt-style bypass allows millisecond motion and does not snap", () => {
  const r = T.proposeEdit(fixture(), sub, "move", 1.947, {
    playhead: 2,
    scale: 100,
    snap: false,
    precision: "millisecond",
  });
  assert.equal(r.value, 1.947);
  assert.equal(r.guide, null);
});
test("moving items do not magnetize to their own previous edges", () => {
  const p = fixture();
  p.audioTracks = [];
  const r = T.proposeEdit(p, sub, "move", 1.04, { scale: 100, snap: true });
  assert.equal(r.guide, null);
  assert.ok(Math.abs(r.value - 31 / 30) < 1e-9);
});
test("subtitle edits stay inside the owning scene", () => {
  const p = fixture(),
    r = T.proposeEdit(p, sub, "move", 7.9, { snap: false });
  T.applyEdit(p, sub, "move", r.value);
  assert.equal(p.scenes[0].subtitles[0].start, 6);
  assert.equal(p.scenes[0].subtitles[0].end, 8);
  validateProject(p);
});
test("left audio trim advances source offset and keeps the right edge fixed", () => {
  const p = fixture();
  T.applyEdit(p, audio, "start", 3);
  assert.deepEqual(
    [
      p.audioTracks[0].start,
      p.audioTracks[0].offset,
      p.audioTracks[0].duration,
    ],
    [3, 2, 4],
  );
  validateProject(p);
});
test("audio extension is bounded by available source audio", () => {
  const p = fixture(),
    r = T.proposeEdit(p, audio, "end", 25, { snap: false });
  assert.equal(r.value, 21);
  T.applyEdit(p, audio, "end", r.value);
  assert.equal(p.audioTracks[0].duration, 19);
  assert.throws(() => T.applyEdit(p, audio, "end", 22), /范围/);
});
test("scene tail trimming ripples following scenes but keeps global audio fixed", () => {
  const p = fixture();
  T.applyEdit(p, scene, "end", 6);
  assert.equal(sceneStart(p, 1), 6);
  assert.equal(p.audioTracks[0].start, 2);
  validateProject(p);
});
test("extending an existing hold keeps the chosen source out point", () => {
  const p = fixture();
  Object.assign(p.scenes[0], { in: 2, out: 5, hold: 3, subtitles: [] });
  T.applyEdit(p, scene, "end", 7);
  assert.deepEqual(
    [p.scenes[0].in, p.scenes[0].out, p.scenes[0].hold],
    [2, 5, 4],
  );
});
test("audio fades remain valid after a short trim", () => {
  const p = fixture();
  T.applyEdit(p, audio, "end", 2.5);
  assert.deepEqual(
    [p.audioTracks[0].fadeIn, p.audioTracks[0].fadeOut],
    [0.5, 0.5],
  );
  validateProject(p);
});
test("frame timecodes parse, format and reject impossible frame numbers", () => {
  assert.equal(T.parseTime("00:01:02:15", 30), 62.5);
  assert.equal(T.formatTimecode(62.5, 30), "00:01:02:15");
  assert.throws(() => T.parseTime("00:00:01:30", 30), /时间/);
  assert.throws(() => T.parseTime("00:65:00:00", 30), /时间/);
});
test("repeated frame nudges preserve duration and do not accumulate drift", () => {
  const p = fixture();
  p.scenes[0].subtitles[0].start = 0.125;
  p.scenes[0].subtitles[0].end = 2.125;
  for (let i = 0; i < 30; i++) T.nudge(p, sub, "move", 1);
  assert.ok(Math.abs(p.scenes[0].subtitles[0].start - 1.125) < 1e-8);
  assert.ok(Math.abs(p.scenes[0].subtitles[0].end - 3.125) < 1e-8);
});
test("explicit alignment refuses impossible targets rather than claiming a clamped alignment", () => {
  const p = fixture();
  T.align(p, sub, "align-end", 5);
  assert.equal(p.scenes[0].subtitles[0].start, 3);
  assert.throws(() => T.align(p, sub, "align-start", 7), /范围/);
});
test("join previous uses the same audio kind and ignores an underlying music bed", () => {
  const p = fixture();
  p.audioTracks[0].start = 7;
  p.audioTracks.push({
    ...p.audioTracks[0],
    id: "previous",
    start: 0,
    duration: 3,
  });
  p.audioTracks.push({
    ...p.audioTracks[0],
    id: "music",
    kind: "music",
    start: 0,
    duration: 16,
  });
  T.align(p, audio, "join-previous", 0);
  assert.equal(p.audioTracks[0].start, 3);
});
test("scene head snapping marks the original content cut point and rebases its captions", () => {
  const p = fixture();
  p.audioTracks = [];
  const r = T.proposeEdit(p, scene, "start", 0.98, { scale: 200 });
  assert.equal(r.value, 1);
  assert.equal(r.guide.interpretation, "cut-reference");
  assert.ok(!T.targets(p, scene).some((t) => t.label === "片尾"));
  T.applyEdit(p, scene, "start", r.value);
  assert.equal(p.scenes[0].in, 1);
  assert.equal(p.scenes[0].subtitles[0].start, 0);
  assert.equal(sceneStart(p, 1), 7);
  validateProject(p);
});
test("last playable frame ignores floating-point noise at an exact duration", () => {
  const p = fixture();
  p.audioTracks = [];
  p.scenes.forEach((s, i) => {
    s.out = i ? 0.2 : 0.1;
    s.subtitles = [];
  });
  assert.equal(T.proposeSeek(p, 100, { snap: false }).value, 8 / 30);
});
test("legacy audio keeps its known source extent after trimming and re-extending", () => {
  const p = fixture();
  delete p.audioTracks[0].mediaDuration;
  T.applyEdit(p, audio, "end", 5);
  T.applyEdit(p, audio, "end", 7);
  assert.equal(p.audioTracks[0].duration, 5);
  assert.equal(p.audioTracks[0].mediaDuration, 6);
  validateProject(p);
});
test("project frame rate controls minimum trims and non-drop timecode round trips", () => {
  for (const fps of [24, 25, 29.97, 60]) {
    const p = fixture();
    p.canvas.fps = fps;
    const r = T.proposeEdit(p, scene, "start", 7.99, { snap: false });
    T.applyEdit(p, scene, "start", r.value);
    assert.ok(Math.abs(p.scenes[0].out - p.scenes[0].in - 1 / fps) < 1e-9);
    validateProject(p);
    for (const frame of [1, Math.round(fps) - 1, 1800]) {
      assert.equal(
        T.parseTime(T.formatTimecode(frame / fps, fps), fps),
        frame / fps,
      );
    }
  }
});
