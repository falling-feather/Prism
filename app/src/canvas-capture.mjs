/** Editing for source canvases, including objects painted into compositing buffers. */
const fields = [
  "text",
  "x",
  "y",
  "size",
  "font",
  "fill",
  "anchor",
  "width",
  "start",
  "end",
];
export function createCaptureSession({
  source,
  prefix,
  scene,
  time,
  records,
  inspecting = false,
}) {
  const declarations = new Map(source.objects.map((o) => [o.id, o]));
  const textValues = new Map(scene.texts.map((t) => [t.objectId, t]));
  const parents = [];
  const matrix = (value) => new DOMMatrix(value);
  const array = (m) => [m.a, m.b, m.c, m.d, m.e, m.f];
  function changes(id) {
    const original = declarations.get(id)?.text,
      current = textValues.get(`${prefix}:o:${id}`);
    if (!original || !current) return {};
    const defaults = current.nativeDefault || {
      font: "sans-serif",
      fill: "#252720",
      anchor: "start",
      width: 0,
      start: 0,
      end: 1e9,
      ...original,
    };
    const changed = Object.fromEntries(
      fields
        .filter((k) => current[k] !== defaults[k])
        .map((k) => [k, current[k]]),
    );
    if (changed.x !== undefined) changed.offsetX = current.x - defaults.x;
    if (changed.y !== undefined) changed.offsetY = current.y - defaults.y;
    if (changed.fill !== undefined)
      changed.strokeOnly = original.paintMode === "stroke";
    return changed;
  }
  function parameters(id) {
    const defs = declarations.get(id)?.parameters || {},
      values = scene.parameterOverrides?.[`${prefix}:o:${id}`] || {};
    return Object.fromEntries(
      Object.entries(values).filter(([k, v]) => v !== defs[k]?.default),
    );
  }
  function capture(id, ctx, draw, frame) {
    const declaration =
      declarations.get(id) || (inspecting ? frame.declaration : null);
    if (!declaration)
      throw Error(
        `未登记的源码对象：${id}（${time.toFixed(3)}秒，${frame.declaration?.label}，${frame.declaration?.origin?.file}:${frame.declaration?.origin?.line}）`,
      );
    if (
      !Array.isArray(frame.bounds) ||
      frame.bounds.length !== 4 ||
      !frame.bounds.every(Number.isFinite)
    )
      throw Error("源码对象边界无效");
    const parent = parents.at(-1);
    if (!inspecting && (declaration.parentId || null) !== (parent?.id || null))
      throw Error(
        `源码对象 ${id} 的层级发生变化（${time.toFixed(3)}秒，声明父级 ${declaration.parentId || "根"}，实际父级 ${parent?.id || "根"}）`,
      );
    const output = matrix(frame.toOutput || [1, 0, 0, 1, 0, 0]),
      base = ctx.getTransform();
    const before = output.multiply(base),
      parentWorld = parent?.world || new DOMMatrix();
    const relative = parentWorld.inverse().multiply(before);
    const edit = scene.objectOverrides[`${prefix}:o:${id}`] || {},
      [x, y, w, h] = declaration.bounds;
    const cx = x + w / 2,
      cy = y + h / 2;
    const layout = new DOMMatrix()
      .translate(edit.dx || 0, edit.dy || 0)
      .translate(cx, cy)
      .rotate(edit.rotation || 0)
      .scale(edit.scale ?? 1)
      .translate(-cx, -cy);
    const world = parentWorld.multiply(layout).multiply(relative);
    const transformed = Boolean(
      parent?.transformed ||
        edit.dx ||
        edit.dy ||
        edit.rotation ||
        (edit.scale !== undefined && edit.scale !== 1),
    );
    const textChange = changes(id),
      hidden =
        parent?.hidden ||
        edit.hidden ||
        (textChange.start !== undefined && time < textChange.start) ||
        (textChange.end !== undefined && time >= textChange.end);
    const record = {
      id,
      bounds: frame.bounds,
      matrix: array(relative),
      visible: !hidden && frame.visible !== false,
    };
    if (frame.text !== undefined) record.text = frame.text;
    if (inspecting)
      record.declaration = {
        ...frame.declaration,
        id,
        bounds: frame.bounds,
        parentId: parent?.id || null,
      };
    const previous = records.find((r) => r.id === id);
    if (previous) {
      const a = previous.bounds,
        b = record.bounds,
        x = Math.min(a[0], b[0]),
        y = Math.min(a[1], b[1]);
      previous.bounds = [
        x,
        y,
        Math.max(a[0] + a[2], b[0] + b[2]) - x,
        Math.max(a[1] + a[3], b[1] + b[3]) - y,
      ];
      if (inspecting) previous.declaration.bounds = previous.bounds;
    } else records.push(record);
    if (hidden && !frame.withoutPainting) return frame.result;
    const edited = output.inverse().multiply(world),
      delta = edited.multiply(base.inverse());
    parents.push({ id, world, hidden, transformed });
    try {
      if (transformed) ctx.setTransform(edited);
      return hidden ? frame.withoutPainting(draw) : draw();
    } finally {
      parents.pop();
      if (transformed)
        ctx.setTransform(delta.inverse().multiply(ctx.getTransform()));
    }
  }
  return { capture, textChanges: changes, parameterChanges: parameters };
}
