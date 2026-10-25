import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { appendProject } from "../src/project-merge.mjs";
import { canvasCatalog } from "../src/source-contract.mjs";
import {
  EditValidator,
  snapshotProject,
  validateProject,
} from "../src/project.mjs";

const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`../cases/universal/${name}.svgfilm.json`, import.meta.url),
    ),
  );
test("append resolves collisions without losing edits or resource bindings", () => {
  const p = fixture("cards"),
    s = p.scenes[0],
    catalog = canvasCatalog("cards", p.sources.cards);
  Object.assign(s, catalog);
  s.objectOverrides["cards:o:card"] = { dx: 25 };
  s.parameterOverrides = { "cards:o:card": { speed: 2 } };
  s.texts[0].text = "保留这次修改";
  const original = JSON.stringify(p);
  const merged = appendProject(p, p),
    added = merged.scenes[1];
  assert.notEqual(added.sourceId, "cards");
  assert.notEqual(added.id, s.id);
  assert.equal(added.texts[0].text, "保留这次修改");
  assert.equal(added.parameterOverrides[`${added.sourceId}:o:card`].speed, 2);
  assert.equal(added.objectOverrides[`${added.sourceId}:o:card`].dx, 25);
  assert.notEqual(
    merged.sources[added.sourceId].assets.portrait,
    "portrait-image",
  );
  assert.equal(JSON.stringify(p), original);
  validateProject(merged);
});
test("resource-backed audio uses an exact metadata budget and survives history snapshots", () => {
  const p = fixture("clockwork");
  p.resources = {
    voice: { name: "voice.wav", mime: "audio/wav", assetId: "a".repeat(64) },
  };
  p.audioTracks = [
    {
      id: "voice",
      name: "voice",
      resourceId: "voice",
      start: 0,
      offset: 0,
      duration: 2,
      mediaDuration: 2,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
    },
  ];
  const validator = new EditValidator();
  validator.validate(p);
  assert.equal(validator.byteLength(p), Buffer.byteLength(JSON.stringify(p)));
  assert.equal(snapshotProject(p).audioTracks[0].resourceId, "voice");
  const merged = appendProject(p, p);
  assert.equal(merged.audioTracks[1].start, 6);
  assert.notEqual(merged.audioTracks[1].resourceId, "voice");
});

test("immutable inline assets are shared by history and replaced assets invalidate validation", () => {
  const p = fixture("cards"),
    validator = new EditValidator();
  validator.validate(p);
  const snapshot = snapshotProject(p);
  assert.equal(snapshot.resources, p.resources);
  assert.equal(validator.byteLength(p), Buffer.byteLength(JSON.stringify(p)));
  p.resources = {
    ...p.resources,
    "portrait-image": { ...p.resources["portrait-image"], mime: "text/html" },
  };
  assert.throws(() => validator.validate(p), /类型/);
});
