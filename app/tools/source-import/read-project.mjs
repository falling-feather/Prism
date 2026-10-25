import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { build } from "esbuild";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generatorModule from "@babel/generator";
import { instrument } from "./instrument.mjs";
import { imageInfo } from "./image-info.mjs";
const traverse = traverseModule.default || traverseModule,
  generate = generatorModule.default || generatorModule;
const [directory, output, query = ""] = process.argv.slice(2);
if (!directory || !output)
  throw Error("Usage: read-project.mjs directory output-draft.json [query]");
const root = await fs.realpath(directory),
  out = path.resolve(output),
  html = await fs.readFile(path.join(root, "index.html"), "utf8");
const tags = [...html.matchAll(/<canvas\b([^>]*)>/gi)];
if (tags.length !== 1)
  throw Error("源码需要一个明确的主Canvas，多个画布时请提供入口配置");
const attributes = Object.fromEntries(
  [...tags[0][1].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [
    m[1],
    m[2],
  ]),
);
const scripts = [
  ...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi),
];
if (scripts.length !== 1) throw Error("当前源码读取器需要唯一的JavaScript入口");
const inside = (relative) => {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep))
    throw Error("源码引用超出导入目录：" + relative);
  return resolved;
};
const entry = inside(scripts[0][1]);
const first = await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  sourcemap: "external",
  metafile: true,
  outfile: out + ".bundle.js",
});
const code = first.outputFiles.find((f) => f.path.endsWith(".js")).text,
  map = JSON.parse(first.outputFiles.find((f) => f.path.endsWith(".map")).text);
map.sources = map.sources.map((name) =>
  path
    .relative(root, path.resolve(path.dirname(out), decodeURIComponent(name)))
    .replaceAll("\\", "/"),
);
const virtualFiles = {};
for (const file of Object.keys(first.metafile.inputs)) {
  const absolute = path.resolve(file);
  if (!absolute.startsWith(root + path.sep))
    throw Error("模块引用超出导入目录：" + file);
  if (!/\.[cm]?js$/i.test(file)) continue;
  const source = await fs.readFile(absolute, "utf8"),
    ast = parse(source, { sourceType: "module" });
  traverse(ast, {
    StringLiteral(p) {
      const value = p.node.value;
      if (/\.json$/i.test(value) && !value.includes("://")) {
        const relative = path
          .relative(root, path.resolve(path.dirname(absolute), value))
          .replaceAll("\\", "/");
        if (!relative.startsWith("../")) virtualFiles[relative] = null;
      }
    },
  });
}
for (const key of Object.keys(virtualFiles)) {
  try {
    virtualFiles[key] = JSON.parse(await fs.readFile(inside(key), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") delete virtualFiles[key];
    else throw error;
  }
}
const resources = [],
  aliases = {};
const mime = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
async function files(folder) {
  for (const e of await fs.readdir(folder, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!["node_modules", ".git", ".work", "out", "tools"].includes(e.name))
        await files(path.join(folder, e.name));
    } else if (mime[path.extname(e.name).toLowerCase()]) {
      const absolute = await fs.realpath(path.join(folder, e.name));
      if (!absolute.startsWith(root + path.sep))
        throw Error("素材链接超出导入目录");
      const relative = path.relative(root, absolute).replaceAll("\\", "/"),
        alias = "asset-" + String(resources.length).padStart(4, "0");
      aliases[relative.toLowerCase()] = alias;
      resources.push({
        alias,
        ...(mime[path.extname(e.name).toLowerCase()].startsWith("image/")
          ? { dimensions: await imageInfo(absolute) }
          : {}),
        path: absolute,
        name: relative,
        mime: mime[path.extname(relative).toLowerCase()],
      });
    }
  }
}
await files(root);
const fonts = [];
for (const link of html.matchAll(
  /<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi,
)) {
  const cssPath = inside(link[1]),
    css = await fs.readFile(cssPath, "utf8");
  for (const rule of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
    const body = rule[1],
      family = body.match(/font-family\s*:\s*['"]?([^;'"}]+)/i)?.[1]?.trim(),
      url = body.match(/url\(\s*['"]?([^)'"\s]+)/i)?.[1];
    if (!family || !url) continue;
    const relative = path
      .relative(root, path.resolve(path.dirname(cssPath), url))
      .replaceAll("\\", "/")
      .toLowerCase();
    const asset = aliases[relative];
    if (!asset) throw Error("字体素材没有登记：" + url);
    const weight = body.match(/font-weight\s*:\s*([^;}]+)/i)?.[1]?.trim();
    fonts.push({ asset, family, ...(weight ? { weight } : {}) });
  }
}
const traced = instrument(code, {
  sourceMap: map,
  filename: path.relative(root, entry),
});
const body = parse(traced.code, { sourceType: "module" });
body.program.body = body.program.body.filter(
  (n) =>
    n.type !== "ExportNamedDeclaration" &&
    n.type !== "ExportDefaultDeclaration",
);
const native = generate(body, { comments: false }).code;
const bridge = fileURLToPath(
  new URL("../../src/source-bridge.mjs", import.meta.url),
);
const prefix = `import {createSourceBridge} from ${JSON.stringify(bridge.replaceAll("\\", "/"))};\nconst __prismSourceBridge=createSourceBridge();\n`;
const normalize = `const _key=value=>decodeURIComponent(String(value).split('?')[0]).replace(/^\\.\\//,'').toLowerCase();`;
const factory = `export default async function(assets){
  const _aliases=${JSON.stringify(aliases)},_files=${JSON.stringify(virtualFiles)},_dimensions=${JSON.stringify(Object.fromEntries(resources.filter((r) => r.dimensions).map((r) => [r.alias, r.dimensions])))};${normalize}
  __prismSourceBridge.setImageProvider({peek:assets.peekImage,request:assets.requestImage});
  const _canvas=new OffscreenCanvas(${Number(attributes.width) || 300},${Number(attributes.height) || 150});
  const window={},location={search:${JSON.stringify(query ? "?" + query.replace(/^\?/, "") : "")}};
  const document={getElementById:id=>{if(id!==${JSON.stringify(attributes.id || "c")})throw Error('不支持的DOM节点：'+id);return _canvas;},createElement:name=>{if(name!=='canvas')throw Error('不支持的DOM元素：'+name);return new OffscreenCanvas(1,1);},fonts:{load:async()=>[],ready:Promise.resolve()}};
  const fetch=async value=>{const key=_key(value);if(!Object.hasOwn(_files,key))throw Error('没有登记JSON资源：'+value);return {ok:true,json:async()=>structuredClone(_files[key]),text:async()=>JSON.stringify(_files[key])};};
  const Image=function(){const image=new OffscreenCanvas(1,1);let pending=Promise.resolve();Object.defineProperty(image,'src',{set(value){const alias=_aliases[_key(value)],size=_dimensions[alias];if(!size)throw Error('没有登记图片：'+value);image.width=size.width;image.height=size.height;__prismSourceBridge.lazyImage(image,alias);pending=Promise.resolve().then(()=>image.onload?.());}});image.decode=()=>pending;return image;};
  try {
  ${native}
  if(typeof window.render!=='function'||!Number.isFinite(window.DUR))throw Error('源码没有render(t)与DUR接口');
  __prismSourceBridge.ready();
  const _shots=typeof SHOTS!=='undefined'?SHOTS:[];
  const _anchors=[...(window.EV||[]).flatMap(e=>[e.t,e.t1]),...Object.values(window.TL||{}).flatMap(e=>[e.t0,e.t1])].filter(Number.isFinite);
  return {dispose:()=>__prismSourceBridge.dispose(),metadata:{duration:window.DUR,width:_canvas.width,height:_canvas.height,anchors:_anchors,shots:_shots.map((s,i)=>({start:s.t0,end:_shots[i+1]?.t0??window.DUR,name:'原始镜头 '+(i+1)}))},
    diagnostics:()=>__prismSourceBridge.diagnostics(),
    exportState:()=>__prismSourceBridge.exportState(),restoreState:states=>__prismSourceBridge.restoreState(states),
    async renderOriginal(ctx,time){await __prismSourceBridge.original(_canvas,()=>window.render(time));ctx.drawImage(_canvas,0,0);},
    async render(ctx,time,api){await __prismSourceBridge.frame(api,_canvas,()=>window.render(time));ctx.drawImage(_canvas,0,0);}
  };
  }catch(error){__prismSourceBridge.dispose();throw error;}
}`;
const second = await build({
  stdin: {
    contents: prefix + factory,
    resolveDir: root,
    sourcefile: "imported-source.js",
  },
  bundle: true,
  format: "iife",
  globalName: "CanvasSourceFactory",
  platform: "browser",
  target: "es2022",
  write: false,
  minify: true,
});
const program =
  second.outputFiles[0].text +
  ";return CanvasSourceFactory.default(__prismSourceAssets);";
const fileSet = new Set([
  path.join(root, "index.html"),
  ...Object.keys(first.metafile.inputs).map((file) => path.resolve(file)),
  ...Object.keys(virtualFiles).map((file) => inside(file)),
  ...Array.from(
    html.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi),
    (m) => inside(m[1]),
  ),
]);
const sourceFiles = [...fileSet].map((file) => ({
  path: file,
  name: path.relative(root, file).replaceAll("\\", "/"),
  alias:
    "source-" +
    crypto
      .createHash("sha256")
      .update(path.relative(root, file).replaceAll("\\", "/"))
      .digest("hex")
      .slice(0, 20),
}));
await fs.writeFile(
  out,
  JSON.stringify(
    {
      program,
      resources,
      sourceFiles,
      fonts,
      title: html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || null,
      width: Number(attributes.width) || 300,
      height: Number(attributes.height) || 150,
      helpers: traced.definitions.filter((d) => d.kind),
    },
    null,
    2,
  ),
  "utf8",
);
console.log(
  JSON.stringify({
    programBytes: Buffer.byteLength(program),
    resources: resources.length,
    helpers: traced.definitions.filter((d) => d.kind).length,
  }),
);
