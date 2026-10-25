import { sourceRegistry } from "./source-contract.mjs";
import { createSvgAdapter } from "./svg-adapter.mjs";
import { createCanvasAdapter } from "./canvas-adapter.mjs";

const factories = new Map();
export function registerAdapter(type, factory) {
  sourceRegistry.get(type);
  if (factories.has(type) || typeof factory !== "function")
    throw Error(`渲染适配器注册无效：${type}`);
  factories.set(type, factory);
}
export function createSourceAdapter(id, source, host, project) {
  const factory = factories.get(source.type);
  if (!factory) throw Error(`此工作台没有安装来源适配器：${source.type}`);
  return factory(id, source, host, project);
}
for (const type of ["svg", "svg-keyframes-v1", "cell-native-v1"])
  registerAdapter(type, createSvgAdapter);
registerAdapter("canvas-program-v1", createCanvasAdapter);
registerAdapter("canvas-source-v1", createCanvasAdapter);
