/** Affine matrices map object-parent coordinates into the shared stage coordinates. */
export function canonicalIds(ids, parents) {
  const unique = [...new Set(ids)],
    selected = new Set(unique);
  return unique.filter((id) => {
    let parent = parents.get(id);
    const seen = new Set([id]);
    while (parent) {
      if (selected.has(parent)) return false;
      if (seen.has(parent)) throw Error("组件层级存在循环");
      seen.add(parent);
      parent = parents.get(parent);
    }
    return true;
  });
}
export function unionBounds(rects) {
  if (!rects.length) return null;
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}
export function containsRect(outer, inner) {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.bottom <= outer.bottom + 0.5
  );
}
function localVector(m, x, y) {
  const determinant = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10)
    throw Error("组件当前父级变换不可编辑");
  return {
    x: (m.d * x - m.c * y) / determinant,
    y: (m.a * y - m.b * x) / determinant,
  };
}
function worldPoint(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}
export function translateOverrides(scene, entries, dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    throw Error("位移必须是有效数字");
  const result = { ...scene.objectOverrides };
  for (const e of entries) {
    const old = scene.objectOverrides[e.id] || {},
      delta = localVector(e.parent, dx, dy);
    result[e.id] = {
      ...old,
      dx: (old.dx || 0) + delta.x,
      dy: (old.dy || 0) + delta.y,
    };
  }
  return result;
}
export function scaleOverrides(scene, entries, factor, mode) {
  if (
    !Number.isFinite(factor) ||
    factor <= 0 ||
    !["individual", "group"].includes(mode)
  )
    throw Error("缩放参数无效");
  const result = { ...scene.objectOverrides },
    box = unionBounds(entries.map((e) => e.bounds));
  if (!box) return result;
  const center = {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
  for (const e of entries) {
    const old = scene.objectOverrides[e.id] || {},
      scale = (old.scale ?? 1) * factor;
    if (scale < 0.05 - 1e-9 || scale > 20 + 1e-9)
      throw Error("缩放超出组件允许的 5%–2000% 范围");
    const anchor =
      mode === "group"
        ? center
        : {
            x: (e.bounds.left + e.bounds.right) / 2,
            y: (e.bounds.top + e.bounds.bottom) / 2,
          };
    const pivot = worldPoint(
      e.parent,
      (old.dx || 0) + e.pivot.x,
      (old.dy || 0) + e.pivot.y,
    );
    const delta = localVector(
      e.parent,
      (factor - 1) * (pivot.x - anchor.x),
      (factor - 1) * (pivot.y - anchor.y),
    );
    result[e.id] = {
      ...old,
      scale: Math.min(20, Math.max(0.05, scale)),
      dx: (old.dx || 0) + delta.x,
      dy: (old.dy || 0) + delta.y,
    };
  }
  return result;
}
