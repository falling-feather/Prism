import test from "node:test";
import assert from "node:assert/strict";
import { instrument } from "./instrument.mjs";

test("helpers that reset a forwarded canvas cannot advertise a layout transform", () => {
  const result = instrument(
    `
function reset(c){c.setTransform(1,0,0,1,0,0);}
function stage(image,c){reset(c);c.drawImage(image,0,0);}
function movie(c,image){stage(image,c);c.drawImage(image,1,1);}
function sprite(c,image){c.save();c.translate(10,20);c.drawImage(image,0,0);c.restore();}
`,
    { filename: "forwarded.js" },
  );
  assert.equal(result.definitions.find((d) => d.name === "movie").kind, null);
  assert.equal(
    result.definitions.find((d) => d.name === "sprite").kind,
    "image",
  );
});
