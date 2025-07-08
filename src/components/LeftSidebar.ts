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
    private _resizeObserver: ResizeObserver | null = null;
    private _resizeInterval: any = null;

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
        chartContainer.style.flex = '1 1 auto';
        chartContainer.style.overflow = 'hidden';  // 不滚动
        chartContainer.style.display = 'flex';
        chartContainer.style.flexDirection = 'column';
        this.node.appendChild(chartContainer);

        // 底部 legend
        this.legendDiv = document.createElement('div');
        this.legendDiv.className = 'galaxy-legend';
        this.legendDiv.style.display = 'block';
        this.legendDiv.style.overflow = 'visible';
        this.legendDiv.style.flex = 'none';
        this.legendDiv.style.margin = '0';
        this.legendDiv.style.padding = '0';
        this.legendDiv.style.height = '100px';
        this.node.appendChild(this.legendDiv);

        // SVG 渲染到中间
        const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgElement.setAttribute('viewBox', '0 0 400 600');
        svgElement.setAttribute('preserveAspectRatio', 'xMidYMin meet');
        svgElement.style.width = '100%';
        svgElement.style.overflow = 'visible';
        svgElement.style.flex = '1 1 auto';
        svgElement.style.height = '85%';  // 关键：撑满 chartContainer
        svgElement.style.marginBottom = '0';  // 去掉底部冗余间距
        svgElement.style.maxHeight = '85%';
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
        // const svgNode = this.svg.node()!;
        const chartPadding = 30;  // 保证底部 legend 有空间

        // 根据 stageData 中最后一个 stage 的 y 值和 block size 估算需要的逻辑高度
        const lastStage = this.stageData[this.stageData.length - 1];
        const lastY = (lastStage?.norm_pos ?? 1) * 1.0;  // 如果没有 norm_pos 则用 1
        const estimatedVirtualHeight = d3.scaleLinear().domain([0, 1]).range([10, 800])(lastY) + 80;
        
        // 最终逻辑高度
        const virtualHeight = Math.max(estimatedVirtualHeight, 1000); // 设置下限，防止过小
        
        // 设置 viewBox
        this.svg.attr("viewBox", `0 0 400 ${virtualHeight + chartPadding}`);



        // 保证 stageData 里的 stage 都是 string
        this.stageData.forEach(d => {
            d.stage = String(d.stage);
        });
        // 调试输出
        // const stageList = this.stageData.map(d => d.stage);
        // const colorMapKeys = Array.from(this.colorMap.keys());
        // console.log('LeftSidebar stageData:', stageList);
        // console.log('LeftSidebar colorMap keys:', colorMapKeys);
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

        // const yScale = d3.scaleLinear().domain([0, 1]).range([10, 850]);
        const yScale = d3.scaleLinear().domain([0, 1]).range([10, virtualHeight]);
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

        // const strokeScale = (count: number) => {
        //     if (maxFlowCount === minFlowCount) return (minWidth + maxWidth) / 2;
        //     // 幂次缩放，主干线更粗
        //     const t = (count - minFlowCount) / (maxFlowCount - minFlowCount);
        //     return minWidth + Math.pow(t, 0.4) * (maxWidth - minWidth);
        // };
        const strokeScale = (count: number) => {
            if (count <= 0) return 0;
            if (maxFlowCount <= 5) {
                // 离散情况直接写死
                return [0, 2, 4][count] || 5;
            }
            // const logCount = Math.log1p(count);
            // const maxLog = Math.log1p(maxFlowCount);
            // const norm = logCount / maxLog;
            const t = (count - minFlowCount) / (maxFlowCount - minFlowCount);
            return minWidth + Math.pow(t, 0.4) * (maxWidth - minWidth);
        };

        const svg = this.svg;
        const defs = svg.append("defs");
        const g = svg.append("g").attr("transform", "translate(200, 20)");
        // const legendG = svg.append("g").attr("transform", "translate(0, 740)");

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

        // 统一收集所有实际渲染的 flow，并计算线宽比例尺
        const renderedFlows: { from: string, to: string, count: number }[] = [];
        transitions.forEach((count, key) => {
            const [from, to] = key.split("->");
            if (from === 'None' || to === 'None' || from === to) return;
            const fromPos = stageMap.get(from);
            const toPos = stageMap.get(to);
            if (!fromPos || !toPos) return;
            renderedFlows.push({ from, to, count });
        });
        const renderedFlowCounts = renderedFlows.map(f => f.count);

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
            const offset = Math.min(dy * 0.5, 300);
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
        const itemsPerCol = Math.ceil(this.stageData.length / 2);
        const leftCol = this.stageData.slice(0, itemsPerCol);
        const rightCol = this.stageData.slice(itemsPerCol);
        const legendFlex = document.createElement('div');
        legendFlex.style.display = 'flex';
        legendFlex.style.flexDirection = 'row';
        legendFlex.style.width = '100%';

        const makeCol = (colData: typeof this.stageData) => {
            const col = document.createElement('div');
            col.style.display = 'flex';
            col.style.flexDirection = 'column';
            col.style.flex = '1';
            colData.forEach((d) => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.alignItems = 'center';
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
                col.appendChild(item);
            });
            return col;
        };
        legendFlex.appendChild(makeCol(leftCol));
        legendFlex.appendChild(makeCol(rightCol));
        this.legendDiv.appendChild(legendFlex);
        this.legendDiv.style.border = '';

        // 添加flow宽度scale说明和legend（SVG）
        // legend 采样直接用 renderedFlowCounts（和 flowchart 渲染用的是同一个数组）
        if (renderedFlowCounts.length > 0) {
            const min = Math.min(...renderedFlowCounts);
            const max = Math.max(...renderedFlowCounts);
            // 只采样三条线：min, (min+max)/2, max
            const samples = [min, Math.round((min + max) / 2), max];
            const uniqSamples = Array.from(new Set(samples));
            const svgW = 220;
            // const svgH = 90;
            const barY = 40;
            // const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            // svg.setAttribute('width', svgW.toString());
            // svg.setAttribute('height', svgH.toString());
            // svg.style.display = 'block';
            // svg.style.border = '';
            // svg.style.margin = '0 0 0 0';

            // const legendG = svg.append("g").attr("transform", "translate(0, 850)");
            // 计算底部 legend 的起始 y 位置（加上一些 padding）
            const bottomY = Math.max(...this.stageData.map(d => d.y! + d.size!)) + 30;

            // width legend
            const legendG = svg.append("g").attr("transform", `translate(0, ${bottomY})`);

            // size legend
            const sizeLegendG = svg.append("g").attr("transform", `translate(260, ${bottomY})`);
            uniqSamples.forEach((count, i) => {
                const x = 28 + i * ((svgW - 56) / (uniqSamples.length - 1));
                const w = strokeScale(count);
                // console.log('legend sample', count, 'width', w);

                // 创建竖直的 flow 线条：固定 from 和 to 的 x 位置，改变宽度
                const fromX = x;         // from x 位置（固定）
                const toX = x;           // to x 位置（固定，与 from 相同）
                const fromY = barY - 10;  // from y 位置
                const toY = barY + 55;   // to y 位置

                // 绘制竖直的 flow 线条
                // const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // const side = toY > fromY ? 1 : -1;
                // const dy = Math.abs(toY - fromY);
                // const offset = Math.min(dy * 0.5, 15);
                // const ctrlX1 = fromX + side * offset;
                // const ctrlX2 = toX + side * offset;

                // legendG.append("path")
                //     .attr("d", `M${fromX},${fromY} C${ctrlX1},${fromY} ${ctrlX2},${toY} ${toX},${toY}`)
                //     .attr("stroke", "#666")
                //     .attr("stroke-width", w)
                //     .attr("fill", "none")
                //     .attr("opacity", 0.8);

                legendG.append("line")
                    .attr("x1", fromX)
                    .attr("y1", fromY)
                    .attr("x2", toX)
                    .attr("y2", toY)
                    .attr("stroke", "#666")
                    .attr("stroke-width", w)
                    .attr("opacity", 0.8);

                legendG.append("text")
                    .attr("x", x)
                    .attr("y", toY + 20)
                    .attr("text-anchor", "middle")
                    .attr("font-size", 20)
                    .attr("fill", "#666")
                    .text(count.toLocaleString());
            });

            // === 添加 stage rect size 的 legend（同心矩形） ===
            // const sizeLegendG = svg.append("g").attr("transform", "translate(260, 850)");
            const stageCounts = this.stageData.map(d => d.count);
            const minCount = Math.min(...stageCounts);
            const maxCount = Math.max(...stageCounts);
            const sizeSamples = [minCount, Math.round((minCount + maxCount) / 2), maxCount];
            const cx = 30;  // 同心矩形中心点 x
            const cy = 60;  // 同心矩形中心点 y

            // 绘制同心矩形（由大到小）
            sizeSamples.sort((a, b) => b - a).forEach((count, i) => {
                const size = sizeScale(count);
                const r = size / 2;

                // 绘制矩形
                sizeLegendG.append("rect")
                    .attr("x", cx - r)
                    .attr("y", cy - r)
                    .attr("width", size)
                    .attr("height", size)
                    .attr("fill", "none")
                    .attr("stroke", "#444")
                    .attr("stroke-width", 1)
                    .attr("opacity", 0.9);

                const isMiddle = i === 1; // 中间那个
                const needsLeaderLine = isMiddle && count >= 0;

                if (needsLeaderLine) {
                    // 从中间矩形右上角斜出去
                    const fromX = cx + r;
                    const fromY = cy - r;
                    const dx = 16, dy = -12;
                    const toX = fromX + dx;
                    const toY = fromY + dy;

                    // 斜线
                    sizeLegendG.append("line")
                        .attr("x1", fromX)
                        .attr("y1", fromY)
                        .attr("x2", toX)
                        .attr("y2", toY)
                        .attr("stroke", "#444")
                        .attr("stroke-width", 1);

                    // 水平文字
                    sizeLegendG.append("text")
                        .attr("x", toX + 4)
                        .attr("y", toY + 4)
                        .attr("font-size", 20)
                        .attr("fill", "#444")
                        .text(count.toLocaleString());
                } else {
                    // 正常右边标注
                    sizeLegendG.append("text")
                        .attr("x", cx + r + 1)
                        .attr("y", cy + 4)
                        .attr("font-size", 20)
                        .attr("fill", "#444")
                        .text(count.toLocaleString());
                }
            });

            // 添加标题文字
            // sizeLegendG.append("text")
            //     .attr("x", cx - 8)
            //     .attr("y", cy - Math.max(...sizeSamples.map(c => sizeScale(c))) / 2 - 12)
            //     .attr("text-anchor", "start")
            //     .attr("font-size", 12)
            //     .attr("fill", "#222")
            //     .text("Stage count");
        }

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
        // 过滤掉 None/None、from==to、from或to为None
        const validFlows = Array.from(this.transitions.entries()).filter(([key, count]) => {
            const [from, to] = key.split('->');
            return from !== 'None' && to !== 'None' && from !== to;
        });
        const mostFreqFlow = validFlows.sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        return { mostFreqStage, mostFreqFlow };
    }

    setSelection(selection: any) {
        this.selection = selection;
        this.render();
    }

    dispose(): void {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._resizeInterval) {
            clearInterval(this._resizeInterval);
            this._resizeInterval = null;
        }
        super.dispose();
    }

    onAfterAttach(msg: any): void {
        // 先断开旧的 observer 和定时器
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._resizeInterval) {
            clearInterval(this._resizeInterval);
            this._resizeInterval = null;
        }
        const svgElement = this.svg?.node();
        if (svgElement) {
            const sidebarElem = this._findSidebarContainer(this.node);
            let lastWidth = sidebarElem.offsetWidth;
            const setSvgMarginBottom = () => {
                const sidebarWidth = sidebarElem.offsetWidth;
                if (sidebarWidth !== lastWidth) {
                    svgElement.style.marginBottom = Math.round(sidebarWidth) + 'px';
                    lastWidth = sidebarWidth;
                }
            };
            setSvgMarginBottom();
            this._resizeObserver = new ResizeObserver(setSvgMarginBottom);
            this._resizeObserver.observe(sidebarElem);
            // 兜底：定时检查
            this._resizeInterval = setInterval(setSvgMarginBottom, 300);
        }
        super.onAfterAttach?.(msg);
    }

    // 工具函数：向上查找带有特定 class 的父元素
    private _findSidebarContainer(node: HTMLElement): HTMLElement {
        let el: HTMLElement | null = node;
        while (el) {
            if (
                el.classList.contains('jp-SidePanel') ||
                el.classList.contains('p-SidePanel') ||
                el.classList.contains('jp-LeftArea') ||
                el.classList.contains('jp-RightArea')
            ) {
                return el;
            }
            el = el.parentElement;
        }
        // fallback
        return node.parentElement || node;
    }
}