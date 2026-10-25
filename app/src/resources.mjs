import { SVG_ID } from "./animation.mjs";
export const ASSET_ID = /^[a-f0-9]{64}$/;
export function validateResources(resources = {}) {
  if (
    !resources ||
    typeof resources !== "object" ||
    Array.isArray(resources) ||
    Object.keys(resources).length > 5000
  )
    throw Error("工程素材清单无效");
  for (const [id, r] of Object.entries(resources)) {
    if (
      !SVG_ID.test(id) ||
      !r ||
      typeof r.name !== "string" ||
      !/^(image\/(png|jpeg|webp|gif)|(?:audio|video|model)\/[\w.+-]+|font\/(ttf|otf|woff|woff2)|application\/(json|octet-stream))$/.test(
        r.mime,
      )
    )
      throw Error(`素材 ${id} 的类型或名称无效`);
    if (Boolean(r.assetId) === Boolean(r.dataUrl))
      throw Error(`素材 ${id} 须提供唯一的内嵌数据或本机素材编号`);
    if (r.assetId && !ASSET_ID.test(r.assetId))
      throw Error(`素材 ${id} 编号无效`);
    if (
      r.dataUrl &&
      (typeof r.dataUrl !== "string" ||
        !r.dataUrl.startsWith(`data:${r.mime};base64,`) ||
        !/^[A-Za-z0-9+/=\r\n]+$/.test(r.dataUrl.split(",")[1] || ""))
    )
      throw Error(`素材 ${id} 数据无效`);
  }
}
export function resourceUrl(project, id) {
  const r = project.resources?.[id];
  if (!r) throw Error(`素材引用失效：${id}`);
  return r.dataUrl || `/api/assets/${r.assetId}`;
}
export function audioUrl(project, track) {
  return track.resourceId
    ? resourceUrl(project, track.resourceId)
    : track.dataUrl;
}
export function hasLinkedResources(project) {
  return Object.values(project.resources || {}).some((r) => r.assetId);
}
