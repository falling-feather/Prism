import { Renderer } from "./renderer.mjs";
import { AudioPlayer } from "./audio.mjs";
import { duration } from "./project.mjs";
const project = JSON.parse(
    document.querySelector("#svgfilm-project").textContent,
  ),
  renderer = new Renderer(document.querySelector("#stage")),
  audio = new AudioPlayer();
renderer.load(project);
await renderer.whenReady();
let playing = false,
  time = 0,
  last = 0,
  frame;
function stop() {
  playing = false;
  audio.pause();
  cancelAnimationFrame(frame);
}
renderer.svg.addEventListener("render-error", (event) => {
  stop();
  const message = document.createElement("p");
  message.textContent = event.detail.message;
  message.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;color:white;background:#6e2828;padding:12px";
  document.body.append(message);
});
function tick(now) {
  if (!playing) return;
  time += (now - last) / 1000;
  last = now;
  if (time >= duration(project)) {
    time = duration(project) - 0.00001;
    stop();
  }
  renderer.render(time, { presentIntermediate: true });
  audio.sync(project, time, playing);
  if (playing) frame = requestAnimationFrame(tick);
}
function toggle() {
  if (playing) {
    stop();
    return;
  }
  if (time >= duration(project) - 0.05) time = 0;
  playing = true;
  last = performance.now();
  audio.sync(project, time, true);
  frame = requestAnimationFrame(tick);
}
document.querySelector("#stage").onclick = toggle;
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    toggle();
  }
  if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
    stop();
    time = Math.max(
      0,
      Math.min(
        duration(project) - 0.00001,
        time + (e.code === "ArrowRight" ? 5 : -5),
      ),
    );
    renderer.render(time);
  }
  if (e.key.toLowerCase() === "r") {
    stop();
    time = 0;
    toggle();
  }
});
document.documentElement.dataset.prismReady = "true";
