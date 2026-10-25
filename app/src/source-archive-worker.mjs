import { zipSourceFiles } from "./source-upload.mjs";

self.onmessage = async ({ data }) => {
  try {
    let last = 0;
    const archive = await zipSourceFiles(data.files, (progress) => {
      const now = performance.now();
      if (now - last > 50 || progress === 1) {
        last = now;
        self.postMessage({ progress });
      }
    });
    self.postMessage({ archive });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
