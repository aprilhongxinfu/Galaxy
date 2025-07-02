// colorMap.ts
import * as d3 from 'd3';

export const colorMap = new Map<string, string>();
const palette = d3.schemeSet3;

export function initColorMap(stages: Set<string>) {
  colorMap.clear();
  Array.from(stages).sort().forEach((s, i) => {
    colorMap.set(s, palette[i % palette.length]);
  });
}