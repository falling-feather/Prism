import test from "node:test";
import assert from "node:assert/strict";
import {
  SourceRegistry,
  validateSource,
  validateParameters,
  canvasCatalog,
} from "../src/source-contract.mjs";

const source = () => ({
  type: "canvas-program-v1",
  duration: 5,
  canvas: { width: 640, height: 360 },
  program: "return {render(ctx,t,api){}};",
  objects: [
    {
      id: "actor",
      label: "角色",
      bounds: [20, 30, 80, 90],
      parameters: {
        speed: { type: "number", label: "速度", default: 1, min: 0, max: 4 },
      },
    },
    {
      id: "title",
      label: "标题",
      bounds: [10, 10, 200, 30],
      text: {
        text: "Hello",
        x: 10,
        y: 35,
        size: 24,
        font: "sans-serif",
        fill: "#123456",
        anchor: "start",
        width: 0,
        start: 0,
        end: 5,
      },
    },
  ],
});
test("a source registry rejects duplicate registration and unsupported types", () => {
  const registry = new SourceRegistry();
  registry.register("test-v1", {
    validate: (s) => {
      if (!s.ok) throw Error("invalid");
    },
  });
  assert.throws(() => registry.register("test-v1", {}), /已注册/);
  assert.throws(() => registry.get("unknown"), /不支持/);
  assert.throws(() => registry.get("test-v1").validate({}), /invalid/);
});
test("Canvas catalogs have stable IDs independent of declaration order", () => {
  const s = source();
  validateSource("demo", s, "0.4.0", {});
  const a = canvasCatalog("demo", s),
    b = canvasCatalog("demo", { ...s, objects: [...s.objects].reverse() });
  assert.deepEqual(
    a.objects.find((o) => o.id === "demo:o:actor"),
    b.objects.find((o) => o.id === "demo:o:actor"),
  );
  assert.equal(a.texts[0].objectId, "demo:o:title");
  assert.equal(a.objects[0].cx, 60);
});
test("malformed catalogs, resources and versions fail before running programs", () => {
  assert.throws(() => validateSource("demo", source(), "0.3.0", {}), /0.4/);
  const s = source();
  s.objects.push({ ...s.objects[0] });
  assert.throws(() => validateSource("demo", s, "0.4.0", {}), /重复/);
  const b = source();
  b.objects[0].bounds[2] = NaN;
  assert.throws(() => validateSource("demo", b, "0.4.0", {}), /边界/);
  const p = source();
  p.objects[0].parentId = "missing";
  assert.throws(() => validateSource("demo", p, "0.4.0", {}), /父对象/);
  const cycle = source();
  cycle.objects[0].parentId = "title";
  cycle.objects[1].parentId = "actor";
  assert.throws(() => validateSource("demo", cycle, "0.4.0", {}), /循环/);
  const asset = source();
  asset.assets = { portrait: "missing" };
  assert.throws(() => validateSource("demo", asset, "0.4.0", {}), /素材/);
});
test("parameter overrides are typed, bounded and tied to declared objects", () => {
  const s = source();
  validateParameters("demo", s, { "demo:o:actor": { speed: 2 } });
  assert.throws(
    () => validateParameters("demo", s, { "demo:o:actor": { speed: 9 } }),
    /速度/,
  );
  assert.throws(
    () => validateParameters("demo", s, { "demo:o:actor": { speed: "2" } }),
    /速度/,
  );
  assert.throws(
    () => validateParameters("demo", s, { "demo:o:actor": { newField: 2 } }),
    /未知参数/,
  );
  assert.throws(
    () => validateParameters("demo", s, { missing: { speed: 2 } }),
    /对象/,
  );
});
test("source-scoped catalogs keep required parents and use the observed text baseline", () => {
  const s = source();
  s.type = "canvas-source-v1";
  s.objects[0].ranges = [[0, 1]];
  s.objects[1].parentId = "actor";
  s.objects[1].ranges = [[1, 3]];
  s.objects[1].textVariants = [
    { start: 1, end: 3, text: { ...s.objects[1].text, text: "Second scene" } },
  ];
  const catalog = canvasCatalog("demo", s, { in: 1, out: 2, hold: 0 });
  assert.equal(catalog.objects.length, 2);
  assert.equal(catalog.texts[0].text, "Second scene");
  assert.equal(catalog.texts[0].nativeDefault.text, "Second scene");
});
