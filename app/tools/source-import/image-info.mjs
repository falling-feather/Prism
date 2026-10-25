import fs from "node:fs/promises";
/** Read dimensions only. Source imports must not decode every image at startup. */
export async function imageInfo(filename) {
  const file = await fs.open(filename, "r");
  try {
    let b = Buffer.alloc(32);
    await file.read(b, 0, b.length, 0);
    let width, height;
    if (
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      width = b.readUInt32BE(16);
      height = b.readUInt32BE(20);
    } else if (b[0] === 255 && b[1] === 216) {
      b = Buffer.alloc(Math.min((await file.stat()).size, 1024 ** 2));
      await file.read(b, 0, b.length, 0);
      for (let p = 2; p + 4 < b.length; ) {
        if (b[p++] !== 255) break;
        while (b[p] === 255) p++;
        const marker = b[p++];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const length = b.readUInt16BE(p);
        if (length < 2 || p + length > b.length) break;
        if (
          [
            0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
            0xce, 0xcf,
          ].includes(marker)
        ) {
          height = b.readUInt16BE(p + 3);
          width = b.readUInt16BE(p + 5);
          break;
        }
        p += length;
      }
    } else if (
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP"
    ) {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8X") {
        width = 1 + b.readUIntLE(24, 3);
        height = 1 + b.readUIntLE(27, 3);
      } else if (kind === "VP8L" && b[20] === 0x2f) {
        const bits = b.readUInt32LE(21);
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
      } else if (kind === "VP8 ") {
        width = b.readUInt16LE(26) & 0x3fff;
        height = b.readUInt16LE(28) & 0x3fff;
      }
    }
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 16384 ||
      height > 16384 ||
      width * height * 4 > 256 * 1024 ** 2
    )
      throw Error("无法读取受支持范围内的图片尺寸：" + filename);
    return { width, height };
  } finally {
    await file.close();
  }
}
