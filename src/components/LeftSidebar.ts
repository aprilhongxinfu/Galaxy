import { Widget } from '@lumino/widgets';
import * as d3 from 'd3';
import { LABEL_MAP } from './labelMap';

type Cell = {
    cellId: number;
    cellType: string;
    "1st-level label": string;
};

type Notebook = {
    cells: Cell[];
};


type StageDatum = {
    stage: string;
    avg_pos: number;
    avg_first: number;
    count: number;
    norm_pos?: number;
    y?: number;
    size?: number;
};

export class LeftSidebar extends Widget {
    private data: Notebook[];
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private stageData: StageDatum[] = [];
    private colorMap: Map<string, string>;
    private legendDiv: HTMLDivElement;
    private transitions: Map<string, number> = new Map();
    private stageFreq: Record<string, number> = {};
    private selection: any = null;
    private initialStageOrder: string[] = [];

    constructor(data: Notebook[], colorMap: Map<string, string>) {
        super();
        this.id = 'flow-chart-widget';
        this.title.label = 'Flow Chart';
        this.title.closable = true;
        this.addClass('flow-chart-widget');
        this.data = data;
        this.colorMap = colorMap;

        // 初始化 stageData 顺序（只做一次）
        const stageStats = new Map<string, { positions: number[]; firstPositions: number[]; count: number }>();
        this.data.forEach((nb) => {
            const cells = [...nb.cells]
                .sort((a, b) => a.cellId - b.cellId)
                .filter((d) => d.cellType === 'code');
            const stageSeq: string[] = [];
            cells.forEach((cell) => {
                const stage = String(cell["1st-level label"] ?? "None");
                if (!stageStats.has(stage)) {
                    stageStats.set(stage, {
                        positions: [],
                        firstPositions: [],
                        count: 0
                    });
                }
                stageStats.get(stage)!.count++;
                if (stageSeq.length === 0 || stageSeq[stageSeq.length - 1] !== stage) {
                    stageSeq.push(stage);
                }
            });
        });
        this.stageData = Array.from(stageStats.keys()).map(stage => ({ stage: String(stage), avg_pos: 0, avg_first: 0, count: 0 }));
        // 保存初始顺序
        this.initialStageOrder = this.stageData.map(d => d.stage);

        // 清空 this.node
        this.node.innerHTML = '';
        this.node.style.display = 'flex';
        this.node.style.flexDirection = 'column';
        this.node.style.height = '100%';
        this.node.style.padding = '16px 16px 12px 16px'; // 统一内边距

        // 右上角重置排序 icon
        const resetDiv = document.createElement('div');
        resetDiv.style.position = 'absolute';
        resetDiv.style.top = '12px';
        resetDiv.style.right = '18px';
        resetDiv.style.zIndex = '10';
        resetDiv.style.cursor = 'pointer';
        resetDiv.title = '重置排序';
        resetDiv.innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="#888" stroke-width="1.5" fill="#fff"/><path d="M6.5 10A3.5 3.5 0 0 1 10 6.5c1.93 0 3.5 1.57 3.5 3.5h1.2c0-2.6-2.1-4.7-4.7-4.7S5.3 7.4 5.3 10s2.1 4.7 4.7 4.7c1.5 0 2.8-.7 3.7-1.8l-1-.8c-.7.8-1.7 1.3-2.7 1.3A3.5 3.5 0 0 1 6.5 10Z" fill="#888"/></svg>`;
        resetDiv.onmouseenter = () => { resetDiv.style.background = '#f0f0f0'; };
        resetDiv.onmouseleave = () => { resetDiv.style.background = 'none'; };
        resetDiv.onclick = () => {
            // 重置排序
            this.stageData = this.initialStageOrder.map(stage => {
                // 找到当前 stageData 对应的对象
                return this.stageData.find(d => d.stage === stage)!;
            });
            this.render();
        };
        // 容器需 position:relative
        this.node.style.position = 'relative';
        this.node.appendChild(resetDiv);

        // 中间 flowchart 区域
        const chartContainer = document.createElement('div');
        chartContainer.className = 'galaxy-flowchart-container';
        chartContainer.style.flex = '1';
        chartContainer.style.overflow = 'auto';
        this.node.appendChild(chartContainer);

        // 底部 legend
        this.legendDiv = document.createElement('div');
        this.legendDiv.className = 'galaxy-legend';
        this.legendDiv.style.display = 'flex';
        this.legendDiv.style.alignItems = 'center';
        this.legendDiv.style.justifyContent = 'flex-start';
        this.node.appendChild(this.legendDiv);

        // SVG 渲染到中间
        const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgElement.setAttribute('viewBox', '0 0 400 800');
        svgElement.setAttribute('preserveAspectRatio', 'xMidYMin meet');
        svgElement.style.width = '100%';
        svgElement.style.height = '100%';
        chartContainer.appendChild(svgElement);
        this.svg = d3.select(svgElement);

        // 全局 tooltip div
        if (!document.getElementById('galaxy-tooltip')) {
            const tooltip = document.createElement('div');
            tooltip.id = 'galaxy-tooltip';
            tooltip.style.position = 'fixed';
            tooltip.style.display = 'none';
            tooltip.style.pointerEvents = 'none';
            tooltip.style.background = 'rgba(0,0,0,0.75)';
            tooltip.style.color = '#fff';
            tooltip.style.padding = '6px 10px';
            tooltip.style.borderRadius = '4px';
            tooltip.style.fontSize = '12px';
            tooltip.style.zIndex = '9999';
            document.body.appendChild(tooltip);
        }

        window.addEventListener('galaxy-selection-cleared', () => {
            this.selection = null;
            this.render();
        });
        // 新增：监听 flow 选中事件
        window.addEventListener('galaxy-flow-selected', (e: any) => {
            const { from, to } = e.detail;
            this.selection = { type: 'flow', from, to };
            this.render();
        });

        this.render();
    }

    private render(): void {
        // --- 更新顶部面包屑导航栏 ---
        let nav = this.node.querySelector('.galaxy-breadcrumbs') as HTMLDivElement;
        if (!nav) {
            nav = document.createElement('div');
            nav.className = 'galaxy-breadcrumbs';
            this.node.insertBefore(nav, this.node.firstChild);
        }
        // 根据 selection 类型渲染面包屑
        if (this.selection?.type === 'stage') {
            nav.innerHTML = '<span class="galaxy-breadcrumb-overview">Overview</span> / <b>' + (LABEL_MAP[this.selection.stage] ?? this.selection.stage) + '</b>';
        } else if (this.selection?.type === 'flow') {
            nav.innerHTML = '<span class="galaxy-breadcrumb-overview">Overview</span> / <b>' +
                (LABEL_MAP[this.selection.from] ?? this.selection.from) +
                ' → ' +
                (LABEL_MAP[this.selection.to] ?? this.selection.to) +
                '</b>';
        } else {
            nav.innerHTML = 'Overview';
        }
        // 只在有 selection 时，Overview 可点击
        const overviewSpan = nav.querySelector('.galaxy-breadcrumb-overview') as HTMLSpanElement;
        if (overviewSpan) {
            overviewSpan.style.cursor = 'pointer';
            overviewSpan.style.textDecoration = 'underline';
            overviewSpan.onclick = (e) => {
                this.selection = null;
                this.render();
                window.dispatchEvent(new CustomEvent('galaxy-selection-cleared'));
            };
        }

        this.svg.selectAll('*').remove();
        // 保证 stageData 里的 stage 都是 string
        this.stageData.forEach(d => {
            d.stage = String(d.stage);
        });
        // 调试输出
        const stageList = this.stageData.map(d => d.stage);
        const colorMapKeys = Array.from(this.colorMap.keys());
        console.log('LeftSidebar stageData:', stageList);
        console.log('LeftSidebar colorMap keys:', colorMapKeys);
        this.stageData.forEach(d => {
            if (!this.colorMap.has(d.stage)) {
                console.warn('colorMap 缺少 stage:', d.stage);
            }
        });
        const stageStats = new Map<string, { positions: number[]; firstPositions: number[]; count: number }>();
        const transitions: Map<string, number> = new Map();
        const stageFreq: Record<string, number> = {};

        const noneCells: Cell[] = [];
        this.data.forEach(nb => {
            nb.cells.forEach(cell => {
                if ((cell["1st-level label"] == null || cell["1st-level label"] === '') && cell['cellType'] === 'code') {
                    noneCells.push(cell);
                }
            });
        });
        console.log('None cells count:', noneCells.length);
        if (noneCells.length > 0) {
            console.log('Example None cell:', noneCells[0]);
        }

        this.data.forEach((nb) => {
            const cells = [...nb.cells]
                .sort((a, b) => a.cellId - b.cellId);
            const stageSeq: string[] = [];
            const stageFirstPos: Record<string, number> = {};

            cells.forEach((cell, idx) => {
                const relPos = idx / cells.length;
                const stage = String(cell["1st-level label"] ?? "None");
                if (!stageStats.has(stage)) {
                    stageStats.set(stage, {
                        positions: [],
                        firstPositions: [],
                        count: 0
                    });
                }
                stageStats.get(stage)!.positions.push(relPos);
                stageStats.get(stage)!.count++;
                if (stage !== 'None') {
                    stageFreq[stage] = (stageFreq[stage] || 0) + 1;
                }

                if (!(stage in stageFirstPos)) {
                    stageFirstPos[stage] = relPos;
                }

                if (stageSeq.length === 0 || stageSeq[stageSeq.length - 1] !== stage) {
                    stageSeq.push(stage);
                }
            });

            for (let stage in stageFirstPos) {
                stageStats.get(stage)!.firstPositions.push(stageFirstPos[stage]);
            }

            // flow 统计：只要相邻 cell 的 stage 是 from->to 就算一次
            for (let i = 0; i < cells.length - 1; i++) {
                const a = String(cells[i]["1st-level label"] ?? "None");
                const b = String(cells[i + 1]["1st-level label"] ?? "None");
                const key = `${a}->${b}`;
                transitions.set(key, (transitions.get(key) || 0) + 1);
            }
        });

        // 只更新统计信息，不重排顺序
        this.stageData.forEach((d) => {
            const info = stageStats.get(d.stage) || { positions: [], firstPositions: [], count: 0 };
            d.avg_pos = d3.mean(info.positions) || 0;
            d.avg_first = d3.mean(info.firstPositions) || 0;
            d.count = info.count;
        });

        this.stageData.forEach((d, i) => {
            d.norm_pos = i / (this.stageData.length - 1);
        });

        const yScale = d3.scaleLinear().domain([0, 1]).range([10, 700]);
        const maxCount = d3.max(this.stageData, (d) => d.count) || 1;
        const sizeScale = d3.scaleLinear().domain([0, maxCount]).range([10, 60]);
        const colorMap = this.colorMap;

        // flow 粗细最大值不超过 block 最小边长的 60%
        // const minBlock = 10; // sizeScale 最小值

        const countValues = Array.from(transitions.values());
        const maxFlowCount = d3.max(countValues) || 1;
        const minFlowCount = d3.min(countValues) || 0;
        const minWidth = 2;
        const maxWidth = 26;

        const strokeScale = (count: number) => {
            if (maxFlowCount === minFlowCount) return (minWidth + maxWidth) / 2;
            // 幂次缩放，主干线更粗
            const t = (count - minFlowCount) / (maxFlowCount - minFlowCount);
            return minWidth + Math.pow(t, 0.6) * (maxWidth - minWidth);
        };

        const svg = this.svg;
        const defs = svg.append("defs");
        const g = svg.append("g").attr("transform", "translate(200, 20)");

        const stageMap = new Map<string, { x: number; y: number; width: number; height: number; centerX: number; centerY: number }>();
        this.stageData.forEach((d) => {
            const y = yScale(d.norm_pos!);
            const size = sizeScale(d.count);
            d.y = y;
            d.size = size;
            stageMap.set(d.stage, {
                x: 0,
                y,
                width: size,
                height: size,
                centerX: size,
                centerY: y + size / 2
            });
        });

        transitions.forEach((count, key) => {
            const [from, to] = key.split("->");
            const fromPos = stageMap.get(from);
            const toPos = stageMap.get(to);
            if (!fromPos || !toPos) return;

            const x1 = fromPos.x;
            const y1 = fromPos.y;
            const x2 = toPos.x;
            const y2 = toPos.y;
            const side = y2 > y1 ? 1 : -1;

            const dy = Math.abs(y2 - y1);
            const offset = Math.min(dy * 0.5, 200);
            const ctrlX1 = x1 + side * offset;
            const ctrlX2 = x2 + side * offset;

            const gradientId = `grad-${from}-${to}`;
            const grad = defs.append("linearGradient")
                .attr("id", gradientId)
                .attr("gradientUnits", "userSpaceOnUse")
                .attr("x1", x1)
                .attr("y1", y1)
                .attr("x2", x2)
                .attr("y2", y2);

            grad.append("stop").attr("offset", "0%").attr("stop-color", colorMap.get(from) || '#ccc').attr("stop-opacity", 1);
            grad.append("stop").attr("offset", "100%").attr("stop-color", colorMap.get(to) || '#ccc').attr("stop-opacity", 0.2);

            g.append("path")
                .attr("d", `M${x1},${y1} C${ctrlX1},${y1} ${ctrlX2},${y2} ${x2},${y2}`)
                .attr("stroke", `url(#${gradientId})`)
                .attr("stroke-width", strokeScale(count))
                .attr("fill", "none")
                .attr("opacity", 0.7)
                .attr("class", (d) => `flow-link link-from-${from} link-to-${to}` + (this.selection && this.selection.type === 'flow' && this.selection.from === from && this.selection.to === to ? ' selected' : ''))
                .on("mouseover", (event) => {
                    d3.selectAll(".flow-link").attr("opacity", 0.05);
                    d3.selectAll(`.link-from-${from}.link-to-${to}`).attr("opacity", 1);
                    d3.selectAll(".stage-rect").attr("stroke-width", 0);
                    d3.selectAll(`.stage-${from}, .stage-${to}`)
                        .attr("stroke", "#000")
                        .attr("stroke-width", 2);
                    // 联动高亮 matrix pattern
                    window.dispatchEvent(new CustomEvent('galaxy-transition-hover', { detail: { from, to } }));
                    // tooltip
                    const tooltip = document.getElementById('galaxy-tooltip');
                    tooltip!.innerHTML = `${LABEL_MAP[from] ?? from} → ${LABEL_MAP[to] ?? to}<br>Count: ${count}`;
                    tooltip!.style.display = 'block';
                })
                .on("mousemove", (event) => {
                    const tooltip = document.getElementById('galaxy-tooltip');
                    tooltip!.style.left = event.clientX + 12 + 'px';
                    tooltip!.style.top = event.clientY + 12 + 'px';
                })
                .on("mouseout", () => {
                    d3.selectAll(".flow-link").attr("opacity", 0.7);
                    d3.selectAll(".stage-rect")
                        .attr("stroke", "none")
                        .attr("stroke-width", 0);
                    // 取消联动高亮
                    window.dispatchEvent(new CustomEvent('galaxy-transition-hover', { detail: { from: null, to: null } }));
                    // tooltip
                    const tooltip = document.getElementById('galaxy-tooltip');
                    tooltip!.style.display = 'none';
                })
                .on("click", (event) => {
                    window.dispatchEvent(new CustomEvent('galaxy-flow-selected', { detail: { from, to } }));
                    console.log('flow clicked', from, to);
                });
        });

        // 拖拽行为
        let isDragging = false;
        let dragStartY = 0;
        const drag = d3.drag<SVGRectElement, StageDatum>()
            .on('start', function (event, d) {
                dragStartY = event.y;
                isDragging = false;
                d3.select(this).raise().attr('stroke', '#333').attr('stroke-width', 3);
            })
            .on('drag', (event, d) => {
                if (Math.abs(event.y - dragStartY) > 3) {
                    isDragging = true;
                }
                d3.select(event.sourceEvent.target)
                    .attr('y', event.y - d.size! / 2);
            })
            .on('end', (event, d) => {
                if (isDragging) {
                    // 拖动才重排
                    let closest = this.stageData[0];
                    let minDist = Math.abs(event.y - (closest.y ?? 0));
                    for (const s of this.stageData) {
                        const dist = Math.abs(event.y - (s.y ?? 0));
                        if (dist < minDist) {
                            minDist = dist;
                            closest = s;
                        }
                    }
                    const oldIdx = this.stageData.findIndex(s => s.stage === d.stage);
                    const newIdx = this.stageData.findIndex(s => s.stage === closest.stage);
                    if (oldIdx !== newIdx) {
                        const arr = [...this.stageData];
                        arr.splice(oldIdx, 1);
                        arr.splice(newIdx, 0, d);
                        this.stageData = arr;
                        this.render();
                    } else {
                        this.render();
                    }
                } else {
                    this.selection = { type: 'stage', stage: d.stage };
                    console.log('set selection', d.stage);
                }
                // 关键：短暂延迟后重置 isDragging，保证 pointerup 能正确识别
                setTimeout(() => { isDragging = false; }, 0);
            });

        g.selectAll("rect")
            .data(this.stageData)
            .enter()
            .append("rect")
            .attr("x", (d) => stageMap.get(d.stage)!.x - sizeScale(d.count) / 2)
            .attr("y", (d) => stageMap.get(d.stage)!.y - sizeScale(d.count) / 2)
            .attr("width", (d) => sizeScale(d.count))
            .attr("height", (d) => sizeScale(d.count))
            .attr("fill", (d) => colorMap.get(d.stage) || '#ccc')
            .attr("class", (d) => `stage-rect stage-${d.stage}` + (this.selection && this.selection.type === 'stage' && this.selection.stage === d.stage ? ' selected' : ''))
            .on("mouseover", (event, d) => {
                const stage = d.stage;
                d3.selectAll(".flow-link").attr("opacity", 0.05);
                d3.selectAll(`.link-from-${stage}, .link-to-${stage}`).attr("opacity", 0.9);
                d3.selectAll(`.stage-rect`).attr("stroke-width", 0);
                d3.selectAll(`.stage-${stage}`)
                    .attr("stroke", "#000")
                    .attr("stroke-width", 2);
                // 联动高亮
                window.dispatchEvent(new CustomEvent('galaxy-stage-hover', { detail: { stage } }));
                // tooltip
                const tooltip = document.getElementById('galaxy-tooltip');
                tooltip!.innerHTML = `${LABEL_MAP[stage] ?? stage}<br>Count: ${d.count}`;
                tooltip!.style.display = 'block';
            })
            .on("mousemove", (event) => {
                const tooltip = document.getElementById('galaxy-tooltip');
                tooltip!.style.left = event.clientX + 12 + 'px';
                tooltip!.style.top = event.clientY + 12 + 'px';
            })
            .on("mouseout", () => {
                d3.selectAll(".flow-link").attr("opacity", 0.7);
                d3.selectAll(`.stage-rect`).attr("stroke", "none").attr("stroke-width", 0);
                // 联动高亮取消
                window.dispatchEvent(new CustomEvent('galaxy-stage-hover', { detail: { stage: null } }));
                // tooltip
                const tooltip = document.getElementById('galaxy-tooltip');
                tooltip!.style.display = 'none';
            })
            .on("pointerup", (event, d) => {

                if (isDragging) return;
                this.selection = { type: 'stage', stage: d.stage };
                this.render();
                console.log('set selection', d.stage);
                window.dispatchEvent(new CustomEvent('galaxy-stage-selected', { detail: { stage: d.stage } }));
            })
            .call(drag);

        // --- legend 渲染到底部 div ---
        this.legendDiv.innerHTML = '';
        const itemsPerRow = 2;
        const legendFlex = document.createElement('div');
        legendFlex.style.display = 'flex';
        legendFlex.style.flexWrap = 'wrap';
        legendFlex.style.width = '100%';
        this.stageData.forEach((d, i) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.width = `${100 / itemsPerRow}%`;
            item.style.marginBottom = '4px';

            const colorBox = document.createElement('span');
            colorBox.style.display = 'inline-block';
            colorBox.style.width = '10px';
            colorBox.style.height = '12px';
            colorBox.style.background = this.colorMap.get(d.stage) || '#ccc';
            colorBox.style.marginRight = '8px';

            const label = document.createElement('span');
            label.style.fontSize = '10px';
            label.textContent = LABEL_MAP[d.stage] ?? d.stage;

            item.appendChild(colorBox);
            item.appendChild(label);
            legendFlex.appendChild(item);
        });
        this.legendDiv.appendChild(legendFlex);

        // 保证 colorMap 有所有 stage 的颜色
        const palette = d3.schemeSet3;
        this.stageData.forEach((d, i) => {
            if (!this.colorMap.has(d.stage)) {
                this.colorMap.set(d.stage, palette[i % palette.length]);
            }
        });

        this.transitions = transitions;
        this.stageFreq = stageFreq;

        console.log('breadcrumb selection', this.selection);
    }

    getMostFrequentStageAndFlow() {
        const mostFreqStage = Object.entries(this.stageFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        const mostFreqFlow = Array.from(this.transitions.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        console.log('Most frequent stage:', mostFreqStage);
        console.log('Most frequent flow:', mostFreqFlow);
        return { mostFreqStage, mostFreqFlow };
    }

    setSelection(selection: any) {
        this.selection = selection;
        this.render();
    }
}