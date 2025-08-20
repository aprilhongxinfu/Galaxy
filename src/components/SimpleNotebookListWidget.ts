import { Widget } from '@lumino/widgets';
import { analytics } from '../analytics/posthog-config';

type Cell = {
    cellId: number;
    cellType: string;
    "1st-level label": string;
    source?: string;
    code?: string;
    outputs?: any[];
};

type Notebook = {
    cells: Cell[];
    globalIndex?: number;
    index?: number;
    kernelVersionId?: string;
    notebook_name?: string;
    creationDate?: string;
    totalLines?: number;
    displayname?: string;
    url?: string;
};

export class SimpleNotebookListWidget extends Widget {
    private data: Notebook[];
    private kernelTitleMap: Map<string, { title: string; creationDate: string; totalLines: number; displayname?: string; url?: string }>;
    private competitionInfo?: { id: string; name: string; url: string };
    private voteData: any[];
    private sortByVote: boolean = false;

    constructor(data: Notebook[], kernelTitleMap?: Map<string, { title: string; creationDate: string; totalLines: number; displayname?: string; url?: string }>, competitionInfo?: { id: string; name: string; url: string }, voteData?: any[]) {
        super();
        this.data = data.map((nb, i) => ({ ...nb, globalIndex: i + 1 }));
        this.kernelTitleMap = kernelTitleMap || new Map();
        this.competitionInfo = competitionInfo;
        this.voteData = voteData || [];

        this.id = 'simple-notebook-list-widget';
        this.title.label = 'Notebook List';
        this.title.closable = true;
        this.addClass('simple-notebook-list-widget');

        this.render();
    }

    private render() {
        // 清空现有内容
        this.node.innerHTML = '';

        // 创建主容器
        const container = document.createElement('div');
        container.style.cssText = `
            height: 100%;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #ffffff;
            color: #333;
        `;

        // 创建notebook列表容器
        const listContainer = document.createElement('div');
        listContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        `;

        // 创建表格样式的notebook列表
        const tableContainer = this.createNotebookTable();
        listContainer.appendChild(tableContainer);

        container.appendChild(listContainer);
        this.node.appendChild(container);
        
        // 初始化时设置激活状态
        if (this.sortByVote) {
            const sortButton = this.node.querySelector('button') as HTMLButtonElement;
            if (sortButton) {
                sortButton.classList.add('active');
            }
        }
    }

    private createNotebookTable(): HTMLElement {
        const tableWrapper = document.createElement('div');
        tableWrapper.style.cssText = `
            background: #fff;
            border-radius: 6px;
            border: 1px solid #e9ecef;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        `;

        // 创建排序按钮容器
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.alignItems = 'center';
        buttonContainer.style.marginTop = '4px';
        buttonContainer.style.marginBottom = '4px';
        buttonContainer.style.height = '24px';
        buttonContainer.style.width = '100%';
        buttonContainer.style.position = 'relative';

        // 创建排序按钮
        const sortButton = document.createElement('button');
        sortButton.innerHTML = this.getVoteSortIcon();
        sortButton.style.background = 'none';
        sortButton.style.border = 'none';
        sortButton.style.cursor = 'pointer';
        sortButton.style.fontSize = '18px';
        sortButton.style.display = 'flex';
        sortButton.style.alignItems = 'center';
        sortButton.style.justifyContent = 'center';

        // 添加tooltip
        this.addTooltipToButton(sortButton, () => 'Sort by votes');

        sortButton.addEventListener('click', () => {
            this.sortByVote = !this.sortByVote;
            if (this.sortByVote) {
                sortButton.classList.add('active');
            } else {
                sortButton.classList.remove('active');
            }
            sortButton.innerHTML = this.getVoteSortIcon();
            this.render();
        });

        buttonContainer.appendChild(sortButton);

        const tableContainer = document.createElement('div');
        tableContainer.style.cssText = `
            overflow: auto;
            flex: 1;
            min-height: 0;
        `;

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            min-width: 400px;
        `;

        // 创建表头
        const thead = document.createElement('thead');
        thead.style.cssText = `
            position: sticky;
            top: 0;
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
            z-index: 10;
        `;

        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th style="padding: 6px 8px; text-align: center; font-weight: 600; color: #495057; width: 40px;">ID</th>
            <th style="padding: 6px 8px; text-align: center; font-weight: 600; color: #495057; width: 70px;">Vote</th>
            <th style="padding: 6px 8px; text-align: left; font-weight: 600; color: #495057;">Notebook</th>
        `;

        thead.appendChild(headerRow);

        // 创建表体 - 根据排序状态排序数据
        const tbody = document.createElement('tbody');
        const sortedData = this.getSortedData();
        sortedData.forEach((notebook, index) => {
            const row = this.createNotebookTableRow(notebook, index);
            tbody.appendChild(row);
        });

        table.appendChild(thead);
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        tableWrapper.appendChild(buttonContainer);
        tableWrapper.appendChild(tableContainer);

        return tableWrapper;
    }

    private getSortedData(): Notebook[] {
        if (this.sortByVote) {
            // 按vote排序（降序）
            return [...this.data].sort((a, b) => {
                const aVote = this.getVoteValue(a);
                const bVote = this.getVoteValue(b);
                return bVote - aVote; // 降序排列
            });
        } else {
            // 按ID排序（升序）
            return [...this.data].sort((a, b) => {
                const aId = a.globalIndex || 0;
                const bId = b.globalIndex || 0;
                return aId - bId;
            });
        }
    }

    private getVoteValue(notebook: Notebook): number {
        if (this.voteData && this.voteData.length > 0) {
            const kernelId = notebook.kernelVersionId?.toString();
            const voteRow = kernelId ? this.voteData.find((row: any) => row.kernelVersionId === kernelId) : null;
            if (voteRow && voteRow.TotalVotes !== undefined) {
                return parseInt(voteRow.TotalVotes.toString()) || 0;
            }
        }
        return 0;
    }

    private createNotebookTableRow(notebook: Notebook, index: number): HTMLElement {
        const row = document.createElement('tr');
        row.className = 'overview-notebook-item';
        row.setAttribute('data-notebook-index', (notebook.globalIndex || index + 1).toString());
        row.style.cssText = `
            cursor: pointer;
            transition: background-color 0.15s;
        `;

        // 使用kernelTitleMap获取更准确的标题信息
        const titleInfo = notebook.kernelVersionId ? this.kernelTitleMap.get(notebook.kernelVersionId) : null;
        const displayTitle = titleInfo?.title || notebook.notebook_name || `Notebook ${notebook.globalIndex || index + 1}`;

        // 获取vote信息
        let voteValue = '-';
        if (this.voteData && this.voteData.length > 0) {
            const kernelId = notebook.kernelVersionId?.toString();
            const voteRow = kernelId ? this.voteData.find((row: any) => row.kernelVersionId === kernelId) : null;
            if (voteRow && voteRow.TotalVotes !== undefined) {
                voteValue = voteRow.TotalVotes.toString();
            }
        }

        row.innerHTML = `
            <td style="padding: 6px 8px; border-bottom: 1px solid #e9ecef; text-align: center; color: #6c757d; font-size: 11px; width: 40px;">${notebook.globalIndex || index + 1}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e9ecef; text-align: center; color: #6c757d; font-size: 11px; width: 70px;">${voteValue}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e9ecef; font-weight: 500; color: #495057; font-size: 12px;">${displayTitle}</td>
        `;

        // 添加点击事件
        row.addEventListener('click', () => {
            // 触发simple notebook detail事件
            window.dispatchEvent(new CustomEvent('galaxy-simple-notebook-selected', {
                detail: {
                    notebook: notebook
                }
            }));

            // Track notebook opened from simple list
            analytics.trackNotebookOpened({
                kernelVersionId: notebook.kernelVersionId || `nb_${notebook.index || Date.now()}`,
                notebookName: notebook.notebook_name,
                competitionId: this.competitionInfo?.id,
                totalCells: notebook.cells ? notebook.cells.length : 0,
                codeCells: notebook.cells ? notebook.cells.filter((cell: any) => (cell.cellType + '').toLowerCase() === 'code').length : 0,
                tabTitle: `Simple Notebook ${notebook.globalIndex || index + 1}`,
                tabId: `simple-notebook-detail-widget-${notebook.kernelVersionId || notebook.index || Date.now()}`
            });
        });

        // 添加悬停效果
        row.addEventListener('mouseenter', () => {
            row.style.backgroundColor = '#e3f2fd';
        });
        row.addEventListener('mouseleave', () => {
            row.style.backgroundColor = '';
        });

        return row;
    }



    // 获取投票排序图标
    private getVoteSortIcon(): string {
        // 投票排序icon，使用星星图标，激活绿色，未激活灰色
        if (this.sortByVote) {
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

    // 通用的tooltip处理函数
    private addTooltipToButton(button: HTMLButtonElement, getTooltipText: () => string): void {
        button.onmouseenter = (e) => {
            // 使用缓存的tooltip元素或创建新的
            let tooltip = (window as any)._galaxyTooltip;
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
                (window as any)._galaxyTooltip = tooltip;
            }
            
            tooltip.innerHTML = getTooltipText();
            tooltip.style.display = 'block';
            tooltip.style.left = e.clientX + 12 + 'px';
            tooltip.style.top = e.clientY + 12 + 'px';
        };
        button.onmousemove = (e) => {
            const tooltip = (window as any)._galaxyTooltip;
            if (tooltip) {
                tooltip.style.left = e.clientX + 12 + 'px';
                tooltip.style.top = e.clientY + 12 + 'px';
            }
        };
        button.onmouseleave = () => {
            const tooltip = (window as any)._galaxyTooltip;
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        };
    }

    // 更新数据的方法
    public updateData(newData: Notebook[]) {
        this.data = newData.map((nb, i) => ({ ...nb, globalIndex: i + 1 }));
        this.render();
    }
} 