const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const extensions =
  /\.(?:html?|css|[cm]?js|json|png|jpe?g|webp|ttf|otf|woff2?|txt)$/i;
const excluded = (part) =>
  part.startsWith(".") ||
  ["node_modules", "out", "dist", "__pycache__"].includes(part);
export async function discoverSourceProjects(
  input,
  { signal, progress = () => {} } = {},
) {
  const files = [...input],
    paths = new Set(files.map((f) => f.webkitRelativePath));
  const entries = files
    .filter((f) => {
      const parts = f.webkitRelativePath?.split("/") || [];
      return (
        parts.at(-1)?.toLowerCase() === "index.html" && !parts.some(excluded)
      );
    })
    .sort(
      (a, b) =>
        a.webkitRelativePath.split("/").length -
          b.webkitRelativePath.split("/").length ||
        a.webkitRelativePath.localeCompare(b.webkitRelativePath, "zh-CN"),
    );
  const candidates = [];
  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) throw new DOMException("扫描已取消", "AbortError");
    const file = entries[i],
      path = file.webkitRelativePath.slice(0, -"/index.html".length);
    if (file.size > 2 * 1024 ** 2) continue;
    const html = await file.text(),
      canvases = [...html.matchAll(/<canvas\b/gi)],
      scripts = [
        ...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi),
      ];
    if (canvases.length === 1 && scripts.length === 1) {
      const entry = scripts[0][1].replace(/^\.\//, "");
      if (
        !entry.includes("..") &&
        !/[\\:?#]/.test(entry) &&
        !entry.startsWith("/") &&
        paths.has(path + "/" + entry)
      )
        candidates.push({
          kind: "source",
          path,
          title:
            html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
            path.split("/").at(-1),
          entry,
        });
    }
    progress(i + 1, entries.length);
  }
  for (const file of files) {
    if (signal?.aborted) throw new DOMException("扫描已取消", "AbortError");
    const path = file.webkitRelativePath || "";
    if (path.split("/").some(excluded)) continue;
    if (/\.(prism|svgfilm)$/i.test(path)) {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      if (head[0] === 80 && head[1] === 75)
        candidates.push({ kind: "file", path, title: file.name });
    } else if (/\.json$/i.test(path) && file.size <= 120 * 1024 ** 2) {
      const head = await file.slice(0, 4096).text();
      if (/"schema"\s*:\s*"svgfilm-project"/.test(head)) {
        let project;
        try {
          project = JSON.parse(await file.text());
        } catch {
          continue;
        }
        if (
          project.schema === "svgfilm-project" &&
          Array.isArray(project.scenes)
        )
          candidates.push({
            kind: "file",
            path,
            title: project.title || file.name,
          });
      }
    }
  }
  candidates.sort(
    (a, b) =>
      a.path.split("/").length - b.path.split("/").length ||
      a.path.localeCompare(b.path, "zh-CN"),
  );
  if (signal?.aborted) throw new DOMException("扫描已取消", "AbortError");
  return candidates;
}
export function selectSourceFiles(input, root = null) {
  const result = [];
  for (const file of input) {
    const parts = file.webkitRelativePath?.split("/");
    if (!parts || parts.length < 2) throw Error("请选择原始工程目录");
    const prefix = (root || parts[0]) + "/";
    if (!file.webkitRelativePath.startsWith(prefix)) continue;
    const relative = file.webkitRelativePath.slice(prefix.length);
    if (relative.split("/").some(excluded)) continue;
    if (!extensions.test(relative)) continue;
    if (
      relative.includes("\\") ||
      relative.includes(":") ||
      relative.split("/").some((p) => p === ".." || !p)
    )
      throw Error("源码路径无效");
    result.push({ file, path: relative });
  }
  if (!result.some((f) => f.path.toLowerCase() === "index.html"))
    throw Error("请选择根目录含 index.html 的 Canvas 工程");
  if (
    result.length > 10000 ||
    result.reduce((n, f) => n + f.file.size, 0) > 4 * 1024 ** 3 - 1024 ** 2
  )
    throw Error("源码文件超过导入容量");
  return result;
}
export async function zipSourceFiles(files, onProgress = () => {}, signal) {
  const parts = [],
    directory = [];
  let offset = 0,
    done = 0;
  const total = files.reduce((n, f) => n + f.file.size, 0);
  for (const { file, path } of files) {
    const name = encoder.encode(path);
    let crc = 0xffffffff;
    for await (const chunk of file.stream()) {
      if (signal?.aborted) throw new DOMException("导入已取消", "AbortError");
      for (const byte of chunk) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
      done += chunk.length;
      onProgress(done / Math.max(1, total));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length),
      view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.size, true);
    view.setUint32(22, file.size, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    parts.push(header, file);
    const entry = new Uint8Array(46 + name.length),
      v = new DataView(entry.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x800, true);
    v.setUint32(16, crc, true);
    v.setUint32(20, file.size, true);
    v.setUint32(24, file.size, true);
    v.setUint16(28, name.length, true);
    v.setUint32(42, offset, true);
    entry.set(name, 46);
    directory.push(entry);
    offset += header.length + file.size;
  }
  const length = directory.reduce((n, d) => n + d.length, 0),
    end = new Uint8Array(22),
    view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, length, true);
  view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}

/** CRC and directory packaging run off the editing thread; Blob parts stay file-backed. */
export function createSourceArchive(files, onProgress = () => {}, signal) {
  if (signal?.aborted)
    return Promise.reject(new DOMException("导入已取消", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./source-archive-worker.mjs", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("导入已取消", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) onProgress(data.progress);
      if (data.archive) {
        cleanup();
        resolve(data.archive);
      }
      if (data.error) {
        cleanup();
        reject(Error(data.error));
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(Error(event.message || "源码打包失败"));
    };
    worker.postMessage({ files });
  });
}
