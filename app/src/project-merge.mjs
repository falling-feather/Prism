import { clone, uid, duration, validateProject, VERSION } from "./project.mjs";

/** Import into one timeline while retaining all existing object bindings and edits. */
export function appendProject(target, incoming) {
  validateProject(target);
  validateProject(incoming);
  const result = clone(target),
    addition = clone(incoming),
    offset = duration(target),
    sourceIds = new Map(),
    resourceIds = new Map();
  result.schemaVersion = VERSION;
  const resources = { ...result.resources };
  for (const [key, resource] of Object.entries(addition.resources || {})) {
    const mapped = Object.hasOwn(resources, key) ? uid("resource") : key;
    resources[mapped] = resource;
    resourceIds.set(key, mapped);
  }
  if (Object.keys(resources).length) result.resources = resources;
  for (const [id, source] of Object.entries(addition.sources)) {
    const mapped = Object.hasOwn(result.sources, id) ? uid("source") : id;
    sourceIds.set(id, mapped);
    if (source.assets)
      source.assets = Object.fromEntries(
        Object.entries(source.assets).map(([alias, key]) => [
          alias,
          resourceIds.get(key) || key,
        ]),
      );
    result.sources[mapped] = source;
  }
  const sceneIds = new Set(result.scenes.map((s) => s.id));
  for (const scene of addition.scenes) {
    const old = scene.sourceId,
      next = sourceIds.get(old),
      map = (id) =>
        id?.startsWith(old + ":") ? next + id.slice(old.length) : id;
    if (sceneIds.has(scene.id)) scene.id = uid("scene");
    sceneIds.add(scene.id);
    scene.sourceId = next;
    for (const o of scene.objects) {
      o.id = map(o.id);
      o.parentId = map(o.parentId);
    }
    for (const t of scene.texts) {
      t.id = map(t.id);
      t.objectId = map(t.objectId);
    }
    for (const key of ["objectOverrides", "parameterOverrides"])
      if (scene[key])
        scene[key] = Object.fromEntries(
          Object.entries(scene[key]).map(([id, value]) => [map(id), value]),
        );
    result.scenes.push(scene);
  }
  const audioIds = new Set(result.audioTracks.map((a) => a.id));
  for (const track of addition.audioTracks) {
    if (audioIds.has(track.id)) track.id = uid("audio");
    audioIds.add(track.id);
    track.start += offset;
    if (track.resourceId)
      track.resourceId = resourceIds.get(track.resourceId) || track.resourceId;
    result.audioTracks.push(track);
  }
  validateProject(result);
  return result;
}
