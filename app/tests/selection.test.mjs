import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/selection.mjs";
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const scene = () => ({ objectOverrides: {} });
const pair = () => [
  {
    id: "a",
    parent: identity,
    pivot: { x: 50, y: 50 },
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
  },
  {
    id: "b",
    parent: identity,
    pivot: { x: 250, y: 50 },
    bounds: { left: 200, top: 0, right: 300, bottom: 100 },
  },
];
test("selecting parent and child transforms only the parent", () => {
  assert.equal(typeof S.canonicalIds, "function");
  assert.deepEqual(
    S.canonicalIds(
      ["child", "parent", "other", "child"],
      new Map([
        ["child", "parent"],
        ["parent", "root"],
      ]),
    ),
    ["parent", "other"],
  );
});
test("marquee selects fully enclosed objects, not partially crossed ones", () => {
  assert.equal(
    S.containsRect(
      { left: 0, top: 0, right: 200, bottom: 200 },
      { left: 10, top: 10, right: 100, bottom: 100 },
    ),
    true,
  );
  assert.equal(
    S.containsRect(
      { left: 0, top: 0, right: 200, bottom: 200 },
      { left: 190, top: 10, right: 210, bottom: 100 },
    ),
    false,
  );
});
test("independent scaling keeps each component center fixed", () => {
  const r = S.scaleOverrides(scene(), pair(), 2, "individual");
  assert.deepEqual([r.a.dx, r.b.dx, r.a.scale, r.b.scale], [0, 0, 2, 2]);
});
test("group scaling increases component spacing around the union center", () => {
  const r = S.scaleOverrides(scene(), pair(), 2, "group");
  assert.deepEqual([r.a.dx, r.b.dx, r.a.scale, r.b.scale], [-100, 100, 2, 2]);
});
test("independent scaling compensates when the animation center differs from its pivot", () => {
  const r = S.scaleOverrides(
    { objectOverrides: { a: { dx: 10, scale: 2 } } },
    [
      {
        ...pair()[0],
        pivot: { x: 0, y: 50 },
        bounds: { left: 30, top: 0, right: 70, bottom: 100 },
      },
    ],
    2,
    "individual",
  );
  assert.equal(r.a.dx, -30);
  assert.equal(r.a.scale, 4);
});
test("batch movement converts world delta separately for rotated and scaled parents", () => {
  const p = { a: 0, b: 2, c: -2, d: 0, e: 100, f: 50 };
  const r = S.translateOverrides(
    { objectOverrides: { a: { dx: 10, dy: 20, rotation: 15 } } },
    [{ ...pair()[0], parent: p }, pair()[1]],
    12,
    8,
  );
  assert.deepEqual(
    [r.a.dx, r.a.dy, r.a.rotation, r.b.dx, r.b.dy],
    [14, 14, 15, 12, 8],
  );
});
test("batch scale rejects out-of-range results without mutating any original overrides", () => {
  const s = { objectOverrides: { a: { scale: 15 } } };
  assert.throws(() => S.scaleOverrides(s, pair(), 2, "group"), /缩放/);
  assert.deepEqual(s, { objectOverrides: { a: { scale: 15 } } });
});
