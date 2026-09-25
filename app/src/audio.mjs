import { audioGain } from "./project.mjs";
export class AudioPlayer {
  constructor() {
    this.elements = new Map();
    this.errors = new Set();
  }
  sync(project, time, playing) {
    const active = new Set(project.audioTracks.map((a) => a.id));
    for (const [id, e] of this.elements)
      if (!active.has(id)) {
        e.pause();
        e.removeAttribute("src");
        e.load();
        this.elements.delete(id);
      }
    for (const track of project.audioTracks) {
      let e = this.elements.get(track.id);
      if (!e) {
        e = new Audio(track.dataUrl);
        e.preload = "auto";
        this.elements.set(track.id, e);
      }
      const gain = audioGain(track, time),
        inside = time >= track.start && time < track.start + track.duration;
      e.volume = gain;
      if (!playing || !inside || track.muted) {
        e.pause();
        continue;
      }
      const target = track.offset + time - track.start;
      if (Math.abs(e.currentTime - target) > 0.18) e.currentTime = target;
      if (e.paused)
        e.play().catch((error) => {
          if (!this.errors.has(track.id)) {
            this.errors.add(track.id);
            window.dispatchEvent(
              new CustomEvent("audio-error", { detail: error.message }),
            );
          }
        });
    }
  }
  pause() {
    for (const e of this.elements.values()) e.pause();
  }
  dispose() {
    this.pause();
    for (const e of this.elements.values()) {
      e.removeAttribute("src");
      e.load();
    }
    this.elements.clear();
  }
}
export async function readAudio(file) {
  if (file.size > 80 * 1024 * 1024) throw Error("单个音频请控制在 80 MB 内");
  const type =
    file.type.split(";")[0] ||
    {
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      wav: "audio/wav",
      ogg: "audio/ogg",
      webm: "audio/webm",
    }[file.name?.split(".").pop().toLowerCase()];
  if (!type?.startsWith("audio/")) throw Error("请选择音频文件");
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("音频读取失败"));
    r.readAsDataURL(new Blob([file], { type }));
  });
  const duration = await new Promise((resolve, reject) => {
    const a = new Audio(),
      timer = setTimeout(() => {
        a.src = "";
        reject(Error("无法读取音频时长，请转换为 WAV、MP3 或 M4A"));
      }, 15000);
    a.onloadedmetadata = () => {
      clearTimeout(timer);
      const d = a.duration;
      a.src = "";
      Number.isFinite(d)
        ? resolve(d)
        : reject(Error("该音频缺少时长信息，请转换为 WAV 或 MP3"));
    };
    a.onerror = () => {
      clearTimeout(timer);
      reject(Error("浏览器不支持该音频格式"));
    };
    a.src = dataUrl;
  });
  return { dataUrl, duration };
}
