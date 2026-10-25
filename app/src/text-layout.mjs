/** Shared wrapping for SVG and Canvas; measurement belongs to each drawing context. */
export function wrapLines(text, width, measure) {
  return text.split("\n").flatMap((line) => {
    if (!width) return [line];
    const lines = [];
    let row = "";
    for (const char of line) {
      if (row && measure(row + char) > width) {
        lines.push(row);
        row = "";
      }
      row += char;
    }
    lines.push(row);
    return lines;
  });
}
