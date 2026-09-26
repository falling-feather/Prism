import { test } from "node:test";
import assert from "node:assert/strict";
import { FastExporter } from "../src/fast-export.mjs";
test("cancellation interrupts an unresolved image or codec operation", async () => {
  let cancelled = false;
  const exporter = new FastExporter(null, async () => cancelled);
  setTimeout(() => {
    cancelled = true;
  }, 5);
  await assert.rejects(
    () => exporter.wait(new Promise(() => {}), 1000, "timeout"),
    /取消/,
  );
});
test("an asynchronous codec or image timeout is reported", async () => {
  const exporter = new FastExporter(null);
  await assert.rejects(
    () => exporter.wait(new Promise(() => {}), 10, "codec timeout"),
    /codec timeout/,
  );
});
