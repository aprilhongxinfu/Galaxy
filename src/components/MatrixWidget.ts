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
    globalIndex?: number;
};

// type StageDatum = {
//     stage: string;
// };

export class MatrixWidget extends Widget {
    private data: Notebook[];
    private colorScale: (label: string) => string;
    private sortState: number = 0; // 0: 默认, 1: notebook长度降序, 2: notebook长度升序, 3: similarity排序
    private notebookOrder: number[] = [];
    private sortButton: HTMLButtonElement;
    private similaritySortButton: HTMLButtonElement;
    private filter: any = null;
    private similarityGroups: any[];

    constructor(data: Notebook[], colorScale: (label: string) => string, similarityGroups?: any[]) {
        super();
        this.data = data.map((nb, i) => ({ ...nb, globalIndex: i }));
        this.colorScale = colorScale;
        this.similarityGroups = similarityGroups || [];
        this.id = 'matrix-widget';
        this.title.label = 'Stage Matrix';
        this.title.closable = true;
        this.addClass('matrix-widget');

        // 添加面包屑导航栏
        const nav = document.createElement('div');
        nav.className = 'galaxy-breadcrumbs';
        nav.innerText = 'Overview';
        this.node.appendChild(nav);

        // ====== DROPLISTS FOR FILTERING ======
        // Collect unique assignments and student_ids
        const assignments = Array.from(new Set(this.data.map(nb => (nb as any).assignment).filter(Boolean)));
        const studentIds = Array.from(new Set(this.data.map(nb => (nb as any).student_id).filter(Boolean)));

        // Assignment dropdown
        const assignmentSelect = document.createElement('select');
        assignmentSelect.style.marginRight = '12px';
        assignmentSelect.innerHTML = `<option value="">All Assignments</option>` +
            assignments.map(a => `<option value="${a}">${a}</option>`).join('');

        // Student ID dropdown
        const studentSelect = document.createElement('select');
        studentSelect.innerHTML = `<option value="">All Students</option>` +
            studentIds.map(s => `<option value="${s}">${s}</option>`).join('');

        // Add to DOM
        const filterBar = document.createElement('div');
        filterBar.style.margin = '8px 0';
        filterBar.style.display = 'none'; // 隐藏 droplists
        filterBar.appendChild(assignmentSelect);
        filterBar.appendChild(studentSelect);
        this.node.appendChild(filterBar);

        // Store filter state
        (this as any)._assignmentFilter = '';
        (this as any)._studentFilter = '';

        // Listen for changes
        assignmentSelect.onchange = () => {
            (this as any)._assignmentFilter = assignmentSelect.value;
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };
        studentSelect.onchange = () => {
            (this as any)._studentFilter = studentSelect.value;
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };

        // 排序按钮区域
        const sortBar = document.createElement('div');
        sortBar.style.display = 'flex';
        sortBar.style.justifyContent = 'flex-end';
        sortBar.style.alignItems = 'center';
        sortBar.style.marginBottom = '4px';
        sortBar.style.height = '24px';
        sortBar.style.width = '100%';
        sortBar.style.position = 'relative';

        // 排序按钮
        this.notebookOrder = this.data.map((_, i) => i);
        this.sortButton = document.createElement('button');
        this.sortButton.title = '切换排序';
        this.sortButton.style.background = 'none';
        this.sortButton.style.border = 'none';
        this.sortButton.style.cursor = 'pointer';
        this.sortButton.style.fontSize = '18px';
        this.sortButton.style.marginRight = '8px';
        this.sortButton.innerHTML = this.getSortIcon();
        this.sortButton.onclick = () => {
            if (this.sortState === 3) return; // similarity模式下禁用
            this.sortState = (this.sortState + 1) % 3;
            this.updateNotebookOrder();
            this.sortButton.innerHTML = this.getSortIcon();
            this.similaritySortButton.classList.remove('active');
            this.updateSortButtonState();
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };
        sortBar.appendChild(this.sortButton);

        // similarity排序按钮
        this.similaritySortButton = document.createElement('button');
        this.similaritySortButton.title = 'Similarity group sort';
        this.similaritySortButton.style.background = 'none';
        this.similaritySortButton.style.border = 'none';
        this.similaritySortButton.style.cursor = 'pointer';
        this.similaritySortButton.style.fontSize = '18px';
        this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
        this.similaritySortButton.onclick = () => {
            if (this.sortState === 3) {
                this.sortState = 0;
                this.similaritySortButton.classList.remove('active');
            } else {
                this.sortState = 3;
                this.similaritySortButton.classList.add('active');
            }
            this.updateNotebookOrder();
            this.sortButton.innerHTML = this.getSortIcon();
            this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
            this.updateSortButtonState();
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };
        sortBar.appendChild(this.similaritySortButton);
        this.node.appendChild(sortBar);
        this.updateSortButtonState();

        // 统一内边距
        this.node.style.padding = '16px 16px 12px 16px';
        this.node.style.display = 'flex';
        this.node.style.flexDirection = 'column';
        this.node.style.height = '100%';
    }

    private getSortIcon(): string {
        // SVG icons: 默认、降序、升序
        if (this.sortState === 0) {
            return `<svg width="18" height="18" viewBox="0 0 20 20"><path d="M4 7h12M4 12h12M4 17h12" stroke="#555" stroke-width="2" stroke-linecap="round"/></svg>`;
        } else if (this.sortState === 1) {
            return `<svg width="18" height="18" viewBox="0 0 20 20"><path d="M6 7h8M8 12h4M10 17h0" stroke="#555" stroke-width="2" stroke-linecap="round"/><path d="M15 4v10m0 0l-3-3m3 3l3-3" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        } else if (this.sortState === 2) {
            return `<svg width="18" height="18" viewBox="0 0 20 20"><path d="M6 17h8M8 12h4M10 7h0" stroke="#555" stroke-width="2" stroke-linecap="round"/><path d="M15 14V4m0 0l-3 3m3-3l3 3" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        } else {
            // similarity排序时，依然显示三条横线但灰色
            return `<svg width="18" height="18" viewBox="0 0 20 20"><path d="M4 7h12M4 12h12M4 17h12" stroke="#bbb" stroke-width="2" stroke-linecap="round"/></svg>`;
        }
    }
    private getSimilaritySortIcon(): string {
        // similarity排序icon，左右框+双向箭头，激活绿色，未激活灰色
        if (this.sortState === 3) {
            // 激活（绿色）
            return `<svg width="18" height="18" viewBox="0 0 24 24">
  <rect x="3" y="5" width="7" height="14" rx="2" fill="none" stroke="#4caf50" stroke-width="2"/>
  <rect x="14" y="5" width="7" height="14" rx="2" fill="none" stroke="#4caf50" stroke-width="2" stroke-dasharray="4 2"/>
  <path d="M10 12h4" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/>
  <polygon points="12,10 10,12 12,14" fill="#4caf50"/>
  <polygon points="14,10 16,12 14,14" fill="#4caf50"/>
</svg>`;
        } else {
            // 未激活（灰色）
            return `<svg width="18" height="18" viewBox="0 0 24 24">
  <rect x="3" y="5" width="7" height="14" rx="2" fill="none" stroke="#555" stroke-width="2"/>
  <rect x="14" y="5" width="7" height="14" rx="2" fill="none" stroke="#555" stroke-width="2" stroke-dasharray="4 2"/>
  <path d="M10 12h4" stroke="#555" stroke-width="2" stroke-linecap="round"/>
  <polygon points="12,10 10,12 12,14" fill="#555"/>
  <polygon points="14,10 16,12 14,14" fill="#555"/>
</svg>`;
        }
    }
    private updateNotebookOrder() {
        if (this.sortState === 0) {
            this.notebookOrder = this.data.map((_, i) => i);
        } else if (this.sortState === 1 || this.sortState === 2) {
            // 按 notebook 长度排序
            const arr = this.data.map((nb, i) => ({ i, len: nb.cells.length }));
            arr.sort((a, b) => this.sortState === 1 ? b.len - a.len : a.len - b.len);
            this.notebookOrder = arr.map(d => d.i);
        } else if (this.sortState === 3 && this.similarityGroups && this.similarityGroups.length > 0) {
            // similarity排序 - 按 group_id 排序
            // 先构建 kernelVersionId -> group_id
            const groupMap: Record<string, { group_id: number }> = {};
            this.similarityGroups.forEach((row: any) => {
                groupMap[row.kernelVersionId] = { group_id: +row.group_id };
            });
            // 按 group_id 排序：1, 2, 3, ..., n, 然后 -1 在最后
            const arr = this.data.map((nb, i) => {
                const kernelId = (nb as any).kernelVersionId?.toString();
                const group = groupMap[kernelId] || { group_id: -1 };
                return { i, group_id: group.group_id };
            });
            arr.sort((a, b) => {
                // 将 -1 放在最后
                if (a.group_id === -1 && b.group_id !== -1) return 1;
                if (a.group_id !== -1 && b.group_id === -1) return -1;
                // 其他情况按数值升序排列
                return a.group_id - b.group_id;
            });
            this.notebookOrder = arr.map(d => d.i);
        } else {
            this.notebookOrder = this.data.map((_, i) => i);
        }
        // 排序后派发事件
        const event = new CustomEvent('galaxy-notebook-order-changed', {
            detail: { notebookOrder: this.notebookOrder }
        });
        window.dispatchEvent(event);
    }

    onAfterAttach(): void {
        this.updateNotebookOrder();
        this.drawMatrix();
        window.addEventListener('galaxy-stage-hover', this.handleStageHover);
        window.addEventListener('galaxy-transition-hover', this.handleTransitionHover);
    }

    onBeforeDetach(): void {
        window.removeEventListener('galaxy-stage-hover', this.handleStageHover);
        window.removeEventListener('galaxy-transition-hover', this.handleTransitionHover);
    }

    private handleStageHover = (event: Event) => {
        const stage = (event as CustomEvent).detail.stage;
        console.log(stage);
        d3.selectAll('.matrix-cell')
            .classed('matrix-highlight', false)
            .classed('matrix-dim', !!stage);
        if (stage) {
            d3.selectAll(`.matrix-cell-${stage}`)
                .classed('matrix-highlight', true)
                .classed('matrix-dim', false);
        }
    }

    private handleTransitionHover = (event: Event) => {
        const { from, to } = (event as CustomEvent).detail;
        const root = d3.select(this.node);
        root.selectAll('.matrix-cell')
            .classed('matrix-highlight', false)
            .classed('matrix-dim', !!from && !!to);

        if (from && to) {
            // 遍历所有 notebook
            this.notebookOrder.forEach((row, colIdx) => {
                const nb = this.data[row];
                const sortedCells = nb.cells.sort((a, b) => a.cellId - b.cellId);
                for (let i = 0; i < sortedCells.length - 1; i++) {
                    const a = String(sortedCells[i]["1st-level label"] ?? "None");
                    const b = String(sortedCells[i + 1]["1st-level label"] ?? "None");
                    if (a === from && b === to) {
                        // 向前找连续 from
                        let i0 = i;
                        while (i0 > 0 && String(sortedCells[i0 - 1]["1st-level label"] ?? "None") === from) i0--;
                        // 向后找连续 to
                        let i1 = i + 1;
                        while (i1 + 1 < sortedCells.length && String(sortedCells[i1 + 1]["1st-level label"] ?? "None") === to) i1++;
                        // 高亮 from 段
                        for (let j = i0; j <= i; j++) {
                            root.select(`.matrix-cell[data-row="${row}"][data-index="${j}"]`)
                                .classed('matrix-highlight', true)
                                .classed('matrix-dim', false);
                        }
                        // 高亮 to 段
                        for (let j = i + 1; j <= i1; j++) {
                            root.select(`.matrix-cell[data-row="${row}"][data-index="${j}"]`)
                                .classed('matrix-highlight', true)
                                .classed('matrix-dim', false);
                        }
                    }
                }
            });
        }
    }

    private drawMatrix(): void {
        const notebooks = this.data;
        const color = this.colorScale;
        let notebookOrder = this.notebookOrder.length ? this.notebookOrder : notebooks.map((_, i) => i);
        // 过滤 notebook
        if (this.filter) {
            if (this.filter.type === 'stage') {
                notebookOrder = notebookOrder.filter(idx =>
                    notebooks[idx].cells.some(cell => String(cell["1st-level label"] ?? "None") === this.filter.stage)
                );
            } else if (this.filter.type === 'flow') {
                notebookOrder = notebookOrder.filter(idx => {
                    const cells = notebooks[idx].cells;
                    for (let i = 0; i < cells.length - 1; i++) {
                        const a = String(cells[i]["1st-level label"] ?? "None");
                        const b = String(cells[i + 1]["1st-level label"] ?? "None");
                        if (a === this.filter.from && b === this.filter.to) return true;
                    }
                    return false;
                });
            }
        }
        // ====== FILTER BY DROPLISTS ======
        const assignmentFilter = (this as any)._assignmentFilter || '';
        const studentFilter = (this as any)._studentFilter || '';
        notebookOrder = notebookOrder.filter(idx => {
            const nb = notebooks[idx] as any;
            const matchAssignment = !assignmentFilter || nb.assignment === assignmentFilter;
            const matchStudent = !studentFilter || nb.student_id === studentFilter;
            return matchAssignment && matchStudent;
        });

        const cellHeight = 5;
        const cellWidth = 20;
        const rowPadding = 1;
        const svgWidth = Math.max(1000, notebookOrder.length * (cellWidth + rowPadding) + 100);
        // 计算内容高度
        const contentHeight = notebookOrder.length * (cellHeight + rowPadding) + 100;
        // 获取容器高度（如为0可用默认值）
        const minHeight = this.node.clientHeight || 400;
        const svgHeight = Math.max(contentHeight, minHeight);

        // 先移除已有 matrix 容器，避免重复
        const old = this.node.querySelector('.matrix-container');
        if (old) old.remove();

        const container = document.createElement('div');
        container.className = 'matrix-container';
        container.style.flex = '1 1 auto';
        container.style.overflow = 'auto';
        container.style.height = 'auto';
        container.style.padding = '8px 8px 4px 8px';
        this.node.appendChild(container);

        const svg = d3
            .select(container)
            .append('svg')
            .attr('width', svgWidth)
            .attr('height', svgHeight)
            .attr('id', 'matrix');

        const g = svg.append('g').attr('transform', 'translate(20, 24)');

        const self = this;
        notebookOrder.forEach((row, colIdx) => {
            const nb = notebooks[row];
            const sortedCells = nb.cells.sort((a, b) => a.cellId - b.cellId);

            let prevStage: string | null = null;
            sortedCells.forEach((cell, i) => {
                const currStage = String(cell["1st-level label"] ?? "None");
                const currClass = currStage;

                let transitionClass = "";
                if (prevStage) {
                    transitionClass = `pair-from-${prevStage}-to-${currClass}`;
                }

                const base = g
                    .append('rect')
                    .datum({ ...cell, kernelVersionId: (nb as any).kernelVersionId, notebook_name: (nb as any).notebook_name })
                    .attr('x', colIdx * (cellWidth + rowPadding) + 1)
                    .attr('y', i * cellHeight + 1)
                    .attr('width', cellWidth - 2)
                    .attr('height', cellHeight - 2)
                    .attr('fill', cell.cellType === 'code' ? color(currStage) : 'white')
                    .attr('stroke', cell.cellType === 'code' ? color(currStage) : '#bbb')
                    .attr('stroke-width', 1)
                    .attr('data-row', row.toString())
                    .attr('data-index', i.toString())
                    .attr('data-stage', currClass)
                    .attr('class', `matrix-cell matrix-cell-${currClass} ${transitionClass}`)
                    .on('mouseover', function (event, d) {
                        d3.select(this)
                            .classed('matrix-highlight', true)
                            .classed('matrix-dim', false)
                            .attr('stroke', color(String(d["1st-level label"] ?? '#bbb')))
                            .attr('filter', 'drop-shadow(0px 0px 6px rgba(0,0,0,0.18))');
                        let tooltip = document.getElementById('galaxy-tooltip');
                        if (!tooltip) {
                            tooltip = document.createElement('div');
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
                        tooltip.innerHTML = `Stage: ${typeof LABEL_MAP !== 'undefined' ? (LABEL_MAP[String(d["1st-level label"] ?? "None")] ?? d["1st-level label"] ?? "None") : (d["1st-level label"] ?? "None")}` +
                            `<br>Notebook: ${(d as any).notebook_name ?? (d as any).kernelVersionId}` +
                            `<br>cellId: ${d.cellId}` +
                            `<br>cellType: ${d.cellType}`;
                        // 新增：如果有 similarityGroups，显示 group_id, similarity, label_integers
                        if (self.similarityGroups && self.similarityGroups.length > 0) {
                            const kernelId = (d as any).kernelVersionId?.toString();
                            const simRow = self.similarityGroups.find((row: any) => row.kernelVersionId === kernelId);
                            if (simRow) {
                                tooltip.innerHTML += `<br>group_id: ${simRow.group_id}`;
                                tooltip.innerHTML += `<br>similarity: ${simRow.similarity}`;
                                tooltip.innerHTML += `<br>label_integers: ${simRow.label_integers}`;
                            }
                        }
                        tooltip.style.display = 'block';
                    })
                    .on('mousemove', function (event) {
                        const tooltip = document.getElementById('galaxy-tooltip');
                        tooltip!.style.left = event.clientX + 12 + 'px';
                        tooltip!.style.top = event.clientY + 12 + 'px';
                    })
                    .on('mouseout', function () {
                        d3.select(this).classed('matrix-highlight', false)
                            .attr('filter', null);
                        const datum = d3.select(this).datum() as Cell;
                        if (datum.cellType !== 'code') {
                            d3.select(this).attr('stroke', '#bbb');
                        } else {
                            d3.select(this).attr('stroke', color(String(datum["1st-level label"] ?? "None")));
                        }
                        const tooltip = document.getElementById('galaxy-tooltip');
                        tooltip!.style.display = 'none';
                    })
                    .on('click', function (event, d) {
                        // 派发 notebook 跳转和 cell 详情事件
                        // 先隐藏 tooltip
                        const tooltip = document.getElementById('galaxy-tooltip');
                        if (tooltip) tooltip.style.display = 'none';
                        const notebookObj = { ...nb, index: nb.globalIndex };
                        window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', {
                            detail: { notebook: notebookObj }
                        }));
                        setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
                                detail: {
                                    notebookIndex: nb.globalIndex,
                                    cellIndex: i
                                }
                            }));
                            window.dispatchEvent(new CustomEvent('galaxy-cell-detail', {
                                detail: {
                                    cell: { ...d, notebookIndex: nb.globalIndex, cellIndex: i, _notebookDetail: notebookObj }
                                }
                            }));
                        }, 0);
                    });

                if (prevStage) {
                    d3.select(base.node()?.previousSibling as SVGRectElement).classed(transitionClass, true);
                }
                prevStage = currStage;
            });
        });

        // 添加列编号
        const headerG = g.append('g').attr('class', 'matrix-header');
        for (let col = 0; col < notebookOrder.length; col++) {
            headerG.append('text')
                .attr('x', col * (cellWidth + rowPadding) + cellWidth / 2)
                .attr('y', -10)
                .attr('text-anchor', 'middle')
                .attr('font-size', '11px')
                .attr('fill', '#555')
                .style('cursor', 'pointer')
                .text((notebooks[notebookOrder[col]]?.globalIndex ?? 0) + 1)
                .on('click', () => {
                    const nb = notebooks[notebookOrder[col]];
                    window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', { detail: { notebook: { ...nb, index: nb?.globalIndex ?? 0 } } }));
                });
        }
    }

    getNotebookOrder(): number[] {
        return this.notebookOrder;
    }

    setFilter(selection: any) {
        this.filter = selection;
        this.drawMatrix();
    }

    // 新增：获取当前筛选后的notebook列表
    private getFilteredNotebooks(): any[] {
        const assignmentFilter = (this as any)._assignmentFilter || '';
        const studentFilter = (this as any)._studentFilter || '';
        return this.data.filter(nb => {
            const matchAssignment = !assignmentFilter || (nb as any).assignment === assignmentFilter;
            const matchStudent = !studentFilter || (nb as any).student_id === studentFilter;
            return matchAssignment && matchStudent;
        });
    }

    // 新增：根据当前排序状态更新按钮样式和可用性
    private updateSortButtonState() {
        if (this.sortState === 3) {
            this.sortButton.style.opacity = '0.4';
            this.sortButton.style.cursor = 'not-allowed';
            this.sortButton.disabled = true;
        } else {
            this.sortButton.style.opacity = '1';
            this.sortButton.style.cursor = 'pointer';
            this.sortButton.disabled = false;
        }
    }
}