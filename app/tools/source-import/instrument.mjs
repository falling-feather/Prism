import crypto from "node:crypto";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generatorModule from "@babel/generator";
import * as t from "@babel/types";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
const traverse = traverseModule.default || traverseModule,
  generate = generatorModule.default || generatorModule;
const drawing = new Set(["fill", "stroke", "fillRect", "strokeRect"]);

export function instrument(
  code,
  { sourceMap = null, filename = "source.js" } = {},
) {
  const ast = parse(code, { sourceType: "module" }),
    functions = [],
    byName = new Map(),
    map = sourceMap ? new TraceMap(sourceMap) : null;
  traverse(ast, {
    Function(p) {
      if (p.node.async || p.node.generator || !p.node.params.length) return;
      const names = p.node.params.map((v) =>
        t.isIdentifier(v)
          ? v.name
          : t.isAssignmentPattern(v) && t.isIdentifier(v.left)
            ? v.left.name
            : null,
      );
      if (names.some((v) => !v)) return;
      const name =
        p.node.id?.name ||
        (p.parentPath.isVariableDeclarator() && p.parentPath.node.id.name) ||
        null;
      const origin = map
        ? originalPositionFor(map, {
            line: p.node.loc.start.line,
            column: p.node.loc.start.column,
          })
        : {
            source: filename,
            line: p.node.loc.start.line,
            column: p.node.loc.start.column,
          };
      const id = crypto
        .createHash("sha256")
        .update(
          `${origin.source}:${origin.line}:${origin.column}:${name || "callback"}`,
        )
        .digest("hex")
        .slice(0, 16);
      const info = {
        path: p,
        name,
        names,
        id,
        origin: {
          file: origin.source || filename,
          line: origin.line || 0,
          column: origin.column || 0,
        },
        direct: new Set(),
        calls: [],
        reset: false,
        resets: new Set(),
        rawText: null,
        text: null,
        kind: null,
        identity: names.indexOf("who"),
      };
      p.traverse({
        Function(child) {
          child.skip();
        },
        CallExpression(c) {
          const callee = c.node.callee;
          if (
            t.isMemberExpression(callee) &&
            !callee.computed &&
            t.isIdentifier(callee.property)
          ) {
            const method = callee.property.name;
            const position = t.isIdentifier(callee.object)
              ? names.indexOf(callee.object.name)
              : -1;
            if (
              position >= 0 &&
              ["setTransform", "resetTransform", "reset"].includes(method)
            )
              info.resets.add(position);
            if (t.isIdentifier(callee.object, { name: names[0] })) {
              if (drawing.has(method)) info.direct.add("vector");
              if (method === "drawImage") info.direct.add("image");
              if (method === "fillText" || method === "strokeText") {
                info.direct.add("text");
                if (!info.rawText) info.rawText = c.node.arguments;
              }
              if (
                method === "setTransform" ||
                method === "resetTransform" ||
                method === "reset"
              )
                info.reset = true;
            }
          } else if (t.isIdentifier(callee))
            info.calls.push({ name: callee.name, args: c.node.arguments });
        },
      });
      functions.push(info);
      if (name) byName.set(name, info);
    },
  });
  const index = (info, node, fallback) =>
    t.isIdentifier(node) && info.names.includes(node.name)
      ? info.names.indexOf(node.name)
      : info.names.indexOf(fallback);
  for (const info of functions)
    if (info.rawText) {
      const a = info.rawText;
      info.text = {
        text: index(info, a[0], "text"),
        x: index(info, a[1], "x"),
        y: index(info, a[2], "y"),
        size: info.names.indexOf("size"),
        fill: info.names.indexOf("col"),
        options: info.names.indexOf("o"),
      };
      if (info.text.text < 0) info.text = null;
    }
  for (let pass = 0; pass < 8; pass++)
    for (const info of functions) {
      const children = info.calls
        .map((c) => ({ ...c, callee: byName.get(c.name) }))
        .filter((c) => c.callee);
      const kinds = new Set(info.direct);
      for (const child of children)
        for (const position of child.callee.resets) {
          const argument = child.args[position];
          const forwarded = t.isIdentifier(argument)
            ? info.names.indexOf(argument.name)
            : -1;
          if (forwarded >= 0) info.resets.add(forwarded);
        }
      info.reset = info.resets.has(0);
      if (info.reset) {
        info.kind = null;
        continue;
      }
      for (const child of children)
        if (child.callee.kind) kinds.add(child.callee.kind);
      if (info.name && !info.reset) {
        if (info.text) info.kind = "text";
        else if (kinds.size === 1 && kinds.has("text")) {
          const child = children.find((c) => c.callee.text);
          if (child) {
            const text = {};
            for (const [key, pos] of Object.entries(child.callee.text))
              text[key] =
                pos < 0
                  ? -1
                  : index(
                      info,
                      child.args[pos],
                      key === "text"
                        ? "s"
                        : key === "fill"
                          ? "col"
                          : key === "options"
                            ? "o"
                            : key,
                    );
            if (text.text >= 0) {
              info.text = text;
              info.kind = "text";
            }
          }
        } else if (
          kinds.has("image") &&
          !kinds.has("text") &&
          !info.direct.has("vector") &&
          children.filter((c) => c.callee.kind === "image").length <= 1
        )
          info.kind = "image";
        else if (info.direct.has("image") && !kinds.has("text"))
          info.kind = "image";
        else if (info.direct.has("vector")) info.kind = "vector";
      }
    }
  const definitions = functions.map(
    ({ path: _, names, direct, calls, reset, resets, rawText, ...def }) => def,
  );
  // Wrap existing bodies without changing lexical this, arguments, defaults or return values.
  for (let i = functions.length - 1; i >= 0; i--) {
    const info = functions[i],
      node = info.path.node;
    const body = t.isBlockStatement(node.body)
      ? node.body
      : t.blockStatement([t.returnStatement(node.body)]);
    const edited = t.identifier("__prismEditedArgs");
    const assign = t.expressionStatement(
      t.assignmentExpression(
        "=",
        t.arrayPattern(info.names.map((n) => t.identifier(n))),
        edited,
      ),
    );
    const run = t.callExpression(
      t.memberExpression(
        t.identifier("__prismSourceBridge"),
        t.identifier("run"),
      ),
      [
        t.memberExpression(
          t.identifier("__prismSourceDefs"),
          t.numericLiteral(i),
          true,
        ),
        t.arrayExpression(info.names.map((n) => t.identifier(n))),
        t.arrowFunctionExpression(
          [edited],
          t.blockStatement([assign, ...body.body]),
        ),
      ],
    );
    node.body = t.blockStatement([t.returnStatement(run)]);
    node.body.directives = body.directives;
    node.expression = false;
  }
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (
        !t.isMemberExpression(callee) ||
        callee.computed ||
        !t.isIdentifier(callee.property) ||
        ![
          "drawImage",
          "fillText",
          "strokeText",
          "fill",
          "stroke",
          "fillRect",
          "strokeRect",
        ].includes(callee.property.name)
      )
        return;
      const origin = map
        ? originalPositionFor(map, {
            line: p.node.loc.start.line,
            column: p.node.loc.start.column,
          })
        : {
            source: filename,
            line: p.node.loc.start.line,
            column: p.node.loc.start.column,
          };
      const signature = callee.property.name.includes("Text")
        ? generate(t.arrayExpression(p.node.arguments)).code
        : `${origin.line}:${origin.column}:${callee.property.name}`;
      const parent = p.getFunctionParent()?.node.loc?.start;
      const id = crypto
        .createHash("sha256")
        .update(`${origin.source}:${parent?.line}:${signature}`)
        .digest("hex")
        .slice(0, 16);
      const original = p.node;
      p.replaceWith(
        t.callExpression(
          t.memberExpression(
            t.identifier("__prismSourceBridge"),
            t.identifier("at"),
          ),
          [
            t.valueToNode({
              id,
              origin: {
                file: origin.source || filename,
                line: origin.line || 0,
                column: origin.column || 0,
              },
            }),
            t.arrowFunctionExpression([], original),
          ],
        ),
      );
      p.skip();
    },
  });
  const output = generate(ast, { comments: false, compact: false }).code;
  return {
    code:
      "const __prismSourceDefs=" + JSON.stringify(definitions) + ";\n" + output,
    definitions,
  };
}
