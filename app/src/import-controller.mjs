import {
  discoverSourceProjects,
  selectSourceFiles,
  createSourceArchive,
} from "./source-upload.mjs";

/** Directory selection and local history share the same validated project loading path. */
export function createImportController({ load, notify, openFile }) {
  const $ = (selector) => document.querySelector(selector);
  let job = null,
    controller = null,
    scan = null,
    selected = null,
    files = null;
  async function json(url, options) {
    const response = await fetch(url, options),
      value = await response.json();
    if (!response.ok) throw Error(value.error || "本机服务读取失败");
    return value;
  }
  async function remember(project, name, kind = "file", location = name) {
    try {
      await json("/api/recent-imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, name, kind, location }),
      });
      return true;
    } catch (error) {
      notify("工程已载入，但最近导入记录未保存：" + error.message);
      return false;
    }
  }
  async function recent() {
    const list = $("#recentImportList");
    list.replaceChildren();
    list.textContent = "正在读取最近导入…";
    try {
      const records = await json("/api/recent-imports");
      list.replaceChildren();
      if (!records.length) list.textContent = "暂无导入记录。";
      for (const record of records) {
        const button = document.createElement("button"),
          name = document.createElement("strong"),
          detail = document.createElement("small");
        name.textContent = record.name;
        detail.textContent =
          record.location +
          " · " +
          new Date(record.importedAt).toLocaleString() +
          (record.available ? "" : " · 本机副本缺失，请重新选择");
        button.append(name, detail);
        button.disabled = !record.available;
        button.onclick = async () => {
          button.disabled = true;
          try {
            const project = await json(
              "/api/recent-imports/" + record.id + "/project",
            );
            if (!(await load(project))) return;
            await remember(project, record.name, record.kind, record.location);
            $("#importDialog").close();
            notify("已打开最近导入的工程");
          } catch (error) {
            notify(error.message);
          } finally {
            button.disabled = false;
          }
        };
        list.append(button);
      }
    } catch (error) {
      list.textContent = "最近记录暂不可用：" + error.message;
    }
  }
  $("#importBtn").onclick = () => {
    $("#importDialog").showModal();
    recent();
  };
  $("#chooseProjectFile").onclick = () => {
    $("#importDialog").close();
    $("#fileInput").click();
  };
  const chooseDirectory = () => {
    $("#importDialog").close();
    $("#sourceFolderInput").click();
  };
  $("#chooseSourceDirectory").onclick = chooseDirectory;
  $("#importSourceBtn").onclick = chooseDirectory;
  $("#closeImport").onclick = () => $("#importDialog").close();
  function finish(message) {
    $("#sourceStatus").textContent = message;
    $("#sourceCancel").hidden = true;
    $("#sourceCancel").disabled = false;
    $("#sourceClose").hidden = false;
    job = null;
    controller = null;
    files = null;
    sessionStorage.removeItem("prism-source-import");
    sessionStorage.removeItem("prism-source-import-info");
  }
  async function poll() {
    if (!job) return;
    try {
      const state = await json("/api/source-imports/" + job);
      $("#sourceProgress").value = 40 + (state.progress || 0) * 0.6;
      $("#sourceStatus").textContent = state.message;
      if (state.status === "complete") {
        const project = await json("/api/source-imports/" + job + "/project");
        if (!(await load(project))) throw Error("另一个工程已载入");
        const remembered = await remember(
          project,
          selected?.title || state.name,
          "source",
          selected?.path || state.name,
        );
        const notes = $("#sourceNotes");
        notes.replaceChildren();
        const messages = new Set(
          (state.result.limitations || []).map((item) => item.message),
        );
        for (const message of messages) {
          const item = document.createElement("li");
          item.textContent = message;
          notes.append(item);
        }
        finish(
          `已识别 ${state.result.objects} 个对象、${state.result.texts} 段画面文字，建立 ${state.result.scenes} 个编辑片段。${remembered ? "" : "最近导入记录未能保存，请及时保存工程包。"}`,
        );
        $("#sourceClose").textContent = "开始编辑";
        notify("源码工程已载入，可选择内部元素编辑");
      } else if (["failed", "cancelled"].includes(state.status))
        finish(state.message);
      else setTimeout(poll, 1000);
    } catch (error) {
      finish(error.message);
    }
  }
  async function openCandidate(candidate) {
    selected = candidate;
    scan = null;
    $("#sourceChoiceDialog").close();
    if (candidate.kind === "file") {
      const file = files.find((f) => f.webkitRelativePath === candidate.path);
      files = null;
      try {
        await openFile(file);
      } catch (error) {
        notify(error.message);
      }
      return;
    }
    $("#sourceProgress").value = 0;
    $("#sourceStatus").textContent = "正在读取选中工程的代码与图像素材";
    $("#sourceCancel").hidden = false;
    $("#sourceCancel").disabled = false;
    $("#sourceClose").hidden = true;
    $("#sourceClose").textContent = "关闭";
    $("#sourceNotes").replaceChildren();
    $("#sourceDialog").showModal();
    controller = new AbortController();
    try {
      const health = await json("/api/health");
      if (!health.sourceDiscovery)
        throw Error("请重启新版映物服务，再使用目录发现功能");
      const inputs = selectSourceFiles(files, candidate.path);
      const archive = await createSourceArchive(
        inputs,
        (value) => ($("#sourceProgress").value = value * 15),
        controller.signal,
      );
      files = null;
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/source-imports");
        xhr.responseType = "json";
        xhr.setRequestHeader("Content-Type", "application/zip");
        xhr.setRequestHeader(
          "X-Prism-Source-Name",
          encodeURIComponent(candidate.title),
        );
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            $("#sourceProgress").value = 15 + (event.loaded / event.total) * 25;
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve(xhr.response)
            : reject(Error(xhr.response?.error || "源码上传失败"));
        xhr.onerror = () => reject(Error("源码上传连接中断"));
        xhr.onabort = () =>
          reject(new DOMException("导入已取消", "AbortError"));
        controller.signal.addEventListener("abort", () => xhr.abort(), {
          once: true,
        });
        if (controller.signal.aborted)
          return reject(new DOMException("导入已取消", "AbortError"));
        xhr.send(archive);
      });
      job = result.id;
      sessionStorage.setItem("prism-source-import", job);
      sessionStorage.setItem(
        "prism-source-import-info",
        JSON.stringify(candidate),
      );
      poll();
    } catch (error) {
      finish(error.name === "AbortError" ? "源码导入已取消" : error.message);
    }
  }
  $("#sourceFolderInput").onchange = async (event) => {
    if (!event.target.files.length) return;
    files = [...event.target.files];
    event.target.value = "";
    scan = new AbortController();
    const active = scan;
    $("#sourceCandidates").replaceChildren();
    $("#sourceScanStatus").textContent = "正在逐层查找可读取工程…";
    $("#sourceChoiceDialog").showModal();
    try {
      const candidates = await discoverSourceProjects(files, {
        signal: active.signal,
        progress: (done, total) =>
          ($("#sourceScanStatus").textContent = `检查入口 ${done} / ${total}`),
      });
      if (active.signal.aborted) return;
      if (candidates.length === 1) return openCandidate(candidates[0]);
      $("#sourceScanStatus").textContent = candidates.length
        ? `发现 ${candidates.length} 个工程，请选择当前要展开的一个。`
        : "未发现可读取工程。当前支持包含单个主 Canvas 和本地 JavaScript 入口的 index.html 工程。";
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i],
          button = document.createElement("button"),
          name = document.createElement("strong"),
          path = document.createElement("small");
        name.textContent = i + 1 + ". " + candidate.title;
        path.textContent = candidate.path;
        button.append(name, path);
        button.onclick = () => openCandidate(candidate);
        $("#sourceCandidates").append(button);
      }
      if (!candidates.length) files = null;
    } catch (error) {
      if (error.name !== "AbortError")
        $("#sourceScanStatus").textContent = error.message;
      files = null;
    }
  };
  function cancelScan() {
    scan?.abort();
    scan = null;
    files = null;
    $("#sourceChoiceDialog").close();
  }
  $("#sourceChoiceCancel").onclick = cancelScan;
  $("#sourceChoiceDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelScan();
  });
  $("#sourceCancel").onclick = async () => {
    $("#sourceCancel").disabled = true;
    try {
      if (job)
        await json("/api/source-imports/" + job + "/cancel", {
          method: "POST",
        });
      else controller?.abort();
    } catch (error) {
      notify(error.message);
      $("#sourceCancel").disabled = false;
    }
  };
  $("#sourceClose").onclick = () => $("#sourceDialog").close();
  $("#sourceDialog").addEventListener("cancel", (event) => {
    if (job || controller) event.preventDefault();
  });
  return {
    remember,
    resume() {
      const pending = sessionStorage.getItem("prism-source-import");
      if (pending) {
        job = pending;
        try {
          selected = JSON.parse(
            sessionStorage.getItem("prism-source-import-info"),
          );
        } catch {
          selected = null;
        }
        $("#sourceDialog").showModal();
        $("#sourceClose").hidden = true;
        poll();
      }
    },
  };
}
