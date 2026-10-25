import * as P from "./project.mjs";
import {
  Renderer,
  migrateLegacy,
  finishMigration,
  svgProject,
  svgImportNotice,
} from "./renderer.mjs";
import { AudioPlayer, readAudio } from "./audio.mjs";
import { WorkspaceLayout } from "./workspace.mjs";
import { CanvasSelection } from "./canvas-selection.mjs";
import { TimelineController } from "./timeline-controller.mjs";
import * as T from "./timeline.mjs";
import { appendProject } from "./project-merge.mjs";
import { hasLinkedResources } from "./resources.mjs";
import { createImportController } from "./import-controller.mjs";
if (location.protocol !== "file:") main();
async function main() {
  const $ = (s) => document.querySelector(s),
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const renderer = new Renderer($("#stage")),
    audio = new AudioPlayer();
  let project,
    loading = false,
    loadGeneration = 0,
    fileGeneration = 0,
    index = 0,
    time = 0,
    tab = "text",
    textId = null,
    subId = null,
    playing = false,
    last = 0,
    raf = 0,
    unsaved = false,
    history = new P.History(25),
    editValidator = new P.EditValidator(),
    recording = null,
    audioKind = "music",
    job = null,
    toastTimer,
    autosaveTimer,
    listSignature,
    inspectorSignature,
    inspectorProject,
    inspectorScene;
  const scene = () => project.scenes[index];
  const toast = (message) => {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      4500,
    );
  };
  const download = (name, data, type = "application/json") => {
    const url = URL.createObjectURL(
        data instanceof Blob ? data : new Blob([data], { type }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const field = (label, id, value, type = "number", extra = "") =>
    `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  const layout = new WorkspaceLayout(() => {
    if (project) {
      selectionBox();
      renderTimeline();
    }
  });
  const selection = new CanvasSelection(renderer, {
    scene,
    project: () => project,
    time: () => time,
    pause,
    error: toast,
    changed: (ids) => {
      textId =
        ids.length === 1
          ? scene().texts.find((t) => t.objectId === ids[0])?.id || null
          : null;
      if (ids.length) tab = textId ? "text" : "object";
      renderInspector();
      layout.apply(false);
    },
    edit: () => {
      layout.set("inspector", true);
      renderInspector();
    },
    scale: (factor) =>
      change(() => {
        scene().objectOverrides = selection.scale(factor);
      }),
    commit: recordGesture,
  });
  const timeline = new TimelineController({
    project: () => project,
    time: () => time,
    pause,
    seek: (t) => seek(t),
    apply: (fn) => change(fn),
    inspect: inspectTimeline,
    error: toast,
  });
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("svgfilm-editor", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("drafts");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const r = db.transaction("drafts").objectStore("drafts").get("latest");
    r.onsuccess = () => {
      if (r.result) {
        $("#restoreDraft").hidden = false;
        $("#restoreDraft").onclick = () =>
          loadProject(r.result)
            .then(() => toast("已恢复上次草稿"))
            .catch((e) => toast(e.message));
      }
    };
  } catch {
    toast("此浏览器未启用草稿恢复，请及时保存工程");
  }
  function saveDraft() {
    clearTimeout(autosaveTimer);
    if (db)
      autosaveTimer = setTimeout(() => {
        try {
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put(project, "latest");
          tx.onerror = () => toast("草稿存储空间不足，请保存工程文件");
        } catch (e) {
          toast(e.message);
        }
      }, 500);
  }
  function pause() {
    const wasPlaying = playing;
    playing = false;
    cancelAnimationFrame(raf);
    audio.pause();
    $("#playBtn").textContent = "▶";
    $("#playBtn").setAttribute("aria-label", "播放");
    if (wasPlaying && !loading) renderer.render(time);
  }
  function seek(t, follow = true) {
    if (loading) return;
    time = P.clamp(t, 0, Math.max(0, P.duration(project) - 0.0001));
    const pos = renderer.render(time, { presentIntermediate: playing });
    if (follow && index !== pos.index) {
      index = pos.index;
      selection.clear(false);
      textId = null;
      renderList();
      renderInspector();
    }
    audio.sync(project, time, playing);
    updateTransport();
    selectionBox();
  }
  function togglePlay() {
    if (loading) return;
    if (selection.gesture) selection.gesture.cancel();
    timeline.cancel();
    if (playing) {
      pause();
      return;
    }
    if (time >= P.duration(project) - 0.05) seek(0);
    playing = true;
    last = performance.now();
    $("#playBtn").textContent = "Ⅱ";
    $("#playBtn").setAttribute("aria-label", "暂停");
    audio.sync(project, time, true);
    raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!playing) return;
    const delta = (now - last) / 1000;
    last = now;
    let next = time + delta;
    if ($("#loopScene").checked) {
      const start = P.sceneStart(project, index),
        end = start + P.length(scene());
      if (next >= end) next = start;
    } else if (next >= P.duration(project)) {
      seek(P.duration(project) - 0.0001);
      pause();
      return;
    }
    seek(next);
    raf = requestAnimationFrame(tick);
  }
  function updateTransport() {
    $("#timeLabel").textContent =
      `${P.clock(time)} / ${P.clock(P.duration(project))}`;
    timeline.updateHead(time);
    $("#saveState").textContent = unsaved ? "有未保存修改" : "工程已载入";
    $("#reviewState").textContent =
      project.workflow?.script?.status === "confirmed"
        ? "全文已确认"
        : "文字待复核";
    $("#undoBtn").disabled = !history.past.length;
    $("#redoBtn").disabled = !history.future.length;
  }
  function renderList() {
    const signature = JSON.stringify([
      index,
      project.scenes.map((s) => [
        s.id,
        s.name,
        s.in,
        s.out,
        s.hold,
        s.subtitles.length,
      ]),
    ]);
    if (signature === listSignature) return;
    listSignature = signature;
    $("#sceneCount").textContent = project.scenes.length + " 幕";
    $("#sceneList").innerHTML = project.scenes
      .map(
        (s, i) =>
          `<button class="scene-card ${i === index ? "active" : ""}" data-scene-index="${i}" aria-label="${esc(s.name)}"><span class="n">${String(i + 1).padStart(2, "0")} / ${P.clock(P.sceneStart(project, i))}</span><strong>${esc(s.name)}</strong><small>${P.length(s).toFixed(1)} 秒 · ${s.subtitles.length} 条字幕</small></button>`,
      )
      .join("");
    $("#sceneList")
      .querySelectorAll("button")
      .forEach((b) => (b.onclick = () => selectScene(+b.dataset.sceneIndex)));
    $("#sceneName").textContent = scene().name;
  }
  function selectScene(i) {
    pause();
    index = P.clamp(i, 0, project.scenes.length - 1);
    selection.clear(false);
    textId = null;
    subId = null;
    seek(P.sceneStart(project, index) + Math.min(4, P.length(scene()) * 0.45));
    timeline.select({ kind: "scene", id: scene().id }, false);
    renderAll();
  }
  function renderAll() {
    selection.set(selection.ids, false);
    renderList();
    renderInspector();
    renderTimeline();
    seek(time);
    $("#projectTitle").value = project.title;
  }
  function change(fn, rebuild = false) {
    if (loading) return false;
    if (selection.gesture) selection.gesture.cancel();
    timeline.cancel();
    pause();
    const before = P.snapshotProject(project);
    const viewBefore = { index, time, tab, textId, subId };
    try {
      fn();
      editValidator.validate(project);
      if (rebuild) {
        renderer.updateProject(project);
        // Imported SVG registers text/object metadata during the rebuild.
        editValidator.validate(project);
      }
      history.push(before);
      index = Math.min(index, project.scenes.length - 1);
      unsaved = true;
      time = P.clamp(time, 0, P.duration(project) - 0.0001);
      renderAll();
      saveDraft();
      return true;
    } catch (e) {
      project = before;
      ({ index, time, tab, textId, subId } = viewBefore);
      renderer.updateProject(project);
      renderAll();
      toast(e.message);
      return false;
    }
  }
  function selectionBox() {
    selection.refresh();
  }
  function deleteSelection() {
    const ids = selection.ids.filter(
      (id) => !scene().objectOverrides[id]?.hidden,
    );
    if (!ids.length) return;
    // Keep the source and its animation targets intact; removal is local to this cut.
    if (
      change(() => {
        for (const id of ids)
          scene().objectOverrides[id] = {
            ...scene().objectOverrides[id],
            hidden: true,
          };
        P.dirty(project);
      })
    ) {
      selection.clear();
      toast(`已删除 ${ids.length} 个组件，可撤销或在组件面板取消隐藏恢复`);
    }
  }
  $("#deleteSelection").onclick = deleteSelection;
  function recordGesture(before) {
    try {
      editValidator.validate(project);
      history.push(before);
      unsaved = true;
      renderInspector();
      saveDraft();
      updateTransport();
    } catch (e) {
      project = before;
      renderer.updateProject(project);
      renderAll();
      toast(e.message);
    }
  }
  function renderBatchInspector(pane, s) {
    const ids = [...selection.ids];
    pane.innerHTML = `<div class="section-title"><strong>批量编辑 · ${ids.length} 个组件</strong></div><p class="note">${ids.map((id) => esc(s.objects.find((o) => o.id === id)?.label || id)).join("、")}</p><div class="row">${field("水平移动量", "batchMoveX", 0)}${field("垂直移动量", "batchMoveY", 0)}</div><button id="batchMove" class="wide">移动所选组件</button><div class="field" style="margin-top:18px"><label>缩放方式</label><select id="batchScaleMode"><option value="group">整体缩放：尺寸与间距一起变化</option><option value="individual">各自缩放：各组件中心保持不动</option></select></div>${field("相对缩放 / %", "batchScale", 110, "number", 'min="5" max="2000"')}<button id="batchScaleApply" class="wide primary">应用缩放</button><p class="batch-mode-note">整体缩放以整个选择框中心为锚点；各自缩放以各组件当前中心为锚点。可通过右下角控制点直接拖动缩放。</p><div class="row"><button id="batchHide">隐藏所选</button><button id="batchShow">显示所选</button></div><button id="batchReset" class="wide">恢复所选组件的原变换</button>`;
    $("#batchScaleMode").value = selection.scaleMode;
    $("#batchScaleMode").onchange = (e) => {
      selection.scaleMode = e.target.value;
      selection.refresh();
    };
    $("#batchMove").onclick = () =>
      change(() => {
        s.objectOverrides = selection.move(
          +$("#batchMoveX").value,
          +$("#batchMoveY").value,
        );
      });
    $("#batchScaleApply").onclick = () =>
      change(() => {
        s.objectOverrides = selection.scale(+$("#batchScale").value / 100);
      });
    $("#batchHide").onclick = () =>
      change(() => {
        for (const id of ids)
          s.objectOverrides[id] = { ...s.objectOverrides[id], hidden: true };
      });
    $("#batchShow").onclick = () =>
      change(() => {
        for (const id of ids)
          s.objectOverrides[id] = { ...s.objectOverrides[id], hidden: false };
      });
    $("#batchReset").onclick = () =>
      change(() => {
        for (const id of ids) delete s.objectOverrides[id];
      });
  }
  function renderInspector() {
    document
      .querySelectorAll("[data-tab]")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const pane = $("#inspector"),
      s = scene();
    const data =
      tab === "text"
        ? [s.texts, s.subtitles, s.in, P.length(s), s.parameterOverrides]
        : tab === "object"
          ? [s.objects, s.objectOverrides, s.parameterOverrides]
          : tab === "scene"
            ? [
                s.name,
                s.in,
                s.out,
                s.hold,
                project.sources[s.sourceId].duration,
              ]
            : [project.audioTracks.map(({ dataUrl, ...a }) => a), !!recording];
    const signature = JSON.stringify([
      tab,
      textId,
      subId,
      selection.ids,
      selection.deep,
      selection.scaleMode,
      data,
    ]);
    if (
      inspectorProject === project &&
      inspectorScene === s &&
      inspectorSignature === signature
    )
      return;
    inspectorProject = project;
    inspectorScene = s;
    inspectorSignature = signature;
    if (tab === "text") {
      const tx = s.texts.find((t) => t.id === textId);
      pane.innerHTML = `<div class="section-title"><strong>画面文字 <span class="badge">${s.texts.length}</span></strong><button id="confirmText" title="确认当前全文">确认全文</button></div><input id="textSearch" class="search" placeholder="查找标注、标题、答案…" aria-label="查找画面文字"><div class="item-list" id="textList">${s.texts.map((t) => `<button class="item-button ${t.id === textId ? "active" : ""}" data-text-id="${esc(t.id)}">${esc(t.text)}</button>`).join("")}</div>${tx ? `<div class="field"><label for="editText">文字内容</label><textarea id="editText">${esc(tx.text)}</textarea></div><div class="row">${field("字号", "textSize", tx.size, "number", 'min="4" max="500"')}${field("换行宽度（0为不换行）", "textWidth", tx.width || 0)}</div><div class="row">${field("文字 X", "textX", tx.x)}${field("文字 Y", "textY", tx.y)}</div><div class="row"><div class="field"><label>字体</label><select id="textFont"><option value="KaiTi, STKaiti, serif">楷体</option><option value="Microsoft YaHei, sans-serif">微软雅黑</option><option value="SimSun, serif">宋体</option><option value="Arial, sans-serif">Arial</option></select></div>${field("颜色", "textColor", tx.fill, "color")}</div>` : '<p class="note">选择一段文字进行修改。图中标注、题目与答案也在此处。</p>'}<div class="section-title"><strong>本幕字幕</strong><span class="note">时间以本幕为起点</span></div>${s.subtitles.map((l, i) => `<div class="sub-card ${l.id === subId ? "selected" : ""}"><div class="row"><label>起 <input type="number" step=".1" min="0" data-sub-start="${i}" aria-label="字幕${i + 1}开始" value="${l.start.toFixed(2)}"></label><label>止 <input type="number" step=".1" data-sub-end="${i}" aria-label="字幕${i + 1}结束" value="${l.end.toFixed(2)}"></label></div><textarea data-caption="${i}" aria-label="字幕${i + 1}内容">${esc(l.text)}</textarea><div class="row"><button data-locate-sub="${i}">定位</button><button data-remove-sub="${i}" class="danger">删除字幕</button></div></div>`).join("")}`;
      $("#textSearch").oninput = (e) =>
        pane
          .querySelectorAll("[data-text-id]")
          .forEach((b) => (b.hidden = !b.textContent.includes(e.target.value)));
      pane.querySelectorAll("[data-text-id]").forEach(
        (b) =>
          (b.onclick = () => {
            textId = b.dataset.textId;
            const t = s.texts.find((t) => t.id === textId);
            selection.set([t.objectId], false);
            seek(
              P.sceneStart(project, index) +
                P.clamp(t.start - s.in + 0.5, 0, P.length(s) - 0.001),
            );
            renderInspector();
          }),
      );
      $("#confirmText").onclick = () =>
        change(() => {
          project.workflow ??= {};
          project.workflow.script = { status: "confirmed" };
        });
      if (tx) {
        $("#textWidth").disabled = Boolean(
          tx.editableFields && !tx.editableFields.includes("width"),
        );
        $("#textWidth").title = $("#textWidth").disabled
          ? "此来源的换行由原始程序控制"
          : "";
        if (
          ![...$("#textFont").options].some(
            (option) => option.value === tx.font,
          )
        ) {
          const option = document.createElement("option");
          option.value = tx.font;
          option.textContent = tx.font;
          $("#textFont").append(option);
        }
        $("#textFont").value = tx.font;
        $("#editText").onchange = (e) =>
          change(() => {
            tx.text = e.target.value;
            P.dirty(project);
          });
        for (const [id, k] of [
          ["textSize", "size"],
          ["textWidth", "width"],
          ["textX", "x"],
          ["textY", "y"],
        ])
          $("#" + id).onchange = (e) =>
            change(() => {
              tx[k] = +e.target.value;
            });
        $("#textFont").onchange = (e) =>
          change(() => {
            tx.font = e.target.value;
          });
        $("#textColor").onchange = (e) =>
          change(() => {
            tx.fill = e.target.value;
          });
      }
      for (const [selector, key] of [
        ["[data-caption]", "text"],
        ["[data-sub-start]", "start"],
        ["[data-sub-end]", "end"],
      ])
        pane.querySelectorAll(selector).forEach(
          (e) =>
            (e.onchange = () =>
              change(() => {
                const i = +(
                  e.dataset.caption ??
                  e.dataset.subStart ??
                  e.dataset.subEnd
                );
                s.subtitles[i][key] = key === "text" ? e.value : +e.value;
                if (key === "text") P.dirty(project);
              })),
        );
      pane.querySelectorAll("[data-locate-sub]").forEach(
        (b) =>
          (b.onclick = () => {
            subId = s.subtitles[+b.dataset.locateSub].id;
            seek(
              P.sceneStart(project, index) +
                s.subtitles[+b.dataset.locateSub].start +
                0.02,
            );
            renderInspector();
          }),
      );
      pane.querySelectorAll("[data-remove-sub]").forEach(
        (b) =>
          (b.onclick = () =>
            change(() => {
              s.subtitles.splice(+b.dataset.removeSub, 1);
              P.dirty(project);
            })),
      );
    } else if (tab === "object") {
      if (selection.ids.length > 1) {
        renderBatchInspector(pane, s);
        return;
      }
      const obj = s.objects.find((o) => o.id === selection.primary),
        ov = s.objectOverrides[selection.primary] || {};
      pane.innerHTML = `<div class="section-title"><strong>画面组件</strong><span class="badge">${s.objects.length}</span></div><input id="objectSearch" class="search" placeholder="查找角色、细胞器、标注…"><div class="item-list">${s.objects.map((o) => `<button class="item-button ${o.id === selection.primary ? "active" : ""}" data-object-id="${esc(o.id)}">${esc(o.label)}</button>`).join("")}</div>${obj ? `<strong>${esc(obj.label)}</strong><p class="note">拖动画布中的选中对象；右下角可缩放。</p><div class="row">${field("水平位移", "objX", ov.dx || 0)}${field("垂直位移", "objY", ov.dy || 0)}</div><div class="row">${field("缩放", "objScale", ov.scale ?? 1, "number", 'min=".05" max="20" step=".05"')}${field("旋转角度", "objRotation", ov.rotation || 0)}</div><label><input type="checkbox" id="objectHidden" ${ov.hidden ? "checked" : ""}>隐藏组件</label><button id="resetObject" class="wide">恢复原位置与大小</button>` : '<p class="note">选择组件后，可调整位置、大小与可见性。原有动作继续保留。</p>'}`;
      $("#objectSearch").oninput = (e) =>
        pane
          .querySelectorAll("[data-object-id]")
          .forEach((b) => (b.hidden = !b.textContent.includes(e.target.value)));
      pane.querySelectorAll("[data-object-id]").forEach(
        (b) =>
          (b.onclick = (event) => {
            const id = b.dataset.objectId;
            selection.set(
              event.shiftKey
                ? selection.ids.includes(id)
                  ? selection.ids.filter((x) => x !== id)
                  : [...selection.ids, id]
                : [id],
              false,
            );
            renderInspector();
            selectionBox();
          }),
      );
      if (obj) {
        for (const [id, k] of [
          ["objX", "dx"],
          ["objY", "dy"],
          ["objScale", "scale"],
          ["objRotation", "rotation"],
        ])
          $("#" + id).onchange = (e) =>
            change(() => {
              s.objectOverrides[selection.primary] = {
                ...ov,
                [k]: +e.target.value,
              };
            });
        $("#objectHidden").onchange = (e) =>
          change(() => {
            s.objectOverrides[selection.primary] = {
              ...ov,
              hidden: e.target.checked,
            };
          });
        $("#resetObject").onclick = () =>
          change(() => {
            delete s.objectOverrides[selection.primary];
          });
      }
    } else if (tab === "scene") {
      pane.innerHTML = `<div class="section-title"><strong>镜头与剪辑</strong></div>${field("镜头名称", "clipName", s.name, "text")}<p class="note">原动画 ${project.sources[s.sourceId].duration.toFixed(1)} 秒。调整取用区间不会拉慢原动作。</p><div class="row">${field("入点 / 秒", "clipIn", s.in, "number", 'step=".1"')}${field("出点 / 秒", "clipOut", s.out, "number", 'step=".1"')}</div>${field("末尾停留 / 秒", "clipHold", s.hold || 0, "number", 'step=".5" min="0"')}<button id="applyTrim" class="primary wide">应用裁剪与停留</button><p class="note">当前片长 ${P.length(s).toFixed(2)} 秒。镜头顺序可用左下方 ↑ ↓ 调整；在播放头处可拆分。</p><button id="splitHere" class="wide">在播放头拆分</button>`;
      $("#clipName").onchange = (e) =>
        change(() => {
          s.name = e.target.value;
        });
      $("#applyTrim").onclick = () =>
        change(() =>
          P.trimScene(
            project,
            index,
            +$("#clipIn").value,
            +$("#clipOut").value,
            +$("#clipHold").value,
          ),
        );
      $("#splitHere").onclick = split;
    } else {
      pane.innerHTML = `<div class="section-title"><strong>音乐与配音</strong><span class="badge">全片音轨</span></div><div class="row"><button id="addMusic">＋ 背景音乐</button><button id="addVoice">＋ 配音文件</button></div><button id="recordVoice" class="wide ${recording ? "danger" : ""}">${recording ? "■ 停止录音" : "● 录制配音"}</button><p class="note">音轨使用全片时间，镜头剪辑不会隐式移动声音。可拖动下方音轨调整起点。</p>${project.audioTracks.map((a, i) => `<div class="audio-card"><strong>${esc(a.name)}</strong><div class="row"><label><input type="checkbox" data-a-mute="${i}" ${a.muted ? "checked" : ""}>静音</label><button data-a-delete="${i}">删除</button></div><div class="field"><label>音量 ${Math.round(a.volume * 100)}%</label><input type="range" min="0" max="1" step=".01" data-a-volume="${i}" value="${a.volume}"></div><div class="row">${audioField("全片开始", a.start, i, "start")}${audioField("音频入点", a.offset, i, "offset")}</div><div class="row">${audioField("长度", a.duration, i, "duration")}${audioField("淡入", a.fadeIn || 0, i, "fadeIn")}${audioField("淡出", a.fadeOut || 0, i, "fadeOut")}</div></div>`).join("")}`;
      $("#addMusic").onclick = () => {
        audioKind = "music";
        $("#audioInput").click();
      };
      $("#addVoice").onclick = () => {
        audioKind = "voice";
        $("#audioInput").click();
      };
      $("#recordVoice").onclick = recordVoice;
      pane.querySelectorAll("[data-a-key]").forEach(
        (e) =>
          (e.onchange = () =>
            change(() => {
              project.audioTracks[+e.dataset.aIndex][e.dataset.aKey] = +e.value;
            })),
      );
      pane.querySelectorAll("[data-a-volume]").forEach(
        (e) =>
          (e.onchange = () =>
            change(() => {
              project.audioTracks[+e.dataset.aVolume].volume = +e.value;
            })),
      );
      pane.querySelectorAll("[data-a-mute]").forEach(
        (e) =>
          (e.onchange = () =>
            change(() => {
              project.audioTracks[+e.dataset.aMute].muted = e.checked;
            })),
      );
      pane.querySelectorAll("[data-a-delete]").forEach(
        (e) =>
          (e.onclick = () =>
            change(() => {
              project.audioTracks.splice(+e.dataset.aDelete, 1);
            })),
      );
    }
    renderParameters(pane, s);
  }
  function renderParameters(pane, s) {
    const object = s.objects.find((o) => o.id === selection.primary);
    const definitions = object?.parameters || {};
    if (!Object.keys(definitions).length || !["text", "object"].includes(tab))
      return;
    const group = document.createElement("div");
    group.className = "parameter-editor";
    group.innerHTML =
      '<div class="section-title"><strong>动作与外观</strong><button id="resetParameters">恢复参数</button></div>';
    for (const [key, d] of Object.entries(definitions)) {
      const value = s.parameterOverrides?.[object.id]?.[key] ?? d.default;
      const field = document.createElement("label");
      field.className = "field";
      field.textContent = d.label;
      const input = document.createElement(
        d.type === "select" ? "select" : "input",
      );
      input.dataset.parameter = key;
      input.setAttribute("aria-label", d.label);
      if (d.type === "select")
        for (const option of d.options) {
          const item = document.createElement("option");
          item.value = option;
          item.textContent = option;
          input.append(item);
        }
      else
        input.type =
          d.type === "boolean"
            ? "checkbox"
            : d.type === "number"
              ? "number"
              : d.type === "color"
                ? "color"
                : "text";
      if (d.type === "number") {
        input.min = d.min;
        input.max = d.max;
        input.step = d.step || "any";
      }
      if (d.type === "boolean") input.checked = value;
      else input.value = value;
      input.onchange = () =>
        change(() => {
          s.parameterOverrides ??= {};
          s.parameterOverrides[object.id] = {
            ...s.parameterOverrides[object.id],
            [key]:
              d.type === "boolean"
                ? input.checked
                : d.type === "number"
                  ? +input.value
                  : input.value,
          };
        });
      field.append(input);
      group.append(field);
    }
    pane.append(group);
    group.querySelector("#resetParameters").onclick = () =>
      change(() => {
        if (s.parameterOverrides) delete s.parameterOverrides[object.id];
      });
  }
  function audioField(label, value, i, key) {
    return `<div class="field"><label>${label}</label><input type="number" min="0" step=".1" value="${Number(value).toFixed(2)}" data-a-index="${i}" data-a-key="${key}" aria-label="${label}${i + 1}"></div>`;
  }
  function renderTimeline() {
    timeline.render();
  }
  function inspectTimeline(ref, at, detailed = false) {
    const item = T.findItem(project, ref);
    if (!item) return;
    pause();
    selection.clear(false);
    textId = null;
    if (ref.kind === "subtitle") {
      tab = "text";
      subId = ref.id;
    } else if (ref.kind === "audio") tab = "audio";
    else {
      tab = "scene";
      subId = null;
    }
    const wanted =
      at ?? (time >= item.start && time < item.end ? time : item.start);
    seek(
      ref.kind === "audio"
        ? wanted
        : P.clamp(wanted, item.start, Math.max(item.start, item.end - 1e-6)),
    );
    renderList();
    renderInspector();
    if (detailed) layout.set("inspector", true);
  }
  function split() {
    change(() => {
      P.splitScene(project, index, time - P.sceneStart(project, index));
    }, true);
  }
  async function loadProject(candidate) {
    const generation = ++loadGeneration,
      before = project;
    timeline.cancel();
    if (selection.gesture) selection.gesture.cancel();
    pause();
    loading = true;
    $("main").inert = true;
    window.studio.ready = false;
    try {
      const next = await migrateLegacy(candidate);
      if (generation !== loadGeneration) return false;
      const nextValidator = new P.EditValidator();
      nextValidator.validate(next);
      renderer.load(next);
      await renderer.whenReady();
      if (generation !== loadGeneration) return false;
      finishMigration(next);
      project = next;
      editValidator = nextValidator;
      timeline.reset();
      index = 0;
      time = 0;
      selection.clear(false);
      textId = subId = null;
      history = new P.History(25);
      unsaved = false;
      audio.dispose();
      loading = false;
      renderAll();
      window.studio.ready = true;
      return true;
    } catch (e) {
      if (generation !== loadGeneration) return false;
      if (before) {
        renderer.load(before);
        project = before;
        await renderer.whenReady();
        if (generation !== loadGeneration) return false;
        loading = false;
        renderAll();
      }
      throw e;
    } finally {
      if (generation === loadGeneration) {
        loading = false;
        $("main").inert = false;
        window.studio.ready = Boolean(project);
      }
    }
  }
  async function importFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (["zip", "svgfilm", "prism"].includes(ext)) {
      if (file.size > 4 * 1024 ** 3) throw Error("工程包超过 4 GiB");
      const r = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file,
      });
      const p = await r.json();
      if (!r.ok) throw Error(p.error);
      return { project: p };
    }
    if (file.size > 160 * 1024 * 1024)
      throw Error("单文件工程超过 160 MiB，请使用工程包");
    const text = await file.text();
    if (ext === "svg")
      return {
        project: svgProject(text, file.name.replace(/\.svg$/i, "")),
        notice: svgImportNotice(text),
      };
    if (ext === "html") {
      const d = new DOMParser().parseFromString(text, "text/html"),
        metadata = d.querySelector("#svgfilm-project");
      if (metadata) return { project: JSON.parse(metadata.textContent) };
      throw Error("此 HTML 未携带 SVGFilm 工程数据，无法恢复对象编辑");
    }
    return { project: JSON.parse(text) };
  }
  async function addAudio(file, kind = audioKind, start = time) {
    pause();
    const a = await readAudio(file);
    change(() => {
      const resourceId = a.resource ? P.uid("audio-resource") : null;
      if (resourceId) {
        project.schemaVersion = P.VERSION;
        project.resources = { ...project.resources, [resourceId]: a.resource };
      }
      project.audioTracks.push({
        id: P.uid("audio"),
        kind,
        name: file.name || "录音",
        ...(resourceId ? { resourceId } : { dataUrl: a.dataUrl }),
        start,
        offset: 0,
        duration: Math.min(
          a.duration,
          Math.max(0.1, P.duration(project) - start),
        ),
        mediaDuration: a.duration,
        volume: kind === "music" ? 0.4 : 1,
        fadeIn: 0,
        fadeOut: 0,
        muted: false,
      });
      tab = "audio";
    });
  }
  async function recordVoice() {
    if (recording) {
      recording.stop();
      return;
    }
    pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }),
        chunks = [],
        started = time,
        r = new MediaRecorder(stream);
      recording = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recording = null;
        renderInspector();
        try {
          const ctx = new AudioContext(),
            buffer = await ctx.decodeAudioData(
              await new Blob(chunks).arrayBuffer(),
            );
          await ctx.close();
          const data = new ArrayBuffer(44 + buffer.length * 2),
            view = new DataView(data),
            put = (o, s) =>
              [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
          put(0, "RIFF");
          view.setUint32(4, data.byteLength - 8, true);
          put(8, "WAVE");
          put(12, "fmt ");
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, buffer.sampleRate, true);
          view.setUint32(28, buffer.sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          put(36, "data");
          view.setUint32(40, buffer.length * 2, true);
          const samples = buffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++)
            view.setInt16(44 + i * 2, P.clamp(samples[i], -1, 1) * 32767, true);
          await addAudio(
            new File([data], "课堂配音.wav", { type: "audio/wav" }),
            "voice",
            started,
          );
        } catch (e) {
          toast("录音处理失败：" + e.message);
        }
      };
      r.start();
      renderInspector();
      toast("正在录音，完成后点击停止录音");
    } catch (e) {
      toast("未能开始录音：" + e.message);
    }
  }
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        renderInspector();
      }),
  );
  $("#playBtn").onclick = togglePlay;
  $("#prevBtn").onclick = () => selectScene(index - 1);
  $("#nextBtn").onclick = () => selectScene(index + 1);
  $("#splitBtn").onclick = split;
  $("#duplicateBtn").onclick = () =>
    change(() => P.duplicateScene(project, index), true);
  $("#upBtn").onclick = () =>
    change(() => {
      P.moveScene(project, index, index - 1);
      index = Math.max(0, index - 1);
      time = P.sceneStart(project, index);
    });
  $("#downBtn").onclick = () =>
    change(() => {
      P.moveScene(project, index, index + 1);
      index = Math.min(project.scenes.length - 1, index + 1);
      time = P.sceneStart(project, index);
    });
  $("#deleteScene").onclick = () =>
    change(() => {
      P.removeScene(project, index);
      index = Math.min(index, project.scenes.length - 1);
      time = P.sceneStart(project, index);
    }, true);
  const undo = (redo) => {
    if (loading) return;
    if (timeline.gesture) {
      timeline.cancel();
      return;
    }
    if (selection.gesture) {
      selection.gesture.cancel();
      renderInspector();
      updateTransport();
      return;
    }
    const previousSelection = [...selection.ids];
    pause();
    project = redo ? history.redo(project) : history.undo(project);
    index = Math.min(index, project.scenes.length - 1);
    selection.clear(false);
    textId = null;
    renderer.updateProject(project);
    unsaved = true;
    renderAll();
    selection.set(previousSelection);
    saveDraft();
  };
  $("#undoBtn").onclick = () => undo(false);
  $("#redoBtn").onclick = () => undo(true);
  $("#projectTitle").onchange = (e) =>
    change(() => {
      project.title = e.target.value;
    });
  $("#fitBtn").onclick = () => layout.reset();
  window.addEventListener("resize", () => {
    selectionBox();
  });
  $("#addSubtitle").onclick = () =>
    change(() => {
      const start = P.clamp(
        time - P.sceneStart(project, index),
        0,
        Math.max(0, P.length(scene()) - 0.1),
      );
      const l = {
        id: P.uid("sub"),
        text: "请输入字幕",
        start,
        end: Math.min(P.length(scene()), start + 3),
      };
      scene().subtitles.push(l);
      subId = l.id;
      layout.set("inspector", true);
      tab = "text";
      P.dirty(project);
    });
  async function importProjectFile(file) {
    if (!file) return;
    const generation=++fileGeneration;
    const {project:incoming,notice}=await importFile(file);
    if(generation!==fileGeneration)return;
    if(unsaved)await saveProject();
    if(generation!==fileGeneration || !await loadProject(incoming))return;
    toast(notice || "工程已导入");
    await imports.remember(project,file.name);
  }
  const imports=createImportController({
    notify:toast,openFile:importProjectFile,
    load:async incoming=>{++fileGeneration;if(unsaved)await saveProject();return loadProject(incoming);},
  });
  $("#fileInput").onchange=async event=>{
    try{await importProjectFile(event.target.files[0]);}
    catch(error){toast(error.message);}
    finally{event.target.value="";}
  };
  async function saveProject() {
    P.validateProject(project);
    if (hasLinkedResources(project)) {
      const response = await fetch("/api/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      const link = document.createElement("a");
      link.href =
        result.url + "?name=" + encodeURIComponent(project.title + ".prism");
      link.download = project.title + ".prism";
      link.click();
    } else
      download(project.title + ".svgfilm.json", P.serializeProject(project));
  }
  $("#saveBtn").onclick = async () => {
    try {
      await saveProject();
      unsaved = false;
      updateTransport();
      toast("工程已保存，包含全部素材与声音");
    } catch (e) {
      toast(e.message);
    }
  };
  $("#appendBtn").onclick = () => $("#appendInput").click();
  $("#appendInput").onchange = async (event) => {
    const generation = ++fileGeneration;
    try {
      const file = event.target.files[0];
      if (!file) return;
      const { project: incoming } = await importFile(file),
        before = P.snapshotProject(project);
      if (generation !== fileGeneration) return;
      const merged = appendProject(project, await migrateLegacy(incoming));
      if (!(await loadProject(merged))) return;
      history.push(before);
      unsaved = true;
      renderAll();
      saveDraft();
      toast("工程已追加到时间轴");
    } catch (error) {
      toast(error.message);
    } finally {
      event.target.value = "";
    }
  };
  $("#addSvg").onclick = () => $("#svgInput").click();
  $("#svgInput").onchange = async (e) => {
    try {
      if (!e.target.files[0]) return;
      const markup = await e.target.files[0].text();
      const p = svgProject(
        markup,
        e.target.files[0].name.replace(/\.svg$/i, ""),
      );
      const changed = change(() => {
        project.sources = { ...project.sources, ...p.sources };
        project.scenes.push(...p.scenes);
        index = project.scenes.length - 1;
        time = P.sceneStart(project, index);
      }, true);
      if (changed) toast(svgImportNotice(markup));
    } catch (e) {
      toast(e.message);
    } finally {
      $("#svgInput").value = "";
    }
  };
  $("#audioInput").onchange = async (e) => {
    try {
      if (e.target.files[0]) await addAudio(e.target.files[0]);
    } catch (e) {
      toast(e.message);
    } finally {
      $("#audioInput").value = "";
    }
  };
  $("#srtImport").onclick = () => $("#srtInput").click();
  $("#srtInput").onchange = async (e) => {
    try {
      if (e.target.files[0]) {
        const text = await e.target.files[0].text();
        change(() => P.importSrt(project, text));
      }
    } catch (e) {
      toast(e.message);
    } finally {
      $("#srtInput").value = "";
    }
  };
  $("#srtExport").onclick = () =>
    download(project.title + ".srt", P.toSrt(project), "application/x-subrip");
  $("#svgBtn").onclick = async () => {
    try {
      await renderer.whenReady();
      download(scene().name + ".svg", renderer.snapshot(), "image/svg+xml");
    } catch (error) {
      toast(error.message);
    }
  };
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (
      selection.gesture &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "z"
    ) {
      e.preventDefault();
      undo(e.shiftKey);
      return;
    }
    if (
      e.target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      ) ||
      $("#exportDialog").open
    )
      return;
    if (
      ["Delete", "Backspace"].includes(e.key) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      selection.ids.length &&
      !timeline.focused &&
      !timeline.gesture
    ) {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo(e.shiftKey);
    }
    if (
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      ["ArrowLeft", "ArrowRight"].includes(e.key)
    ) {
      e.preventDefault();
      pause();
      seek(
        T.proposeSeek(
          project,
          time + (e.key === "ArrowRight" ? 1 : -1) / project.canvas.fps,
          { snap: false },
        ).value,
      );
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (unsaved) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("audio-error", (e) =>
    toast("声音播放失败：" + e.detail),
  );
  $("#exportBtn").onclick = () => {
    pause();
    $("#exportDialog").showModal();
  };
  $("#exportType").onchange = () => {
    $("#exportModeField").hidden = $("#exportType").value !== "mp4";
  };
  $("#startExport").onclick = async () => {
    try {
      P.validateProject(project);
      $("#startExport").disabled = true;
      $("#downloadExport").hidden = true;
      $("#exportStatus").textContent = "准备导出…";
      const body = { project: JSON.parse(P.serializeProject(project)) };
      if ($("#exportType").value === "html") {
        const r = await fetch("/api/portable", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw Error((await r.json()).error);
        download(project.title + ".html", await r.blob(), "text/html");
        $("#exportStatus").textContent = "独立播放文件已保存，也可重新导入编辑";
        $("#startExport").disabled = false;
        return;
      }
      body.width = +$("#exportSize").value;
      body.exportMode = $("#exportMode").value;
      body.start =
        $("#exportRange").value === "scene" ? P.sceneStart(project, index) : 0;
      body.end =
        $("#exportRange").value === "scene"
          ? body.start + P.length(scene())
          : P.duration(project);
      const r = await fetch("/api/exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      job = data.id;
      sessionStorage.setItem(
        "svgfilm-export",
        JSON.stringify({ id: job, title: project.title }),
      );
      $("#exportProgress").hidden = false;
      $("#cancelExport").hidden = false;
      pollExport();
    } catch (e) {
      $("#exportStatus").textContent = "导出失败：" + e.message;
      $("#startExport").disabled = false;
    }
  };
  async function pollExport() {
    try {
      const r = await fetch("/api/exports/" + job),
        d = await r.json();
      if (!r.ok) throw Error(d.error || "导出任务已失效");
      $("#exportProgress").value = d.progress || 0;
      $("#exportStatus").textContent =
        (d.message || "正在渲染") +
        (d.fallbackReason ? " · " + d.fallbackReason : "");
      if (["complete", "failed", "cancelled"].includes(d.status)) {
        $("#cancelExport").hidden = true;
        $("#startExport").disabled = false;
        if (d.status === "complete") {
          $("#downloadExport").href = "/api/exports/" + job + "/download";
          $("#downloadExport").download =
            (JSON.parse(sessionStorage.getItem("svgfilm-export") || "{}")
              .title || project.title) + ".mp4";
          $("#downloadExport").hidden = false;
        }
        job = null;
        sessionStorage.removeItem("svgfilm-export");
      } else setTimeout(pollExport, 1000);
    } catch (e) {
      $("#exportStatus").textContent = e.message;
      $("#startExport").disabled = false;
      $("#cancelExport").hidden = true;
      job = null;
      sessionStorage.removeItem("svgfilm-export");
    }
  }
  $("#cancelExport").onclick = () => {
    if (job) fetch("/api/exports/" + job + "/cancel", { method: "POST" });
  };
  window.studio = {
    ready: false,
    getProject: () => P.clone(project),
    loadProject,
    seek: (t) => {
      pause();
      seek(t);
      renderAll();
    },
    get time() {
      return time;
    },
    renderer,
  };
  renderer.svg.addEventListener("render-ready", () => selectionBox());
  renderer.svg.addEventListener("render-error", (event) => {
    pause();
    toast(event.detail.message);
  });
  try {
    const response = await fetch("案例_细胞结构.svgfilm.json");
    if (!response.ok) throw Error("案例文件缺失");
    await loadProject(await response.json());
    imports.resume();
    const pending = sessionStorage.getItem("svgfilm-export");
    if (pending) {
      job = JSON.parse(pending).id;
      $("#exportDialog").showModal();
      $("#exportProgress").hidden = false;
      $("#cancelExport").hidden = false;
      $("#startExport").disabled = true;
      pollExport();
    }
  } catch (e) {
    toast("载入失败：" + e.message);
    $("#saveState").textContent = "载入失败";
    console.error(e);
  }
}
