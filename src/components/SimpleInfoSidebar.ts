import { Widget } from '@lumino/widgets';

type Notebook = {
    cells: any[];
    globalIndex?: number;
    index?: number;
    kernelVersionId?: string;
    notebook_name?: string;
    creationDate?: string;
    totalLines?: number;
    displayname?: string;
    url?: string;
    toc?: TOCItem[];
};

type TOCItem = {
    heading: string;
    cellId: string;
};

export class SimpleInfoSidebar extends Widget {
    private currentNotebook: Notebook | null = null;
    private competitionInfo?: { id: string; name: string; url: string; description?: string };
    private eventHandler: (event: Event) => void;

    constructor(competitionInfo?: { id: string; name: string; url: string; description?: string }) {
        super();
        this.competitionInfo = competitionInfo;

        this.id = 'simple-info-sidebar';
        this.title.label = 'Info';
        this.title.closable = true;
        this.addClass('simple-info-sidebar');

        // 绑定事件处理器
        this.eventHandler = this.handleSimpleNotebookDetailOpened.bind(this);

        this.render();
    }

    onAfterAttach(): void {
        // 监听simple notebook detail打开事件
        window.addEventListener('galaxy-simple-notebook-detail-opened', this.eventHandler);
        // 监听simple notebook detail关闭事件
        window.addEventListener('galaxy-simple-notebook-detail-closed', this.handleSimpleNotebookDetailClosed.bind(this));
    }

    onBeforeDetach(): void {
        // 移除事件监听器
        window.removeEventListener('galaxy-simple-notebook-detail-opened', this.eventHandler);
        window.removeEventListener('galaxy-simple-notebook-detail-closed', this.handleSimpleNotebookDetailClosed.bind(this));
    }

    private handleSimpleNotebookDetailOpened(event: Event): void {
        const customEvent = event as CustomEvent;
        const notebook = customEvent.detail?.notebook;
        if (notebook) {
            this.setNotebookDetail(notebook);
        }
    }

    private handleSimpleNotebookDetailClosed(): void {
        this.clearNotebook();
    }

    private render() {
        // 清空现有内容
        this.node.innerHTML = '';

        // 创建主容器 - 使用与DetailSidebar相同的样式
        const container = document.createElement('div');
        container.style.cssText = `
            padding: 16px 12px 12px 12px;
            font-size: 13px;
            line-height: 1.4;
            color: #222;
            height: 100%;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #ffffff;
        `;

        // 创建标题区域 - 与DetailSidebar保持一致
        const header = document.createElement('div');
        header.style.cssText = `
            margin-bottom: 12px;
            flex-shrink: 0;
        `;

        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 6px;
            line-height: 1.3;
            color: #222;
            padding-bottom: 8px;
            border-bottom: 1px solid #e9ecef;
        `;

        // 显示competition信息，与DetailSidebar保持一致
        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = 'color: #222;';
        titleSpan.textContent = this.competitionInfo ? this.competitionInfo.name : 'Notebook Overview';

        titleDiv.appendChild(titleSpan);

        // 添加Kaggle链接，与DetailSidebar保持一致
        if (this.competitionInfo) {
            const kaggleLink = document.createElement('a');
            kaggleLink.href = this.competitionInfo.url;
            kaggleLink.target = '_blank';
            kaggleLink.className = 'kaggle-link';
            kaggleLink.style.cssText = `
                display: inline-flex;
                align-items: center;
                text-decoration: none;
                margin-left: 8px;
                vertical-align: baseline;
                height: 23.4px;
                line-height: 23.4px;
            `;
            kaggleLink.title = 'View on Kaggle';
            kaggleLink.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 163 63.2" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M26.92 47c-.05.18-.24.27-.56.27h-6.17a1.24 1.24 0 0 1-1-.48L9 33.78l-2.83 2.71v10.06a.61.61 0 0 1-.69.69H.69a.61.61 0 0 1-.69-.69V.69A.61.61 0 0 1 .69 0h4.79a.61.61 0 0 1 .69.69v28.24l12.21-12.35a1.44 1.44 0 0 1 1-.49h6.39a.54.54 0 0 1 .55.35.59.59 0 0 1-.07.63L13.32 29.55l13.46 16.72a.65.65 0 0 1 .14.73ZM51.93 47.24h-4.79c-.51 0-.76-.23-.76-.69v-1a12.77 12.77 0 0 1-7.84 2.29A11.28 11.28 0 0 1 31 45.16a9 9 0 0 1-3.12-7.07q0-6.81 8.46-9.23a61.55 61.55 0 0 1 10.06-1.67A5.47 5.47 0 0 0 40.48 21a14 14 0 0 0-7.91 2.77c-.41.24-.71.19-.9-.13l-2.5-3.54c-.23-.28-.16-.6.21-1a19.32 19.32 0 0 1 11.1-3.68A13.29 13.29 0 0 1 48 17.55q4.59 3.06 4.58 9.78v19.22a.61.61 0 0 1-.65.69Zm-5.55-14.5q-6.8.7-9.3 1.81Q33.69 36 34 38.71a3.49 3.49 0 0 0 1.53 2.46 5.87 5.87 0 0 0 3 1.08 9.49 9.49 0 0 0 7.77-2.57ZM81 59.28q-3.81 3.92-10.74 3.92a15.41 15.41 0 0 1-7.63-2c-.51-.33-1.11-.76-1.81-1.29s-1.5-1.19-2.43-2a.72.72 0 0 1-.07-1l3.26-3.26a.76.76 0 0 1 .56-.21.68.68 0 0 1 .49.21c2.58 2.58 5.11 3.88 7.56 3.88q8.39 0 8.39-8.74v-3.63a13.1 13.1 0 0 1-8.67 2.71 12.48 12.48 0 0 1-10.55-5.07A18.16 18.16 0 0 1 56 31.63a18 18 0 0 1 3.2-10.82 12.19 12.19 0 0 1 10.61-5.34 13.93 13.93 0 0 1 8.74 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .7.7v31q.03 7.57-3.73 11.49ZM78.58 26q-1.74-4.44-8-4.44-8.11 0-8.11 10.12 0 5.63 2.7 8.19a7.05 7.05 0 0 0 5.21 2q6.51 0 8.25-4.44ZM113.59 59.28q-3.78 3.91-10.72 3.92a15.44 15.44 0 0 1-7.63-2q-.76-.49-1.8-1.29c-.7-.53-1.51-1.19-2.43-2a.7.7 0 0 1-.07-1l3.26-3.26a.74.74 0 0 1 .55-.21.67.67 0 0 1 .49.21c2.59 2.58 5.11 3.88 7.56 3.88q8.4 0 8.4-8.74v-3.63a13.14 13.14 0 0 1-8.68 2.71A12.46 12.46 0 0 1 92 42.8a18.09 18.09 0 0 1-3.33-11.17 18 18 0 0 1 3.19-10.82 12.21 12.21 0 0 1 10.61-5.34 14 14 0 0 1 8.75 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .69.7v31q-.02 7.57-3.8 11.49ZM111.2 26q-1.74-4.44-8-4.44-8.2-.05-8.2 10.07 0 5.63 2.71 8.19a7 7 0 0 0 5.2 2q6.53 0 8.26-4.44ZM128 47.24h-4.78a.62.62 0 0 1-.7-.69V.69a.62.62 0 0 1 .7-.69H128a.61.61 0 0 1 .7.69v45.86a.61.61 0 0 1-.7.69ZM162.91 33.16a.62.62 0 0 1-.7.69h-22.54a8.87 8.87 0 0 0 2.91 5.69 10.63 10.63 0 0 0 7.15 2.46 11.64 11.64 0 0 0 6.86-2.15c.42-.28.77-.28 1 0l3.26 3.33c.37.37.37.69 0 1a18.76 18.76 0 0 1-11.58 3.75 16 16 0 0 1-11.8-4.72 16.2 16.2 0 0 1-4.57-11.86 16 16 0 0 1 4.51-11.52 14.36 14.36 0 0 1 10.82-4.3A14.07 14.07 0 0 1 158.88 20 15 15 0 0 1 163 31.63ZM153.82 23a8.18 8.18 0 0 0-5.69-2.15 8.06 8.06 0 0 0-5.48 2.08 9.24 9.24 0 0 0-3 5.41h16.71a7 7 0 0 0-2.54-5.34Z" fill="#20beff"/>
                </svg>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left: 2px;">
                    <path d="M7 17L17 7M17 7H7M17 7V17" stroke="#20beff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;
            titleDiv.appendChild(kaggleLink);
        }

        header.appendChild(titleDiv);

        // 创建内容区域
        const content = document.createElement('div');
        content.style.cssText = `
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        `;

        // 添加competition description到content中，占满剩余高度
        if (this.competitionInfo?.description) {
            const descriptionDiv = document.createElement('div');
            descriptionDiv.style.cssText = `
                flex: 1;
                min-height: 0;
                display: flex;
                flex-direction: column;
                margin-top: 12px;
            `;
            
            const descriptionText = document.createElement('div');
            descriptionText.className = 'description-scroll';
            descriptionText.style.cssText = `
                font-size: 13px;
                line-height: 1.5;
                color: #495057;
                background: #f8f9fa;
                border-radius: 6px;
                padding: 12px;
                border: 1px solid #e9ecef;
                word-break: break-word;
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                overflow-x: hidden;
            `;
            descriptionText.innerHTML = this.competitionInfo.description;
            
            descriptionDiv.appendChild(descriptionText);
            content.appendChild(descriptionDiv);
        }

        container.appendChild(header);
        container.appendChild(content);
        this.node.appendChild(container);

        // 添加滚动条样式
        const style = document.createElement('style');
        style.textContent = `
            .simple-info-sidebar .description-scroll::-webkit-scrollbar {
                width: 6px;
            }
            .simple-info-sidebar .description-scroll::-webkit-scrollbar-track {
                background: #f8f9fa;
                border-radius: 3px;
            }
            .simple-info-sidebar .description-scroll::-webkit-scrollbar-thumb {
                background: #dee2e6;
                border-radius: 3px;
                border: 1px solid #f8f9fa;
            }
            .simple-info-sidebar .description-scroll::-webkit-scrollbar-thumb:hover {
                background: #adb5bd;
            }
        `;
        this.node.appendChild(style);
    }

    public setNotebookDetail(notebook: Notebook) {
        this.currentNotebook = notebook;
        this.renderNotebookInfo();
    }

    private renderNotebookInfo() {
        if (!this.currentNotebook) {
            this.render();
            return;
        }

        // 清空现有内容
        this.node.innerHTML = '';

        // 计算统计数据
        const total = this.currentNotebook.cells?.length || 0;
        const codeCount = this.currentNotebook.cells?.filter((cell: any) => (cell.cellType + '').toLowerCase() === 'code').length || 0;
        const mdCount = total - codeCount;

        // 使用与DetailSidebar完全相同的布局和样式
        this.node.innerHTML = `
            <div style="padding:12px 12px 8px 12px; font-size:14px; color:#222; max-width:420px; margin:0 auto; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
                <div style="font-size:16px; font-weight:700; margin-bottom:8px; line-height:1.3; word-break:break-all; padding-bottom:6px; border-bottom:1px solid #e9ecef; flex-shrink:0;">
                    <span style="color: #222;">Notebook ${this.currentNotebook.globalIndex !== undefined ? this.currentNotebook.globalIndex : ''}: ${this.currentNotebook.notebook_name ?? this.currentNotebook.kernelVersionId}</span>
                    ${this.currentNotebook.url ? `
                    <a href="${this.currentNotebook.url}" target="_blank" class="kaggle-link" style="display:inline-flex; align-items:center; text-decoration:none; margin-left:8px; vertical-align:baseline; height:23.4px; line-height:23.4px;" title="View on Kaggle">
                <svg width="24" height="24" viewBox="0 0 163 63.2" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M26.92 47c-.05.18-.24.27-.56.27h-6.17a1.24 1.24 0 0 1-1-.48L9 33.78l-2.83 2.71v10.06a.61.61 0 0 1-.69.69H.69a.61.61 0 0 1-.69-.69V.69A.61.61 0 0 1 .69 0h4.79a.61.61 0 0 1 .69.69v28.24l12.21-12.35a1.44 1.44 0 0 1 1-.49h6.39a.54.54 0 0 1 .55.35.59.59 0 0 1-.07.63L13.32 29.55l13.46 16.72a.65.65 0 0 1 .14.73ZM51.93 47.24h-4.79c-.51 0-.76-.23-.76-.69v-1a12.77 12.77 0 0 1-7.84 2.29A11.28 11.28 0 0 1 31 45.16a9 9 0 0 1-3.12-7.07q0-6.81 8.46-9.23a61.55 61.55 0 0 1 10.06-1.67A5.47 5.47 0 0 0 40.48 21a14 14 0 0 0-7.91 2.77c-.41.24-.71.19-.9-.13l-2.5-3.54c-.23-.28-.16-.6.21-1a19.32 19.32 0 0 1 11.1-3.68A13.29 13.29 0 0 1 48 17.55q4.59 3.06 4.58 9.78v19.22a.61.61 0 0 1-.65.69Zm-5.55-14.5q-6.8.7-9.3 1.81Q33.69 36 34 38.71a3.49 3.49 0 0 0 1.53 2.46 5.87 5.87 0 0 0 3 1.08 9.49 9.49 0 0 0 7.77-2.57ZM81 59.28q-3.81 3.92-10.74 3.92a15.41 15.41 0 0 1-7.63-2c-.51-.33-1.11-.76-1.81-1.29s-1.5-1.19-2.43-2a.72.72 0 0 1-.07-1l3.26-3.26a.76.76 0 0 1 .56-.21.68.68 0 0 1 .49.21c2.58 2.58 5.11 3.88 7.56 3.88q8.39 0 8.39-8.74v-3.63a13.1 13.1 0 0 1-8.67 2.71 12.48 12.48 0 0 1-10.55-5.07A18.16 18.16 0 0 1 56 31.63a18 18 0 0 1 3.2-10.82 12.19 12.19 0 0 1 10.61-5.34 13.93 13.93 0 0 1 8.74 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .7.7v31q.03 7.57-3.73 11.49ZM78.58 26q-1.74-4.44-8-4.44-8.11 0-8.11 10.12 0 5.63 2.7 8.19a7.05 7.05 0 0 0 5.21 2q6.51 0 8.25-4.44ZM113.59 59.28q-3.78 3.91-10.72 3.92a15.44 15.44 0 0 1-7.63-2q-.76-.49-1.8-1.29c-.7-.53-1.51-1.19-2.43-2a.7.7 0 0 1-.07-1l3.26-3.26a.74.74 0 0 1 .55-.21.67.67 0 0 1 .49.21c2.59 2.58 5.11 3.88 7.56 3.88q8.4 0 8.4-8.74v-3.63a13.14 13.14 0 0 1-8.68 2.71A12.46 12.46 0 0 1 92 42.8a18.09 18.09 0 0 1-3.33-11.17 18 18 0 0 1 3.19-10.82 12.21 12.21 0 0 1 10.61-5.34 14 14 0 0 1 8.75 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .69.7v31q-.02 7.57-3.8 11.49ZM111.2 26q-1.74-4.44-8-4.44-8.2-.05-8.2 10.07 0 5.63 2.71 8.19a7 7 0 0 0 5.2 2q6.53 0 8.26-4.44ZM128 47.24h-4.78a.62.62 0 0 1-.7-.69V.69a.62.62 0 0 1 .7-.69H128a.61.61 0 0 1 .7.69v45.86a.61.61 0 0 1-.7.69ZM162.91 33.16a.62.62 0 0 1-.7.69h-22.54a8.87 8.87 0 0 0 2.91 5.69 10.63 10.63 0 0 0 7.15 2.46 11.64 11.64 0 0 0 6.86-2.15c.42-.28.77-.28 1 0l3.26 3.33c.37.37.37.69 0 1a18.76 18.76 0 0 1-11.58 3.75 16 16 0 0 1-11.8-4.72 16.2 16.2 0 0 1-4.57-11.86 16 16 0 0 1 4.51-11.52 14.36 14.36 0 0 1 10.82-4.3A14.07 14.07 0 0 1 158.88 20 15 15 0 0 1 163 31.63ZM153.82 23a8.18 8.18 0 0 0-5.69-2.15 8.06 8.06 0 0 0-5.48 2.08 9.24 9.24 0 0 0-3 5.41h16.71a7 7 0 0 0-2.54-5.34Z" fill="#20beff"/>
                </svg>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left:2px;">
                    <path d="M7 17L17 7M17 7H7M17 7V17" stroke="#20beff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                    </a>
                    ` : ''}
                </div>
                
                ${this.currentNotebook.displayname ? `
                <div style="margin-bottom:8px; flex-shrink:0;">
                    <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                        <span style="font-size:12px; color:#6c757d; font-weight:500;">by</span>
                        <span style="font-size:13px; color:#495057; font-weight:600;">${this.currentNotebook.displayname}</span>
                    </div>
                </div>
                ` : ''}
                
                ${this.currentNotebook.creationDate || this.currentNotebook.totalLines ? `
                <div style="background:#f8f9fa; border-radius:6px; padding:10px; margin-bottom:8px; border:1px solid #e9ecef; flex-shrink:0;">
                    <div style="display:flex; flex-direction:row; gap:12px;">
                        ${this.currentNotebook.creationDate ? `
                        <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
                            <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Creation Date</div>
                            <div style="font-size:13px; font-weight:600; color:#495057;">${this.currentNotebook.creationDate.split(' ')[0]}</div>
                        </div>
                        ` : ''}
                        ${this.currentNotebook.totalLines ? `
                        <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
                            <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Total Lines</div>
                            <div style="font-size:13px; font-weight:600; color:#495057;">${this.currentNotebook.totalLines.toLocaleString()}</div>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ` : ''}
                
                <div style="background:#f8f9fa; border-radius:6px; padding:10px; margin-bottom:8px; border:1px solid #e9ecef; flex-shrink:0;">
                    <div style="display:flex; flex-direction:row; gap:12px;">
                        <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
                            <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Total Cells</div>
                            <div style="font-size:13px; font-weight:600; color:#495057;">${total}</div>
                        </div>
                        <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
                            <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Code Cells</div>
                            <div style="font-size:13px; font-weight:600; color:#495057;">${codeCount}</div>
                        </div>
                        <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
                            <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Md Cells</div>
                            <div style="font-size:13px; font-weight:600; color:#495057;">${mdCount}</div>
                        </div>
                    </div>
                </div>
                
                ${this.createTOCSection()}
            </div>
            
            <style>
                .kaggle-link:hover {
                    opacity: 0.8;
                }
                /* TOC滚动条样式 */
                .toc-scroll::-webkit-scrollbar {
                    width: 6px;
                }
                .toc-scroll::-webkit-scrollbar-track {
                    background: #f8f9fa;
                    border-radius: 3px;
                }
                .toc-scroll::-webkit-scrollbar-thumb {
                    background: #dee2e6;
                    border-radius: 3px;
                }
                .toc-scroll::-webkit-scrollbar-thumb:hover {
                    background: #adb5bd;
                }
                /* TOC项目悬停效果 */
                .toc-item:hover {
                    background: #e3f2fd !important;
                    color: #1565c0 !important;
                }
            </style>
        `;
        
        // 绑定TOC项目点击事件
        setTimeout(() => {
            const tocItems = this.node.querySelectorAll('.toc-item');
            tocItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const cellId = (item as HTMLElement).getAttribute('data-cell-id');
                    if (cellId) {
                        window.dispatchEvent(new CustomEvent('galaxy-simple-toc-item-clicked', {
                            detail: { cellId: cellId }
                        }));
                    }
                });
            });
        }, 0);
    }



    private createTOCSection(): string {
        return `
            <div style="flex:1; min-height:0; display:flex; flex-direction:column;">
                ${this.currentNotebook?.toc && this.currentNotebook.toc.length > 0 ? `
                <div style="flex:1; min-height:0; display:flex; flex-direction:column;">
                    <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 6H20M4 10H20M4 14H20M4 18H20" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Table of Contents
                    </div>
                    <div class="toc-scroll" style="background:#fff; border-radius:6px; padding:12px; flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                        ${this.currentNotebook.toc.map((item: TOCItem) => {
                            // 统计#数量，决定层级
                            const match = item.heading.match(/^(#+)\s+/);
                            const level = match ? match[1].length : 1;
                            const marginLeft = 10 * (level - 1);
                            const fontSize = level === 1 ? 13 : (level === 2 ? 12 : 11);
                            const fontWeight = level === 1 ? 600 : (level === 2 ? 500 : 400);
                            const color = level === 1 ? '#1976d2' : (level === 2 ? '#1565c0' : '#6c757d');
                            const padding = level === 1 ? '4px 0' : (level === 2 ? '3px 0' : '2px 0');
                            return `
                                <div style="margin-bottom:1px; margin-left:${marginLeft}px;">
                                    <div class="toc-item" data-cell-id="${item.cellId}" 
                                         style="color:${color}; font-size:${fontSize}px; font-weight:${fontWeight}; cursor:pointer; line-height:1.3; padding:${padding}; border-radius:3px; transition:all 0.2s ease;"
                                         onmouseover="this.style.background='#e3f2fd'; this.style.color='#1565c0';"
                                         onmouseout="this.style.background='transparent'; this.style.color='${color}';">
                                        ${item.heading.replace(/^#+\s*/, '')}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                ` : `
                <div style="flex:1; min-height:0; display:flex; flex-direction:column;">
                    <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 6H20M4 10H20M4 14H20M4 18H20" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
                        Table of Contents
                    </div>
                    <div style="background:#fff; border-radius:6px; padding:12px; color:#6c757d; font-size:12px; text-align:center; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05); flex:1; min-height:0; display:flex; align-items:center; justify-content:center;">
                        No table of contents available for this notebook.
                    </div>
                </div>
                `}
            </div>
        `;
    }



    // 清除当前notebook信息
    public clearNotebook() {
        this.currentNotebook = null;
        this.render();
    }
} 