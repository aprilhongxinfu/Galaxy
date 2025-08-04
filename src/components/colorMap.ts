// colorMap.ts
// import * as d3 from 'd3';

import { LABEL_MAP } from './labelMap';

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

//pastel 12 - 按照labelMap.ts顺序排列
const palette = [
  '#87C55FFF', // 0: Environment (浅绿色)
  '#66C5CCFF', // 1: Data_Extraction (浅蓝色/青色)
  '#C9DB74FF', // 2: Data_Transform (黄绿色)
  '#9EB9F3FF', // 3: EDA (浅蓝色)
  '#8BE0A4FF', // 4: Visualization (薄荷绿色)
  '#B497E7FF', // 5: Feature_Engineering (浅薰衣草色/紫色)
  '#F89C74FF', // 6: Hyperparam_Tuning (浅橙色/桃色)
  '#FE88B1FF', // 7: Model_Train (粉色)
  '#DCB0F2FF', // 8: Model_Evaluation (浅紫色)
  '#D3B484FF', // 9: Data_Export (浅棕色/米色)
  '#F6CF71FF', // 10: Commented (浅橙色)
  '#B3B3B3FF', // 11: Debug (灰色) - 不用于着色
  '#B3B3B3FF'  // 12: Other (灰色)
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

// 使用 LABEL_MAP 动态生成所有可能的 stage 类型
function getAllPossibleStages(): string[] {
  // 只返回数字标签，避免重复
  return Object.keys(LABEL_MAP);
}

// 全局 stage 到颜色的映射，确保所有 JSON 文件中相同的 stage 都使用相同的颜色
const globalStageColorMap = new Map<string, string>();

// 初始化全局颜色映射
function initGlobalColorMap() {
  if (globalStageColorMap.size > 0) {
    return; // 已经初始化过了
  }
  
  // 获取所有可能的 stage（只包含数字标签）
  const allPossibleStages = getAllPossibleStages();
  
  // 为所有可能的 stage 分配颜色，直接一一对应
  allPossibleStages.forEach((stage, index) => {
    const color = palette[index];
    globalStageColorMap.set(stage, color);
  });
}

export function initColorMap(stages: Set<string>) {
  // 初始化全局颜色映射
  initGlobalColorMap();
  
  // 确保所有可能的stages都有颜色映射
  const allPossibleStages = getAllPossibleStages();
  allPossibleStages.forEach(stage => {
    if (!colorMap.has(stage)) {
      const stageColor = globalStageColorMap.get(stage);
      if (stageColor) {
        colorMap.set(stage, stageColor);
      }
    }
  });
  
  // 为当前数据中的 stage 分配颜色（如果还没有的话）
  stages.forEach(stage => {
    // 如果这个stage已经有颜色了，跳过
    if (colorMap.has(stage)) {
      return;
    }
    
    let color: string = '#B3B3B3FF'; // 默认颜色
    
    // 跳过 Debug 阶段，不给它着色
    if (stage === 'Debug' || stage === '11') {
      colorMap.set(stage, '#B3B3B3FF'); // 使用灰色，表示不参与着色
      return;
    }
    
    // 检查是否是数字标签
    if (LABEL_MAP[stage]) {
      // 如果是数字标签，直接使用对应的颜色
      const stageColor = globalStageColorMap.get(stage);
      if (stageColor) {
        color = stageColor;
      }
    } else {
      // 如果是完整名称，找到对应的数字标签
      const numericKey = Object.keys(LABEL_MAP).find(key => LABEL_MAP[key] === stage);
      if (numericKey) {
        const stageColor = globalStageColorMap.get(numericKey);
        if (stageColor) {
          color = stageColor;
        }
      } else {
        // 如果找不到对应的数字标签，使用默认颜色
        console.warn(`Unknown stage: ${stage}, using default color`);
      }
    }
    
    colorMap.set(stage, color);
  });
}