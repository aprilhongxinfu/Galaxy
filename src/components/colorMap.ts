// colorMap.ts
// import * as d3 from 'd3';

export const colorMap = new Map<string, string>();

// 推荐色盘1（绿色/橙色/蓝色/紫色/粉色等，适合分组对比）
// const palette = [
//   '#32A251FF', '#ACD98DFF', '#FF7F0FFF', '#FFB977FF',
//   '#3CB7CCFF', '#98D9E4FF', '#B85A0DFF', '#FFD94AFF',
//   '#39737CFF', '#86B4A9FF', '#82853BFF', '#CCC94DFF'
// ];

// categorial 12
// const palette = [
//   '#FFBF80', '#FF8000', '#FFFF99', '#FFFF33',
//   '#B2FF8C', '#33FF00', '#A6EDFF', '#1AB2FF',
//   '#CCBFFF', '#664CFF', '#FF99BF', '#E61A33'
// ];

// 推荐色盘3（用户新提供，已转为6位色值，原始为 #RRGGBBAA）
// const palette = ["#cec09a",
//   "#a6c0f6",
//   "#dfb8db",
//   "#eab1a3",
//   "#f0e2ba",
//   "#8cd4e0",
//   "#9cccb2",
//   "#90c9e7",
//   "#d3d7cf",
//   "#d9eac2",
//   "#c7c8df",
//   "#bce3e0"];

//pastel 12
const palette = [
  '#66C5CCFF', '#F6CF71FF', '#F89C74FF', '#DCB0F2FF', '#87C55FFF', '#9EB9F3FF', '#FE88B1FF', '#C9DB74FF', '#8BE0A4FF', '#B497E7FF', '#D3B484FF', '#B3B3B3FF'
];

// Green Orange Teal
// const palette = [
//   '#4E9F50FF', '#87D180FF', '#EF8A0CFF', '#FCC66DFF', '#3CA8BCFF', '#98D9E4FF', '#94A323FF', '#C3CE3DFF', '#A08400FF', '#F7D42AFF', '#26897EFF', '#8DBFA8FF'
// ];

//Purple Pink Gray
// const palette = [
//   '#8074A8FF', '#C6C1F0FF', '#C46487FF', '#FFBED1FF', '#9C9290FF', '#C5BFBEFF', '#9B93C9FF', '#DDB5D5FF', '#7C7270FF', '#F498B6FF', '#B173A0FF', '#C799BCFF'
// ];

//Rainbow
// const palette = [
//   '#E51E32FF', '#FF782AFF', '#FDA805FF', '#E2CF04FF', '#B1CA05FF', '#98C217FF', '#779815FF', '#029E77FF', '#09989CFF', '#059CCDFF', '#3F64CEFF', '#7E2B8EFF'
// ];

//vivid
// const palette = [
//   '#E58606FF', '#5D69B1FF', '#52BCA3FF', '#99C945FF', '#CC61B0FF', '#24796CFF', '#DAA51BFF', '#2F8AC4FF', '#764E9FFF', '#ED645AFF', '#CC3A8EFF', '#A5AA99FF'
// ];

//safe
// const palette = [
//   '#88CCEEFF', '#CC6677FF', '#DDCC77FF', '#117733FF', '#332288FF', '#AA4499FF', '#44AA99FF', '#999933FF', '#882255FF', '#661100FF', '#6699CCFF', '#888888FF'
// ];

export function initColorMap(stages: Set<string>) {
  colorMap.clear();
  Array.from(stages).sort().forEach((s, i) => {
    colorMap.set(s, palette[i % palette.length]);
  });
}