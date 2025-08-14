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



export class MatrixWidget extends Widget {
    private data: Notebook[];
    private colorScale: (label: string) => string;
    private sortState: number = 0; // 0: 默认, 1: notebook长度降序, 2: notebook长度升序, 3: similarity排序
    private voteEnabled: boolean = false; // 独立的投票排序状态
    private notebookOrder: number[] = [];
    private sortButton: HTMLButtonElement;
    private similaritySortButton: HTMLButtonElement;
    private voteSortButton!: HTMLButtonElement; // 投票排序按钮
    private cellHeightButton: HTMLButtonElement; // cell高度模式按钮
    private markdownButton: HTMLButtonElement; // markdown显示/隐藏按钮
    private filter: any = null;
    private similarityGroups: any[];
    private voteData: any[] = []; // 投票数据
    private cellHeightMode: 'fixed' | 'dynamic' = 'fixed'; // cell高度模式：固定、动态
    private showMarkdown: boolean = true; // markdown显示状态
    private kernelTitleMap: Map<string, { title: string; creationDate: string; totalLines: number; displayname?: string }> = new Map(); // 存储kernelVersionId到Title的映射

    constructor(data: Notebook[], colorScale: (label: string) => string, similarityGroups?: any[], kernelTitleMap?: Map<string, { title: string; creationDate: string; totalLines: number; displayname?: string }>, voteData?: any[]) {
        super();
        this.data = data.map((nb, i) => ({ ...nb, globalIndex: i + 1 }));
        this.colorScale = colorScale;
        this.similarityGroups = similarityGroups || [];
        this.voteData = voteData || [];
        this.kernelTitleMap = kernelTitleMap || new Map();



        // 初始化时重置状态，确保每次创建都是全新的状态
        this.resetState();
        this.id = 'matrix-widget';
        this.title.label = 'Overview';
        this.title.closable = true;
        this.addClass('matrix-widget');

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
            this.saveFilterState();
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };
        studentSelect.onchange = () => {
            (this as any)._studentFilter = studentSelect.value;
            this.saveFilterState();
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
        sortBar.style.gap = '8px'; // 统一按钮间距

        // 排序按钮
        this.notebookOrder = this.data.map((_, i) => i);
        this.sortButton = document.createElement('button');
        this.sortButton.style.background = 'none';
        this.sortButton.style.border = 'none';
        this.sortButton.style.cursor = 'pointer';
        this.sortButton.style.fontSize = '18px';
        this.sortButton.style.display = 'flex';
        this.sortButton.style.alignItems = 'center';
        this.sortButton.style.justifyContent = 'center';
        this.sortButton.innerHTML = this.getSortIcon();
        this.addTooltipToButton(this.sortButton, () => this.getSortButtonTooltip());
        this.sortButton.onclick = () => {
            // 保存当前的filter状态
            const currentFilter = this.filter;

            this.sortState = (this.sortState + 1) % 3;
            this.updateNotebookOrder();
            this.sortButton.innerHTML = this.getSortIcon();
            this.updateSortButtonState();

            // 恢复filter状态（在updateNotebookOrder之后）
            this.filter = currentFilter;

            this.saveFilterState();
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };
        sortBar.appendChild(this.sortButton);

        // similarity排序按钮
        this.similaritySortButton = document.createElement('button');
        this.similaritySortButton.style.background = 'none';
        this.similaritySortButton.style.border = 'none';
        this.similaritySortButton.style.cursor = 'pointer';
        this.similaritySortButton.style.fontSize = '18px';
        this.similaritySortButton.style.display = 'flex';
        this.similaritySortButton.style.alignItems = 'center';
        this.similaritySortButton.style.justifyContent = 'center';
        this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
        this.addTooltipToButton(this.similaritySortButton, () => 'Toggle clustering');
        this.similaritySortButton.onclick = () => {
            // 保存当前的filter状态
            const currentFilter = this.filter;

            if (this.sortState === 3) {
                this.sortState = 0;
                this.similaritySortButton.classList.remove('active');
            } else {
                this.sortState = 3;
                this.similaritySortButton.classList.add('active');
            }
            this.updateNotebookOrder();
            this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
            this.updateSortButtonState();

            // 恢复filter状态（在updateNotebookOrder之后）
            this.filter = currentFilter;

            this.saveFilterState();
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };
        sortBar.appendChild(this.similaritySortButton);

        // 投票排序按钮
        this.voteSortButton = document.createElement('button');
        this.voteSortButton.style.background = 'none';
        this.voteSortButton.style.border = 'none';
        this.voteSortButton.style.cursor = 'pointer';
        this.voteSortButton.style.fontSize = '18px';
        this.voteSortButton.style.display = 'flex';
        this.voteSortButton.style.alignItems = 'center';
        this.voteSortButton.style.justifyContent = 'center';
        this.voteSortButton.innerHTML = this.getVoteSortIcon();
        this.addTooltipToButton(this.voteSortButton, () => this.voteEnabled ? 'Sorted by votes (highest to lowest)' : 'Sort by votes');
        this.voteSortButton.onclick = () => {
            // 保存当前的filter状态
            const currentFilter = this.filter;

            this.voteEnabled = !this.voteEnabled;
            if (this.voteEnabled) {
                this.voteSortButton.classList.add('active');
            } else {
                this.voteSortButton.classList.remove('active');
            }
            this.updateNotebookOrder();
            this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
            this.voteSortButton.innerHTML = this.getVoteSortIcon();
            this.updateSortButtonState();

            // 恢复filter状态（在updateNotebookOrder之后）
            this.filter = currentFilter;

            this.saveFilterState();
            this.drawMatrix();
            const filteredNotebooks = this.getFilteredNotebooks();
            window.dispatchEvent(new CustomEvent('galaxy-matrix-filtered', { detail: { notebooks: filteredNotebooks } }));
        };
        sortBar.appendChild(this.voteSortButton);

        // cell高度模式按钮
        this.cellHeightButton = document.createElement('button');
        this.cellHeightButton.style.background = 'none';
        this.cellHeightButton.style.border = 'none';
        this.cellHeightButton.style.cursor = 'pointer';
        this.cellHeightButton.style.fontSize = '18px';
        this.cellHeightButton.style.display = 'flex';
        this.cellHeightButton.style.alignItems = 'center';
        this.cellHeightButton.style.justifyContent = 'center';
        this.cellHeightButton.innerHTML = this.getCellHeightIcon();
        this.addTooltipToButton(this.cellHeightButton, () => this.cellHeightMode === 'fixed' ? 'Fixed cell height mode' : 'Cell height by line count');
        this.cellHeightButton.onclick = () => {
            // 在两种模式之间切换：fixed -> dynamic -> fixed
            if (this.cellHeightMode === 'fixed') {
                this.cellHeightMode = 'dynamic';
            } else {
                this.cellHeightMode = 'fixed';
            }
            this.cellHeightButton.innerHTML = this.getCellHeightIcon();
            this.updateSortButtonState();
            this.saveFilterState();
            this.drawMatrix();
        };
        sortBar.appendChild(this.cellHeightButton);

        // markdown显示/隐藏按钮
        this.markdownButton = document.createElement('button');
        this.markdownButton.style.background = 'none';
        this.markdownButton.style.border = 'none';
        this.markdownButton.style.cursor = 'pointer';
        this.markdownButton.style.fontSize = '18px';
        this.markdownButton.style.display = 'flex';
        this.markdownButton.style.alignItems = 'center';
        this.markdownButton.style.justifyContent = 'center';
        this.markdownButton.innerHTML = this.getMarkdownIcon();
        this.addTooltipToButton(this.markdownButton, () => 'Toggle markdown visibility');
        this.markdownButton.onclick = () => {
            this.showMarkdown = !this.showMarkdown;
            this.markdownButton.innerHTML = this.getMarkdownIcon();
            this.updateSortButtonState();
            this.saveFilterState();
            this.drawMatrix();
        };
        sortBar.appendChild(this.markdownButton);

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

    private getVoteSortIcon(): string {
        // 投票排序icon，使用星星图标，激活绿色，未激活灰色
        if (this.voteEnabled) {
            // 激活（绿色）
            return `<svg width="18" height="18" viewBox="0 0 24 24">
  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#4caf50"/>
</svg>`;
        } else {
            // 未激活（灰色）
            return `<svg width="18" height="18" viewBox="0 0 24 24">
  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#555"/>
</svg>`;
        }
    }

    private getCellHeightIcon(): string {
        // cell高度模式icon：固定高度（等号）、动态高度（波浪线）
        if (this.cellHeightMode === 'fixed') {
            // 固定高度模式：等号图标
            return `<svg width="18" height="18" viewBox="0 0 20 20">
  <path d="M4 8h12M4 12h12" stroke="#555" stroke-width="2" stroke-linecap="round"/>
</svg>`;
        } else {
            // 动态高度模式：波浪线图标
            return `<svg width="18" height="18" viewBox="0 0 20 20">
  <path d="M3 8c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0 2-1 3 0 2 1 3 0 2-1 3 0" stroke="#4caf50" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M3 12c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0 2-1 3 0 2 1 3 0 2-1 3 0" stroke="#4caf50" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>`;
        }
    }

    private getMarkdownIcon(): string {
        // markdown显示/隐藏icon：使用"Md"文本，显示时绿色，隐藏时灰色
        if (this.showMarkdown) {
            // 显示markdown：绿色"Md"文本
            return `<span style="color: #4caf50; font-weight: 600; font-size: 12px; line-height: 1; display: inline-block; vertical-align: middle;">Md</span>`;
        } else {
            // 隐藏markdown：灰色"Md"文本
            return `<span style="color: #555; font-weight: 600; font-size: 12px; line-height: 1; display: inline-block; vertical-align: middle;">Md</span>`;
        }
    }

    private getSortButtonTooltip(): string {
        if (this.sortState === 3 || this.voteEnabled) {
            if (this.sortState === 3) {
                return 'Sorting disabled (clustering mode active)';
            } else {
                return 'Sorting disabled (vote mode active)';
            }
        } else {
            if (this.sortState === 0) {
                return 'Default order (no sorting)';
            } else if (this.sortState === 1) {
                return 'Sorted by notebook length (descending)';
            } else {
                return 'Sorted by notebook length (ascending)';
            }
        }
    }

    // 通用的tooltip处理函数
    private addTooltipToButton(button: HTMLButtonElement, getTooltipText: () => string): void {
        button.onmouseenter = (e) => {
            const tooltip = document.getElementById('galaxy-tooltip');
            if (tooltip) {
                tooltip.innerHTML = getTooltipText();
                tooltip.style.display = 'block';
                tooltip.style.left = e.clientX + 12 + 'px';
                tooltip.style.top = e.clientY + 12 + 'px';
            }
        };
        button.onmousemove = (e) => {
            const tooltip = document.getElementById('galaxy-tooltip');
            if (tooltip && tooltip.style.display === 'block') {
                tooltip.style.left = e.clientX + 12 + 'px';
                tooltip.style.top = e.clientY + 12 + 'px';
            }
        };
        button.onmouseleave = () => {
            const tooltip = document.getElementById('galaxy-tooltip');
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        };
    }

    private updateNotebookOrder() {
        // 创建vote map（如果需要的话）
        const voteMap = new Map();
        if (this.voteEnabled && this.voteData && this.voteData.length > 0) {
            this.voteData.forEach((row: any) => {
                if (row.kernelVersionId && row.TotalVotes !== undefined) {
                    voteMap.set(row.kernelVersionId.toString(), parseFloat(row.TotalVotes) || 0);
                }
            });
        }

        if (this.voteEnabled && this.sortState !== 3) {
            // vote激活且similarity未激活：全局按vote排序
            const arr = this.data.map((nb, i) => ({
                i,
                votes: voteMap.get((nb as any).kernelVersionId?.toString()) || 0
            }));
            arr.sort((a, b) => b.votes - a.votes);
            this.notebookOrder = arr.map(d => d.i);
        } else if (this.sortState === 0) {
            this.notebookOrder = this.data.map((_, i) => i);
        } else if (this.sortState === 1 || this.sortState === 2) {
            // 按 notebook 长度排序
            const arr = this.data.map((nb, i) => ({ i, len: nb.cells.length }));
            arr.sort((a, b) => this.sortState === 1 ? b.len - a.len : a.len - b.len);
            this.notebookOrder = arr.map(d => d.i);
        } else if (this.sortState === 3 && this.similarityGroups && this.similarityGroups.length > 0) {
            // similarity模式
            const groupMap: Record<string, number[]> = {};
            const ungroupedNotebooks: number[] = [];
            const clusterOrder: string[] = [];

            // 建立cluster分组
            this.similarityGroups.forEach((simRow: any) => {
                if (simRow.cluster_id && !clusterOrder.includes(simRow.cluster_id)) {
                    clusterOrder.push(simRow.cluster_id);
                    groupMap[simRow.cluster_id] = [];
                }
            });

            // 将notebook分配到clusters
            this.similarityGroups.forEach((simRow: any) => {
                if (simRow.cluster_id && simRow.kernelVersionId) {
                    const notebookIndex = this.data.findIndex((nb, i) => {
                        const kernelId = (nb as any).kernelVersionId?.toString();
                        return kernelId === simRow.kernelVersionId.toString();
                    });

                    if (notebookIndex !== -1 && groupMap[simRow.cluster_id]) {
                        if (!groupMap[simRow.cluster_id].includes(notebookIndex)) {
                            groupMap[simRow.cluster_id].push(notebookIndex);
                        }
                    }
                }
            });

            // 添加未分组的notebook
            this.data.forEach((nb, i) => {
                const kernelId = (nb as any).kernelVersionId?.toString();
                const simRow = this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId);

                if (!simRow || !simRow.cluster_id) {
                    ungroupedNotebooks.push(i);
                } else {
                    const isInGroup = Object.values(groupMap).some(group => group.includes(i));
                    if (!isInGroup) {
                        ungroupedNotebooks.push(i);
                    }
                }
            });

            this.notebookOrder = [];

            if (this.voteEnabled) {
                // 如果vote激活，在每个group内部按vote排序
                clusterOrder.forEach(groupId => {
                    const groupNotebooks = groupMap[groupId];
                    const sortedGroup = groupNotebooks.sort((a, b) => {
                        const voteA = voteMap.get((this.data[a] as any).kernelVersionId?.toString()) || 0;
                        const voteB = voteMap.get((this.data[b] as any).kernelVersionId?.toString()) || 0;
                        return voteB - voteA;
                    });
                    this.notebookOrder.push(...sortedGroup);
                });

                const sortedUngrouped = ungroupedNotebooks.sort((a, b) => {
                    const voteA = voteMap.get((this.data[a] as any).kernelVersionId?.toString()) || 0;
                    const voteB = voteMap.get((this.data[b] as any).kernelVersionId?.toString()) || 0;
                    return voteB - voteA;
                });
                this.notebookOrder.push(...sortedUngrouped);
            } else {
                // 如果vote未激活，按照CSV的原始顺序排列
                clusterOrder.forEach(groupId => {
                    this.notebookOrder.push(...groupMap[groupId]);
                });
                this.notebookOrder.push(...ungroupedNotebooks);
            }
        } else {
            this.notebookOrder = this.data.map((_, i) => i);
        }
        // 排序后派发事件
        const event = new CustomEvent('galaxy-notebook-order-changed', {
            detail: { notebookOrder: this.notebookOrder }
        });
        window.dispatchEvent(event);
        // 保存筛选状态
        this.saveFilterState();
    }

    onAfterAttach(): void {
        // 延迟恢复状态，确保tab切换完成
        setTimeout(() => {
            // 恢复状态
            this.restoreFilterState();
            this.updateNotebookOrder();

            // 绘制矩阵（restoreFilterState 中可能已经调用了 drawMatrix，所以这里检查一下）
            const existingContainer = this.node.querySelector('.matrix-container');
            if (!existingContainer) {
                this.drawMatrix();
            }
        }, 50); // 添加小延迟，确保tab切换完成

        window.addEventListener('galaxy-stage-hover', this.handleStageHover);
        window.addEventListener('galaxy-transition-hover', this.handleTransitionHover);
        window.addEventListener('galaxy-stage-selected', this.handleStageSelected);
        window.addEventListener('galaxy-flow-selected', this.handleFlowSelected);
        window.addEventListener('galaxy-selection-cleared', this.handleSelectionCleared);
    }

    onBeforeDetach(): void {
        window.removeEventListener('galaxy-stage-hover', this.handleStageHover);
        window.removeEventListener('galaxy-transition-hover', this.handleTransitionHover);
        window.removeEventListener('galaxy-stage-selected', this.handleStageSelected);
        window.removeEventListener('galaxy-flow-selected', this.handleFlowSelected);
        window.removeEventListener('galaxy-selection-cleared', this.handleSelectionCleared);
    }

    private handleStageSelected = (event: Event) => {
        const stage = (event as CustomEvent).detail.stage;
        // 设置全局选中状态
        (window as any)._galaxyStageSelection = stage;
        (window as any)._galaxyFlowSelection = null;

        // 筛选包含该stage的notebook
        this.filter = { type: 'stage', stage };
        this.saveFilterState();
        this.drawMatrix();
    }

    private handleFlowSelected = (event: Event) => {
        const { from, to } = (event as CustomEvent).detail;
        // 设置全局选中状态
        (window as any)._galaxyFlowSelection = { from, to };
        (window as any)._galaxyStageSelection = null;

        // 筛选包含该flow的notebook
        this.filter = { type: 'flow', from, to };
        this.saveFilterState();
        this.drawMatrix();
    }

    private handleSelectionCleared = () => {
        // 清除全局选中状态
        (window as any)._galaxyStageSelection = null;
        (window as any)._galaxyFlowSelection = null;
        // 清除筛选
        this.filter = null;
        this.saveFilterState();
        this.drawMatrix();
    }

    private handleStageHover = (event: Event) => {
        const stage = (event as CustomEvent).detail.stage;

        // 检查是否有选中的stage
        const hasStageSelection = (window as any)._galaxyStageSelection;

        // 只有在没有选中状态时才应用hover效果
        if (!hasStageSelection) {
            if (!stage) {
                d3.selectAll('.matrix-cell')
                    .classed('matrix-highlight', false)
                    .classed('matrix-dim', false);
            } else {
                d3.selectAll('.matrix-cell')
                    .classed('matrix-highlight', false)
                    .classed('matrix-dim', true);
                d3.selectAll(`.matrix-cell-${stage}`)
                    .classed('matrix-highlight', true)
                    .classed('matrix-dim', false);
            }
        }
    }

    private handleTransitionHover = (event: Event) => {
        const { from, to } = (event as CustomEvent).detail;
        const root = d3.select(this.node);

        // 检查是否有选中的flow
        const hasFlowSelection = (window as any)._galaxyFlowSelection;

        // 只有在没有选中状态时才应用hover效果
        if (!hasFlowSelection) {
            if (!from || !to) {
                root.selectAll('.matrix-cell')
                    .classed('matrix-highlight', false)
                    .classed('matrix-dim', false);
            } else {
                root.selectAll('.matrix-cell')
                    .classed('matrix-highlight', false)
                    .classed('matrix-dim', true);

                // 遍历所有 notebook
                this.notebookOrder.forEach((row, colIdx) => {
                    const nb = this.data[row];
                    const sortedCells = nb.cells.sort((a, b) => a.cellId - b.cellId);

                    // 过滤可见cells（与drawMatrix中的逻辑保持一致）
                    const processedCells = sortedCells.filter(cell =>
                        this.showMarkdown || cell.cellType !== 'markdown'
                    );

                    // 找到所有符合transition的cell对（在processedCells中查找）
                    const transitionPairs: number[][] = [];
                    for (let i = 0; i < processedCells.length; i++) {
                        const currStage = String(processedCells[i]["1st-level label"] ?? "None");
                        if (currStage === from) {
                            // 向后查找下一个to stage的cell
                            for (let j = i + 1; j < processedCells.length; j++) {
                                const nextStage = String(processedCells[j]["1st-level label"] ?? "None");
                                if (nextStage === to) {
                                    transitionPairs.push([i, j]);
                                    break; // 找到第一个匹配的就停止
                                } else if (nextStage !== "None") {
                                    // 如果遇到其他stage，停止搜索
                                    break;
                                }
                                // 继续搜索
                            }
                        }
                    }

                    // 高亮所有找到的transition pairs
                    transitionPairs.forEach(([fromIdx, toIdx]) => {
                        // 向前找连续 from
                        let i0 = fromIdx;
                        while (i0 > 0 && String(processedCells[i0 - 1]["1st-level label"] ?? "None") === from) i0--;
                        // 向后找连续 to
                        let i1 = toIdx;
                        while (i1 + 1 < processedCells.length && String(processedCells[i1 + 1]["1st-level label"] ?? "None") === to) i1++;

                        // 高亮 from 段
                        for (let j = i0; j <= fromIdx; j++) {
                            root.select(`.matrix-cell[data-row="${row}"][data-index="${j}"]`)
                                .classed('matrix-highlight', true)
                                .classed('matrix-dim', false);
                        }
                        // 高亮 to 段
                        for (let j = toIdx; j <= i1; j++) {
                            root.select(`.matrix-cell[data-row="${row}"][data-index="${j}"]`)
                                .classed('matrix-highlight', true)
                                .classed('matrix-dim', false);
                        }
                    });
                });
            }
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

        const baseCellHeight = 5;
        const cellWidth = 20;
        const rowPadding = 1;
        const notebookSpacing = 2; // Add space between notebooks

        // Calculate additional spacing for similarity groups
        let groupSpacing = 0;
        const groupGap = 20; // White space between groups
        if (this.sortState === 3 && this.similarityGroups && this.similarityGroups.length > 0) {
            // Count unique groups in the current notebook order
            const uniqueGroups = new Set();
            notebookOrder.forEach(idx => {
                const nb = notebooks[idx] as any;
                // 安全检查：确保kernelVersionId存在
                if (nb && nb.kernelVersionId) {
                    const kernelId = nb.kernelVersionId.toString();
                    const simRow = this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId);
                    if (simRow) {
                        uniqueGroups.add(simRow.cluster_id);
                    }
                }
            });
            groupSpacing = Math.max(0, uniqueGroups.size - 1) * groupGap;
        }

        const svgWidth = Math.max(1000, notebookOrder.length * (cellWidth + rowPadding + notebookSpacing) + groupSpacing + 100);

        // 计算动态高度
        let totalHeight = 0;
        const cellHeights: number[][] = [];
        const cellYPositions: number[][] = [];

        notebookOrder.forEach((row, colIdx) => {
            const nb = notebooks[row];
            const sortedCells = nb.cells.sort((a, b) => a.cellId - b.cellId);
            const heights: number[] = [];
            const yPositions: number[] = [];
            let currentY = 0;

            // 直接使用原始cells
            const processedCells = sortedCells.filter(cell =>
                this.showMarkdown || cell.cellType !== 'markdown'
            );

            processedCells.forEach((cell, i) => {
                let cellHeight: number;
                if (this.cellHeightMode === 'fixed') {
                    cellHeight = baseCellHeight;
                } else {
                    // 动态高度：基于代码行数
                    const code = (cell as any).source ?? (cell as any).code ?? '';
                    const lineCount = code.split(/\r?\n/).length;
                    cellHeight = Math.max(3, Math.min(20, 3 + lineCount * 0.8));
                }
                heights.push(cellHeight);
                yPositions.push(currentY);
                currentY += cellHeight + 0; // 减少cell间距，从1改为0
            });

            cellHeights.push(heights);
            cellYPositions.push(yPositions);
            totalHeight = Math.max(totalHeight, currentY);
        });

        // 计算内容高度
        const contentHeight = totalHeight + 100;
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

        // 添加滚动事件监听器来保存滚动位置
        container.addEventListener('scroll', () => {
            this.saveFilterState();
        });

        this.node.appendChild(container);

        const svg = d3
            .select(container)
            .append('svg')
            .attr('width', svgWidth)
            .attr('height', svgHeight)
            .attr('id', 'matrix');

        const g = svg.append('g').attr('transform', 'translate(20, 24)');

        const self = this;

        // Calculate column positions with group spacing
        const columnPositions: number[] = [];
        let currentX = 0;
        let prevGroupId: string | null = null;

        notebookOrder.forEach((row, colIdx) => {
            const nb = notebooks[row] as any;

            // Check if we need to add group spacing
            if (this.sortState === 3 && this.similarityGroups && this.similarityGroups.length > 0) {
                const kernelId = nb && nb.kernelVersionId ? nb.kernelVersionId.toString() : null;
                const simRow = kernelId ? this.similarityGroups.find((simRow: any) => simRow.kernelVersionId === kernelId) : null;
                const currentGroupId = simRow ? simRow.cluster_id : null;

                // Add spacing if this is a new group (but not for the first group)
                if (prevGroupId !== null && currentGroupId !== prevGroupId && currentGroupId !== null) {
                    currentX += groupGap;
                }
                prevGroupId = currentGroupId;
            }

            columnPositions.push(currentX);
            currentX += cellWidth + rowPadding + notebookSpacing;
        });

        notebookOrder.forEach((row, colIdx) => {
            const nb = notebooks[row];
            const sortedCells = nb.cells.sort((a, b) => a.cellId - b.cellId);

            let prevStage: string | null = null;
            let visibleCellIndex = 0; // 用于跟踪可见cell的索引

            // 直接使用原始cells
            const processedCells = sortedCells.filter(cell =>
                this.showMarkdown || cell.cellType !== 'markdown'
            );

            processedCells.forEach((cell, i) => {
                const currStage = String(cell["1st-level label"] ?? "None");
                const currClass = currStage;

                let transitionClass = "";
                if (prevStage) {
                    transitionClass = `pair-from-${prevStage}-to-${currClass}`;
                }

                const cellHeight = cellHeights[colIdx][visibleCellIndex];
                const cellY = cellYPositions[colIdx][visibleCellIndex];

                const base = g
                    .append('rect')
                    .datum({ ...cell, kernelVersionId: (nb as any)?.kernelVersionId || null, notebook_name: (nb as any)?.notebook_name || null })
                    .attr('x', columnPositions[colIdx] + 0)
                    .attr('y', cellY + 0)
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
                            .attr('stroke', d.cellType === 'code' ? color(String(d["1st-level label"] ?? "None")) : '#bbb')
                            .attr('filter', 'drop-shadow(0px 0px 6px rgba(0,0,0,0.18))');
                        
                        // 派发notebook高亮事件
                        const notebookIndex = (d as any).globalIndex || nb.globalIndex;
                        if (notebookIndex) {
                            window.dispatchEvent(new CustomEvent('galaxy-notebook-highlight', {
                                detail: { 
                                    notebookIndex: notebookIndex,
                                    highlight: true 
                                }
                            }));
                        }
                        
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
                        const code = (d as any).source ?? (d as any).code ?? '';
                        const lineCount = code.split(/\r?\n/).length;
                        // 从kernelTitleMap中获取Title
                        const kernelId = (d as any)?.kernelVersionId?.toString();
                        const titleFromMap = kernelId ? self.kernelTitleMap.get(kernelId) : null;
                        const notebookTitle = titleFromMap?.title || kernelId || 'Unknown';


                        let tooltipContent = `Stage: ${typeof LABEL_MAP !== 'undefined' ? (LABEL_MAP[String(d["1st-level label"] ?? "None")] ?? d["1st-level label"] ?? "None") : (d["1st-level label"] ?? "None")}` +
                            `<br>Notebook Title: ${notebookTitle}` +
                            `<br>Lines: ${lineCount}`;

                        // 添加投票信息
                        if (self.voteData && self.voteData.length > 0) {
                            const kernelId = (d as any)?.kernelVersionId?.toString();
                            const voteRow = kernelId ? self.voteData.find((row: any) => row.kernelVersionId === kernelId) : null;
                            if (voteRow && voteRow.TotalVotes !== undefined) {
                                tooltipContent += `<br>Votes: ${voteRow.TotalVotes}`;
                            }
                        }



                        tooltip.innerHTML = tooltipContent;
                        // 如果有 similarityGroups，显示 cluster_id, similarity, label_integers
                        if (self.similarityGroups && self.similarityGroups.length > 0) {
                            const kernelId = (d as any)?.kernelVersionId?.toString();
                            const simRow = kernelId ? self.similarityGroups.find((row: any) => row.kernelVersionId === kernelId) : null;
                            if (simRow) {
                                tooltip.innerHTML += `<br>cluster_id: ${simRow.cluster_id}`;
                                if (simRow.similarity !== undefined) {
                                    tooltip.innerHTML += `<br>similarity: ${simRow.similarity}`;
                                }
                            }
                        }
                        tooltip.style.display = 'block';
                    })
                    .on('mousemove', function (event) {
                        const tooltip = document.getElementById('galaxy-tooltip');
                        tooltip!.style.left = event.clientX + 12 + 'px';
                        tooltip!.style.top = event.clientY + 12 + 'px';
                    })
                    .on('mouseout', function (event, d) {
                        d3.select(this).classed('matrix-highlight', false)
                            .attr('filter', null);
                        const datum = d3.select(this).datum() as Cell;
                        if (datum.cellType !== 'code') {
                            d3.select(this).attr('stroke', '#bbb');
                        } else {
                            d3.select(this).attr('stroke', color(String(datum["1st-level label"] ?? "None")));
                        }
                        
                        // 取消notebook高亮
                        const notebookIndex = (d as any).globalIndex || nb.globalIndex;
                        if (notebookIndex) {
                            window.dispatchEvent(new CustomEvent('galaxy-notebook-highlight', {
                                detail: { 
                                    notebookIndex: notebookIndex,
                                    highlight: false 
                                }
                            }));
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
                            // 如果是markdown cell，只跳转到notebook，不显示cell detail
                            if (d.cellType === 'markdown') {
                                // 不触发cell detail事件，让DetailSidebar显示notebook概览
                            } else {
                                // 对于code cell，显示cell detail
                                window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
                                    detail: {
                                        notebookIndex: nb.globalIndex,
                                        cellIndex: i,
                                        kernelVersionId: (nb as any).kernelVersionId
                                    }
                                }));
                                window.dispatchEvent(new CustomEvent('galaxy-cell-detail', {
                                    detail: {
                                        cell: { ...d, notebookIndex: nb.globalIndex, cellIndex: i, _notebookDetail: notebookObj }
                                    }
                                }));
                            }
                        }, 0);
                    });

                if (prevStage) {
                    d3.select(base.node()?.previousSibling as SVGRectElement).classed(transitionClass, true);
                }
                prevStage = currStage;
                visibleCellIndex++; // Increment visibleCellIndex after each cell
            });
        });

        // 添加列编号
        const headerG = g.append('g').attr('class', 'matrix-header');
        for (let col = 0; col < notebookOrder.length; col++) {
            const nb = notebooks[notebookOrder[col]];
            headerG.append('text')
                .attr('x', columnPositions[col] + cellWidth / 2)
                .attr('y', -10)
                .attr('text-anchor', 'middle')
                .attr('font-size', '10px')
                .attr('fill', '#555')
                .style('cursor', 'pointer')
                .text(nb?.globalIndex ?? (col + 1))
                .on('click', () => {
                    window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', { detail: { notebook: { ...nb, index: nb?.globalIndex ?? 0 } } }));
                });
        }

        // 在矩阵绘制完成后恢复滚动位置
        setTimeout(() => {
            this.restoreScrollPosition();
        }, 200); // 增加延迟时间，确保容器完全渲染
    }

    // 恢复滚动位置
    private restoreScrollPosition(): void {
        const tabId = this.getTabId();
        const stateKey = `_galaxyMatrixFilterState_${tabId}`;
        const savedState = (window as any)[stateKey];

        if (savedState && (savedState.scrollLeft !== undefined || savedState.scrollTop !== undefined)) {
            const matrixContainer = this.node.querySelector('.matrix-container') as HTMLElement;
            if (matrixContainer) {
                // 使用更可靠的方式来检测容器是否准备好
                const isContainerReady = () => {
                    const svg = matrixContainer.querySelector('svg');
                    const hasContent = svg && svg.children.length > 0;
                    const hasScrollableContent = matrixContainer.scrollWidth > matrixContainer.clientWidth ||
                        matrixContainer.scrollHeight > matrixContainer.clientHeight;
                    return hasContent && hasScrollableContent;
                };

                const restoreScroll = () => {
                    if (isContainerReady()) {
                        matrixContainer.scrollLeft = savedState.scrollLeft || 0;
                        matrixContainer.scrollTop = savedState.scrollTop || 0;
                        return true; // 成功恢复
                    } else {
                        return false; // 需要重试
                    }
                };

                // 使用递归重试机制，最多重试10次，每次间隔递增
                let retryCount = 0;
                const maxRetries = 10;

                const attemptRestore = () => {
                    if (retryCount >= maxRetries) {
                        return;
                    }

                    if (!restoreScroll()) {
                        retryCount++;
                        const delay = Math.min(100 * retryCount, 1000); // 递增延迟，最大1秒
                        setTimeout(attemptRestore, delay);
                    }
                };

                // 开始尝试恢复
                requestAnimationFrame(attemptRestore);
            }
        }
    }

    getNotebookOrder(): number[] {
        return this.notebookOrder;
    }

    // 重置MatrixWidget状态，用于切换competition时
    resetState(): void {
        this.filter = null;
        this.sortState = 0;
        this.voteEnabled = false;
        this.notebookOrder = this.data.map((_, i) => i);
        (this as any)._assignmentFilter = '';
        (this as any)._studentFilter = '';
        this.cellHeightMode = 'fixed';
        this.showMarkdown = true;

        // 只有在DOM元素已经创建时才更新按钮状态
        if (this.sortButton) {
            this.sortButton.innerHTML = this.getSortIcon();
        }
        if (this.similaritySortButton) {
            this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
        }
        if (this.cellHeightButton) {
            this.cellHeightButton.innerHTML = this.getCellHeightIcon();
        }
        if (this.markdownButton) {
            this.markdownButton.innerHTML = this.getMarkdownIcon();
        }
        if (this.voteSortButton) {
            this.voteSortButton.innerHTML = this.getVoteSortIcon();
            this.voteSortButton.classList.remove('active');
        }
        this.updateSortButtonState();

        // 只有在DOM元素已经创建时才重置筛选器
        if (this.node) {
            const assignmentSelect = this.node.querySelector('select') as HTMLSelectElement;
            const studentSelect = this.node.querySelectorAll('select')[1] as HTMLSelectElement;
            if (assignmentSelect) assignmentSelect.value = '';
            if (studentSelect) studentSelect.value = '';
        }

        // 清除保存的状态
        const tabId = this.getTabId();
        const stateKey = `_galaxyMatrixFilterState_${tabId}`;
        delete (window as any)[stateKey];
    }

    setFilter(selection: any) {
        this.filter = selection;
        this.drawMatrix();
    }

    // 获取当前筛选后的notebook列表
    private getFilteredNotebooks(): any[] {
        const assignmentFilter = (this as any)._assignmentFilter || '';
        const studentFilter = (this as any)._studentFilter || '';
        return this.data.filter(nb => {
            const matchAssignment = !assignmentFilter || (nb as any).assignment === assignmentFilter;
            const matchStudent = !studentFilter || (nb as any).student_id === studentFilter;
            return matchAssignment && matchStudent;
        });
    }

    // 根据当前排序状态更新按钮样式和可用性
    private updateSortButtonState() {
        if (this.sortButton) {
            if (this.sortState === 3 || this.voteEnabled) {
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

    // 获取当前tab ID
    private getTabId(): string {
        // MatrixWidget总是显示overview，所以使用overview标识
        return 'overview';
    }

    // 保存筛选状态到全局变量（按tab隔离）
    private saveFilterState() {
        const tabId = this.getTabId();
        const stateKey = `_galaxyMatrixFilterState_${tabId}`;

        // 获取之前保存的状态
        const previousState = (window as any)[stateKey];

        // 保存当前滚动位置
        const matrixContainer = this.node.querySelector('.matrix-container') as HTMLElement;
        const scrollLeft = matrixContainer ? matrixContainer.scrollLeft : 0;
        const scrollTop = matrixContainer ? matrixContainer.scrollTop : 0;

        // 如果当前滚动位置为0，但之前有有效的滚动位置，则保留之前的滚动位置
        const finalScrollLeft = (scrollLeft === 0 && previousState && previousState.scrollLeft > 0) ? previousState.scrollLeft : scrollLeft;
        const finalScrollTop = (scrollTop === 0 && previousState && previousState.scrollTop > 0) ? previousState.scrollTop : scrollTop;

        (window as any)[stateKey] = {
            filter: this.filter,
            sortState: this.sortState,
            voteEnabled: this.voteEnabled,
            notebookOrder: this.notebookOrder,
            assignmentFilter: (this as any)._assignmentFilter,
            studentFilter: (this as any)._studentFilter,
            cellHeightMode: this.cellHeightMode,
            showMarkdown: this.showMarkdown,
            scrollLeft: finalScrollLeft,
            scrollTop: finalScrollTop
        };
    }

    // 隐藏所有tooltip
    private hideAllTooltips() {
        // 隐藏galaxy-tooltip
        const galaxyTooltip = document.getElementById('galaxy-tooltip');
        if (galaxyTooltip) {
            galaxyTooltip.style.display = 'none';
        }
        // 隐藏tooltip
        const tooltip = document.getElementById('tooltip');
        if (tooltip) {
            tooltip.style.opacity = '0';
        }
    }

    // 从全局变量恢复筛选状态（按tab隔离）
    private restoreFilterState() {
        // 切换tab时隐藏所有tooltip
        this.hideAllTooltips();

        const tabId = this.getTabId();
        const stateKey = `_galaxyMatrixFilterState_${tabId}`;
        const savedState = (window as any)[stateKey];

        if (savedState) {
            this.filter = savedState.filter;
            this.sortState = savedState.sortState;
            this.voteEnabled = savedState.voteEnabled || false;
            this.notebookOrder = savedState.notebookOrder || this.data.map((_, i) => i);
            (this as any)._assignmentFilter = savedState.assignmentFilter || '';
            (this as any)._studentFilter = savedState.studentFilter || '';
            this.cellHeightMode = savedState.cellHeightMode || 'fixed';
            this.showMarkdown = savedState.showMarkdown || true; // 恢复markdown显示状态

            // 更新按钮状态
            this.sortButton.innerHTML = this.getSortIcon();
            this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
            this.voteSortButton.innerHTML = this.getVoteSortIcon();
            this.cellHeightButton.innerHTML = this.getCellHeightIcon();
            this.markdownButton.innerHTML = this.getMarkdownIcon();

            // 恢复vote按钮的active状态
            if (this.voteEnabled) {
                this.voteSortButton.classList.add('active');
            } else {
                this.voteSortButton.classList.remove('active');
            }

            this.updateSortButtonState();

            // 恢复assignment和student筛选器的值
            const assignmentSelect = this.node.querySelector('select') as HTMLSelectElement;
            const studentSelect = this.node.querySelectorAll('select')[1] as HTMLSelectElement;
            if (assignmentSelect) assignmentSelect.value = (this as any)._assignmentFilter;
            if (studentSelect) studentSelect.value = (this as any)._studentFilter;

            // 只有在没有现有容器时才重新绘制矩阵
            const existingContainer = this.node.querySelector('.matrix-container');
            if (!existingContainer) {
                this.drawMatrix();
                // 在 drawMatrix 后延迟恢复滚动位置，给容器更多时间渲染
                setTimeout(() => {
                    this.restoreScrollPosition();
                }, 200); // 增加延迟时间
            } else {
                // 如果容器已存在，也需要延迟恢复滚动位置，确保tab切换完成
                setTimeout(() => {
                    this.restoreScrollPosition();
                }, 200); // 增加延迟时间
            }
        } else {
            // 如果没有保存的状态，使用默认状态
            this.filter = null;
            this.sortState = 0;
            this.voteEnabled = false;
            this.notebookOrder = this.data.map((_, i) => i);
            (this as any)._assignmentFilter = '';
            (this as any)._studentFilter = '';
            this.cellHeightMode = 'fixed';
            this.showMarkdown = true; // 重置markdown显示状态

            // 更新按钮状态
            this.sortButton.innerHTML = this.getSortIcon();
            this.similaritySortButton.innerHTML = this.getSimilaritySortIcon();
            this.voteSortButton.innerHTML = this.getVoteSortIcon();
            this.cellHeightButton.innerHTML = this.getCellHeightIcon();
            this.markdownButton.innerHTML = this.getMarkdownIcon();

            // 重置vote按钮的active状态
            this.voteSortButton.classList.remove('active');

            this.updateSortButtonState();

            // 重置筛选器
            const assignmentSelect = this.node.querySelector('select') as HTMLSelectElement;
            const studentSelect = this.node.querySelectorAll('select')[1] as HTMLSelectElement;
            if (assignmentSelect) assignmentSelect.value = '';
            if (studentSelect) studentSelect.value = '';

            // 只有在没有现有容器时才重新绘制矩阵
            const existingContainer = this.node.querySelector('.matrix-container');
            if (!existingContainer) {
                this.drawMatrix();
            }
        }
    }

}