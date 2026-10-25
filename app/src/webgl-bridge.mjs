/** Track 2D texture dependencies without replacing shaders or rasterizing the film. */
export function observeWebGL(
  gl,
  { measuring, connect, snapshot, resolveImage, limitation },
) {
  const methods = new Map(),
    bindings = new Map(),
    feeds = new WeakMap(),
    attachments = new WeakMap(),
    samplers = new WeakMap(),
    locations = new WeakMap(),
    units = new WeakMap();
  let unit = gl.TEXTURE0,
    framebuffer = null,
    program = null,
    viewport = [0, 0, gl.canvas.width, gl.canvas.height];
  limitation(
    "webgl",
    "WebGL 后期保持原始着色器；选择框按二维纹理层定位，不恢复三维网格或着色器中的非线性形变。",
  );
  function inputs() {
    if (!program) return [];
    if (!samplers.has(program)) {
      const list = [];
      for (
        let i = 0;
        i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        i++
      ) {
        const info = gl.getActiveUniform(program, i);
        if (info.type === gl.SAMPLER_2D) {
          if (info.size !== 1)
            throw Error("暂不支持 WebGL 纹理采样器数组的对象映射");
          const location = gl.getUniformLocation(program, info.name);
          if (!units.has(program)) units.set(program, new Map());
          if (!units.get(program).has(info.name))
            units.get(program).set(info.name, gl.getUniform(program, location));
          list.push(info.name);
        }
      }
      samplers.set(program, list);
    }
    const leaves = new Set();
    for (const name of samplers.get(program))
      for (const canvas of feeds.get(
        bindings.get(gl.TEXTURE0 + units.get(program).get(name)),
      ) || [])
        leaves.add(canvas);
    return leaves;
  }
  return new Proxy(gl, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== "function") return value;
      if (methods.has(key)) return methods.get(key);
      const fn = (...args) => {
        if (key === "activeTexture") unit = args[0];
        if (key === "bindTexture" && args[0] === gl.TEXTURE_2D)
          bindings.set(unit, args[1]);
        if (key === "bindFramebuffer" && args[0] !== gl.READ_FRAMEBUFFER)
          framebuffer = args[1];
        if (
          key === "framebufferTexture2D" &&
          framebuffer &&
          args[1] === gl.COLOR_ATTACHMENT0
        )
          attachments.set(framebuffer, args[3]);
        if (key === "useProgram") program = args[0];
        if (key === "uniform1i" && args[0]) {
          const location = locations.get(args[0]);
          if (location) {
            if (!units.has(location.program))
              units.set(location.program, new Map());
            units.get(location.program).set(location.name, args[1]);
          }
        }
        if (key === "linkProgram") {
          samplers.delete(args[0]);
          units.delete(args[0]);
        }
        if (key === "viewport") viewport = args.slice();
        if (
          (key === "texImage2D" || key === "texSubImage2D") &&
          args[0] === gl.TEXTURE_2D
        ) {
          const texture = bindings.get(unit),
            image = args.at(-1);
          if (texture && image instanceof OffscreenCanvas)
            feeds.set(texture, new Set([snapshot(image)]));
          else if (texture && key === "texImage2D") feeds.delete(texture);
          args = args.slice();
          args[args.length - 1] = resolveImage(image);
        }
        if (key === "deleteTexture") feeds.delete(args[0]);
        if (key === "clear" && args[0] & gl.COLOR_BUFFER_BIT) {
          const texture = framebuffer && attachments.get(framebuffer);
          if (texture) feeds.delete(texture);
        }
        if (
          [
            "drawArrays",
            "drawElements",
            "drawArraysInstanced",
            "drawElementsInstanced",
          ].includes(key)
        ) {
          const leaves = inputs(),
            texture = framebuffer && attachments.get(framebuffer);
          if (texture) feeds.set(texture, leaves);
          else if (!framebuffer && measuring()) {
            const [x, y, w, h] = viewport;
            for (const source of leaves)
              if (source.canvas !== gl.canvas)
                connect(source, gl.canvas, [
                  w / source.canvas.width,
                  0,
                  0,
                  h / source.canvas.height,
                  x,
                  gl.canvas.height - y - h,
                ]);
          }
        }
        const result = value.apply(target, args);
        if (key === "getUniformLocation" && result)
          locations.set(result, { program: args[0], name: args[1] });
        return result;
      };
      methods.set(key, fn);
      return fn;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}
