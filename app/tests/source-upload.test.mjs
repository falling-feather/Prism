import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverSourceProjects,
  selectSourceFiles,
  zipSourceFiles,
  createSourceArchive,
} from "../src/source-upload.mjs";
const sourceFile = (path, text) =>
  Object.assign(new File([text], path.split("/").at(-1)), {
    webkitRelativePath: path,
  });
test("cancelled source archives do not start a worker", async () => {
  await assert.rejects(
    createSourceArchive([], () => {}, AbortSignal.abort()),
    { name: "AbortError" },
  );
});
test("parent directory discovery lists independent projects and uploads only the selected subtree", async () => {
  const files = [
    sourceFile("系列/说明.txt", "notes"),
    sourceFile(
      "系列/工程/甲/index.html",
      '<title>甲片</title><canvas></canvas><script src="main.js"></script>',
    ),
    sourceFile("系列/工程/甲/main.js", "code"),
    sourceFile("系列/工程/甲/图片/图.png", "png"),
    sourceFile(
      "系列/工程/乙/index.html",
      '<canvas></canvas><script src="app.js"></script>',
    ),
    sourceFile("系列/工程/乙/app.js", "code"),
    sourceFile("系列/网站/index.html", "<title>说明</title><p>no film</p>"),
    sourceFile(
      "系列/.secrets/index.html",
      '<canvas></canvas><script src="x.js"></script>',
    ),
    sourceFile("系列/.secrets/x.js", "secret"),
  ];
  const candidates = await discoverSourceProjects(files);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].title, "甲片");
  assert.deepEqual(
    selectSourceFiles(files, candidates[0].path).map((f) => f.path),
    ["index.html", "main.js", "图片/图.png"],
  );
  assert.equal((await discoverSourceProjects(files.slice(0, 1))).length, 0);
});
test("discovery requires a local existing JavaScript entry and rejects escaped entry paths", async () => {
  const files = [
    sourceFile(
      "根/index.html",
      '<canvas></canvas><script src="../outside.js"></script>',
    ),
    sourceFile("outside.js", "code"),
  ];
  assert.equal((await discoverSourceProjects(files)).length, 0);
  await assert.rejects(
    discoverSourceProjects(files, { signal: AbortSignal.abort() }),
    /取消|abort/i,
  );
});
test("directory discovery also recognizes saved projects without treating arbitrary JSON as a film", async () => {
  const files = [
    sourceFile(
      "根/作品.json",
      JSON.stringify({
        schema: "svgfilm-project",
        title: "已保存作品",
        scenes: [],
      }),
    ),
    sourceFile("根/台词.json", '[{"text":"line"}]'),
    sourceFile("根/工程.prism", "PK\u0003\u0004data"),
  ];
  const candidates = await discoverSourceProjects(files);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c) => c.kind === "file"));
});
test("directory upload keeps source inputs and skips generated media and dependencies", () => {
  const files = [
    ["工程/index.html", "x"],
    ["工程/app.js", "x"],
    ["工程/out/large.mp4", "x"],
    ["工程/node_modules/x.js", "x"],
    ["工程/music.wav", "x"],
  ].map(([name, content]) =>
    Object.assign(new File([content], name.split("/").at(-1)), {
      webkitRelativePath: name,
    }),
  );
  assert.deepEqual(
    selectSourceFiles(files).map((f) => f.path),
    ["index.html", "app.js"],
  );
  assert.throws(() => selectSourceFiles(files.slice(1)), /index.html/);
});
test("source archive writes UTF-8 names and correct CRC without flattening the directory", async () => {
  const files = [
    { path: "index.html", file: new File(["123456789"], "index.html") },
    { path: "子目录/文字.js", file: new File(["code"], "文字.js") },
  ];
  const archive = new Uint8Array(
    await (await zipSourceFiles(files)).arrayBuffer(),
  );
  const view = new DataView(archive.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  assert.equal(view.getUint16(6, true), 0x800);
  assert.equal(
    new TextDecoder().decode(archive.slice(30, 30 + 10)),
    "index.html",
  );
  assert.equal(view.getUint32(archive.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(archive.length - 12, true), 2);
});
