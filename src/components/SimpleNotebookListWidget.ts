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
        
        // ID header
        const idHeader = document.createElement('th');
        idHeader.style.cssText = 'padding: 6px 8px; text-align: center; font-weight: 600; color: #495057; width: 40px;';
        idHeader.textContent = 'ID';
        headerRow.appendChild(idHeader);
        
        // Vote header with sort triangle
        const voteHeader = document.createElement('th');
        voteHeader.style.cssText = 'padding: 6px 8px; text-align: center; font-weight: 600; color: #495057; width: 70px; cursor: pointer; position: relative;';
        voteHeader.textContent = 'Vote';
        
        // Create triangle icon
        const triangle = document.createElement('span');
        triangle.style.cssText = `
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%) ${this.sortByVote ? 'rotate(180deg)' : 'rotate(0deg)'};
            width: 0;
            height: 0;
            border-left: 3px solid transparent;
            border-right: 3px solid transparent;
            border-bottom: 4px solid #495057;
            transition: transform 0.2s, opacity 0.2s;
            opacity: 0;
        `;
        voteHeader.appendChild(triangle);
        
        voteHeader.addEventListener('click', () => {
            this.sortByVote = !this.sortByVote;
            triangle.style.transform = `translateY(-50%) ${this.sortByVote ? 'rotate(180deg)' : 'rotate(0deg)'}`;
            this.render();
        });
        
        // Show triangle on hover
        voteHeader.addEventListener('mouseenter', () => {
            triangle.style.opacity = '1';
        });
        
        voteHeader.addEventListener('mouseleave', () => {
            triangle.style.opacity = '0';
        });
        
        headerRow.appendChild(voteHeader);
        
        // Notebook header
        const notebookHeader = document.createElement('th');
        notebookHeader.style.cssText = 'padding: 6px 8px; text-align: left; font-weight: 600; color: #495057;';
        notebookHeader.textContent = 'Notebook';
        headerRow.appendChild(notebookHeader);

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





    // 更新数据的方法
    public updateData(newData: Notebook[]) {
        this.data = newData.map((nb, i) => ({ ...nb, globalIndex: i + 1 }));
        this.render();
    }
} 