import { Widget } from '@lumino/widgets';
import { RenderMimeRegistry, standardRendererFactories } from '@jupyterlab/rendermime';
import { colorMap } from './colorMap';
import { LABEL_MAP } from './labelMap';

// 动态插入 JupyterLab 主题样式（只插入一次）
function ensureJupyterlabThemeStyle() {
  const styleId = 'jupyterlab-theme-style';
  if (!document.getElementById(styleId)) {
    const link = document.createElement('link');
    link.id = styleId;
    link.rel = 'stylesheet';
    // 使用light主题
    link.href = 'https://unpkg.com/@jupyterlab/theme-light-extension/style/theme.css';
    document.head.appendChild(link);
  }
}

type Cell = {
    cellId: string;
    cellType: string;
    source?: string;
    code?: string;
    outputs?: any[];
    "1st-level label"?: string;
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

export class SimpleNotebookDetailWidget extends Widget {
    private notebook: Notebook;
    private rendermime: RenderMimeRegistry;
    private prismLoaded: boolean = false;
    private tocClickHandler: (event: Event) => void;

    constructor(notebook: Notebook) {
        super();
        this.notebook = notebook;
        (this as any).notebook = notebook; // 让外部 handleTabSwitch 能直接访问
        
        const nbId = notebook.kernelVersionId;
        this.id = 'simple-notebook-detail-widget-' + nbId;
        
        // 设置tab标题为"Simple Notebook+对应的序号"
        const notebookIndex = notebook.globalIndex !== undefined ? notebook.globalIndex : 
                             notebook.index !== undefined ? notebook.index + 1 : 
                             'unknown';
        this.title.label = `Notebook ${notebookIndex}`;
        this.title.closable = true;
        this.addClass('simple-notebook-detail-widget');
        
        this.rendermime = new RenderMimeRegistry({
            initialFactories: standardRendererFactories
        });

        // 加载 Prism.js
        this.loadPrismJS();

        // 触发事件通知SimpleInfoSidebar更新
        window.dispatchEvent(new CustomEvent('galaxy-simple-notebook-detail-opened', {
            detail: {
                notebook: notebook
            }
        }));

        // 监听TOC点击事件
        this.tocClickHandler = this.handleTocClick.bind(this);
        window.addEventListener('galaxy-simple-toc-item-clicked', this.tocClickHandler);

        // 监听widget关闭事件 - 合并所有disposed事件处理
        this.disposed.connect(() => {
            // 触发事件通知SimpleInfoSidebar清除notebook信息
            window.dispatchEvent(new CustomEvent('galaxy-simple-notebook-detail-closed'));
            // 移除事件监听器
            window.removeEventListener('galaxy-simple-toc-item-clicked', this.tocClickHandler);
        });

        // 监听tab标题变化，作为额外的关闭检测
        this.title.changed.connect(() => {
            if (this.isDisposed) {
                window.dispatchEvent(new CustomEvent('galaxy-simple-notebook-detail-closed'));
            }
        });

        // 监听tab关闭按钮点击事件
        setTimeout(() => {
            this.bindTabCloseListener();
        }, 100);

        // 监听DOM变化，检测tab是否被移除
        this.observeTabRemoval();

        this.render();
    }

    private loadPrismJS() {
        const prismCSS = document.createElement('link');
        prismCSS.rel = 'stylesheet';
        prismCSS.href = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css';
        document.head.appendChild(prismCSS);

        // 加载 Prism 行号插件 CSS
        const lineNumbersCSS = document.createElement('link');
        lineNumbersCSS.rel = 'stylesheet';
        lineNumbersCSS.href = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.css';
        document.head.appendChild(lineNumbersCSS);

        const prismJS = document.createElement('script');
        prismJS.src = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js';
        prismJS.onload = () => {
            // 加载 Python 语言支持
            const pythonScript = document.createElement('script');
            pythonScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js';
            pythonScript.onload = () => {
                // 加载行号插件
                const lineNumbersJS = document.createElement('script');
                lineNumbersJS.src = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.js';
                lineNumbersJS.onload = () => {
                    // 只有当所有插件都加载完成后再 render
                    this.prismLoaded = true; // 设置加载完成标志
                    requestAnimationFrame(() => this.render()); // defer 首次渲染到下一帧
                };
                document.head.appendChild(lineNumbersJS);
            };
            document.head.appendChild(pythonScript);
        };
        document.head.appendChild(prismJS);
    }

    private activatePrismLineNumbers() {
        const Prism = (window as any).Prism;
        if (!Prism) {
            console.warn('Prism object not found.');
            return;
        }
        if (!Prism.plugins || !Prism.plugins.lineNumbers) {
            console.warn('Prism.js lineNumbers plugin not found on Prism.plugins.');
            return;
        }
    
        // 直接对所有代码块进行语法高亮，不使用懒加载
        const codeBlocks = this.node.querySelectorAll('pre code.language-python');
        const totalBlocks = codeBlocks.length;
        
        if (totalBlocks === 0) {
            console.warn('No code blocks found for highlighting');
            return;
        }
        
        // 直接高亮所有代码块
        codeBlocks.forEach((block, i) => {
            if (!block.classList.contains('prism-highlighted')) {
                Prism.highlightElement(block as HTMLElement);
                block.classList.add('prism-highlighted');
            }
        });
    }

    private markdownToHtml(md: string): string {
        // 检测内容是否包含HTML标签
        const hasHtmlTags = this.isHtmlContent(md.trim());
        
        if (hasHtmlTags) {
            // 如果包含HTML标签，先进行markdown转换，但保护HTML标签不被转义
            return this.convertMarkdownWithHtml(md);
        }

        // 纯markdown内容，进行标准转换
        let html = md
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // 标题 - 从6级到1级，避免冲突
        html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
        html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
        html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');

        // 粗体和斜体
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // 链接
        html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');

        // 代码块
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 换行
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    private convertMarkdownWithHtml(md: string): string {
        // 临时替换HTML标签，避免被转义
        const htmlPlaceholders: { [key: string]: string } = {};
        let placeholderCounter = 0;
        
        // 保存HTML标签
        md = md.replace(/<[^>]+>/g, (match) => {
            const placeholder = `__HTML_PLACEHOLDER_${placeholderCounter}__`;
            htmlPlaceholders[placeholder] = match;
            placeholderCounter++;
            return placeholder;
        });

        // 进行markdown转换
        let html = md
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // 标题 - 从6级到1级，避免冲突
        html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
        html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
        html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');

        // 粗体和斜体
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // 链接
        html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');

        // 代码块
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 换行
        html = html.replace(/\n/g, '<br>');

        // 恢复HTML标签
        Object.keys(htmlPlaceholders).forEach(placeholder => {
            html = html.replace(placeholder, htmlPlaceholders[placeholder]);
        });

        return html;
    }

    private isHtmlContent(content: string): boolean {
        // 检测内容是否包含HTML标签
        const htmlTagRegex = /<[^>]+>/;
        const commonHtmlTags = [
            '<div', '<span', '<p', '<h1', '<h2', '<h3', '<h4', '<h5', '<h6',
            '<ul', '<ol', '<li', '<table', '<tr', '<td', '<th', '<thead', '<tbody',
            '<a', '<img', '<br', '<hr', '<strong', '<b', '<em', '<i', '<code', '<pre',
            '<blockquote', '<section', '<article', '<header', '<footer', '<nav',
            '<font', '<center', '<marquee', '<s', '<strike', '<u', '<sub', '<sup',
            '<small', '<big', '<tt', '<kbd', '<samp', '<var', '<cite', '<dfn', '<abbr',
            '<acronym', '<q', '<ins', '<del', '<mark', '<time', '<ruby', '<rt', '<rp'
        ];
        
        // 检查是否包含HTML标签
        if (htmlTagRegex.test(content)) {
            // 进一步检查是否包含常见的HTML标签
            return commonHtmlTags.some(tag => content.toLowerCase().includes(tag.toLowerCase()));
        }
        
        return false;
    }

    private simpleMarkdownRender(md: string): string {
        // 支持 # ## ### #### ##### ######、**bold**、*italic*、[text](url)、换行
        let html = md
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        // 标题 - 从6级到1级，避免冲突
        html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
        html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
        html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
        html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    private render() {
        // 记录滚动位置
        let prevScrollTop = 0;
        const prevCellList = this.node.querySelector('#snbd-cell-list-scroll');
        if (prevCellList) {
            prevScrollTop = prevCellList.scrollTop;
        }
        const nb = this.notebook;

        // 渲染主结构 - 使用与NotebookDetailWidget相同的布局
        this.node.innerHTML = `
            <div style="padding:24px; max-width:900px; margin:0 auto; height:100%; box-sizing:border-box; display:flex; flex-direction:column; position:relative;">
                <div style="flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:18px; overflow-y:auto; height:100%;" id="snbd-cell-list-scroll"></div>
            </div>
            <style>
                .snbd-tag { display:inline-block; border-radius:3px; padding:1px 7px; font-size:12px; margin-right:2px; }
                .snbd-breadcrumb:hover { text-decoration:underline; color:#1976d2; }
                .snbd-kw { color:#1976d2; font-weight:bold; }
                .snbd-str { color:#c41a16; }
                .snbd-cmt { color:#888; font-style:italic; }
                .snbd-md-area {
                    all: initial;
                    font-family: var(--jp-ui-font-family, 'SF Pro', 'Segoe UI', 'Arial', sans-serif);
                    font-size: 14px;
                    color: #222;
                    background: #fff;
                    border-radius: 4px;
                    padding: 10px 12px;
                    word-break: break-word;
                    min-width: 0;
                    white-space: pre-wrap;
                    box-sizing: border-box;
                    display: block;
                }
                .snbd-md-area * {
                    all: unset;
                    font-family: inherit;
                    font-size: inherit;
                    color: inherit;
                    box-sizing: border-box;
                }
                .snbd-md-area a { color: #1976d2; text-decoration: underline; cursor: pointer; }
                .snbd-md-area h1 { font-size: 1.5em; font-weight: bold; margin: 0.5em 0; }
                .snbd-md-area h2 { font-size: 1.2em; font-weight: bold; margin: 0.4em 0; }
                .snbd-md-area h3 { font-size: 1em; font-weight: bold; margin: 0.3em 0; }
                .snbd-md-area b { font-weight: bold; }
                .snbd-md-area i { font-style: italic; }
                .snbd-md-area code { font-family: var(--jp-code-font-family, monospace); background: #f7f7fa; padding: 0 2px; border-radius: 2px; }
                
                /* 覆盖Prism.js的line-height，使用默认值 */
                pre.line-numbers,
                pre.line-numbers code {
                    line-height: normal !important;
                }
            </style>
        `;

        // 渲染cell内容
        const cellList = this.node.querySelector('#snbd-cell-list-scroll');
        if (cellList) {
            cellList.innerHTML = '';
            (nb.cells ?? []).forEach((cell: any, i: number) => {
                const stage = String(cell["1st-level label"] ?? 'None');
                const stageColor = colorMap.get(stage) || '#fff';
                const content = cell.source ?? cell.code ?? '';
                
                // cell外层div
                const wrapper = document.createElement('div');
                wrapper.id = `snbd-cell-row-${i}`;
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'row';
                wrapper.style.alignItems = 'stretch';
                
                // 左侧序号栏
                const left = document.createElement('div');
                left.style.position = 'relative';
                left.style.minWidth = '36px';
                left.style.marginRight = '8px';
                left.style.height = '100%';
                
                const idxDiv = document.createElement('div');
                idxDiv.style.color = '#888';
                idxDiv.style.fontSize = '15px';
                idxDiv.style.textAlign = 'right';
                idxDiv.style.userSelect = 'none';
                idxDiv.style.lineHeight = '1.6';
                idxDiv.style.marginLeft = '8px';
                idxDiv.style.display = 'flex';
                idxDiv.style.flexDirection = 'column';
                idxDiv.style.alignItems = 'flex-end';
                idxDiv.textContent = `[${i + 1}]`;
                left.appendChild(idxDiv);

                // cell内容区
                const cellDiv = document.createElement('div');
                cellDiv.className = 'snbd-cell';
                cellDiv.setAttribute('contenteditable', 'false'); // 禁止编辑
                cellDiv.style.flex = '1 1 0';
                cellDiv.style.minWidth = '0';
                cellDiv.style.display = 'flex';
                cellDiv.style.borderRadius = '6px';
                cellDiv.style.boxShadow = '0 1px 4px #0001';
                cellDiv.style.background = '#fff';
                
                // stage色条
                const colorBar = document.createElement('div');
                colorBar.style.width = '6px';
                colorBar.style.borderRadius = '6px 0 0 6px';
                colorBar.style.background = stageColor;
                colorBar.style.marginRight = '0';
                cellDiv.appendChild(colorBar);
                
                // 内容区
                const contentDiv = document.createElement('div');
                contentDiv.style.flex = '1';
                contentDiv.style.padding = '14px 18px 10px 14px';
                contentDiv.style.minWidth = '0';
                
                // 渲染内容
                if (cell.cellType === 'markdown') {
                    try {
                        // 确保JupyterLab样式已加载
                        ensureJupyterlabThemeStyle();

                        // 统一使用markdownToHtml方法处理，它会自动检测并处理混合内容
                        const htmlWidget = this.rendermime.createRenderer('text/html');
                        const htmlContent = this.markdownToHtml(content);

                        const model = this.rendermime.createModel({
                            data: { 'text/html': htmlContent },
                            metadata: {},
                            trusted: true
                        });

                        if (htmlWidget && htmlWidget.node) {
                            htmlWidget.renderModel(model);
                            contentDiv.appendChild(htmlWidget.node);
                        } else {
                            throw new Error('HTML widget not properly initialized');
                        }
                    } catch (error) {
                        console.error('HTML rendering failed for cell:', i, 'error:', error);
                        // 如果JupyterLab渲染器失败，使用简单的HTML渲染
                        const fallbackDiv = document.createElement('div');
                        fallbackDiv.className = 'snbd-md-area';
                        fallbackDiv.innerHTML = this.simpleMarkdownRender(content);
                        contentDiv.appendChild(fallbackDiv);
                    }
                } else if (cell.cellType === 'code') {
                    // 为code cell添加stage tag
                    const stageTag = document.createElement('div');
                    stageTag.style.display = 'flex';
                    stageTag.style.alignItems = 'center';
                    stageTag.style.marginBottom = '8px';
                    stageTag.style.fontSize = '11px';
                    stageTag.style.fontWeight = '600';
                    stageTag.style.color = stageColor; // 直接使用stage对应的颜色
                    stageTag.style.textTransform = 'uppercase';
                    stageTag.style.letterSpacing = '0.5px';
                    
                    const tagText = document.createElement('span');
                    tagText.textContent = LABEL_MAP[stage] || stage; // 使用LABEL_MAP映射到具体的stage名称
                    
                    stageTag.appendChild(tagText);
                    contentDiv.appendChild(stageTag);
                    
                    // 创建代码内容 - 使用 Prism.js 官方行号插件
                    const preElement = document.createElement('pre');
                    preElement.classList.add('line-numbers');
                    preElement.style.margin = '0';
                    preElement.style.background = 'transparent';
                    preElement.style.border = 'none';
                    preElement.style.fontFamily = 'var(--jp-code-font-family, "SF Mono", "Monaco", "Consolas", monospace)';
                    preElement.style.fontSize = '13px';

                    const codeElement = document.createElement('code');
                    codeElement.className = 'language-python';
                    codeElement.textContent = content;

                    preElement.appendChild(codeElement);
                    contentDiv.appendChild(preElement);
                } else {
                    // 其它类型直接显示
                    contentDiv.textContent = content;
                }
                
                cellDiv.appendChild(contentDiv);
                wrapper.appendChild(left);
                wrapper.appendChild(cellDiv);
                cellList.appendChild(wrapper);
            });
        }

        // 恢复滚动位置
        setTimeout(() => {
            if (cellList && typeof prevScrollTop === 'number') {
                cellList.scrollTop = prevScrollTop;
            }
            
            // 延迟高亮执行,确保 DOM 完成后再运行
            // 只有当 Prism.js 已经加载完成时才尝试激活行号
            if (this.prismLoaded) {
                // 直接激活所有代码块的语法高亮
                setTimeout(() => {
                    this.activatePrismLineNumbers();
                }, 30);
            }
        }, 0);
    }

    private handleTocClick(event: Event): void {
        const customEvent = event as CustomEvent;
        const cellId = customEvent.detail?.cellId;
        if (cellId) {
            // 找到对应的cell并滚动到它
            const cellElement = this.node.querySelector(`#snbd-cell-row-${this.findCellIndexById(cellId)}`);
            if (cellElement) {
                cellElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    private findCellIndexById(cellId: string): number {
        // 直接匹配cellId字符串
        for (let i = 0; i < this.notebook.cells.length; i++) {
            if (this.notebook.cells[i].cellId === cellId) {
                return i;
            }
        }
        return -1;
    }

    private bindTabCloseListener(): void {
        // 查找当前widget对应的tab关闭按钮
        const tabCloseButton = document.querySelector(`[data-id="${this.id}"] .lm-TabBar-tabCloseIcon`);
        if (tabCloseButton) {
            tabCloseButton.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                window.dispatchEvent(new CustomEvent('galaxy-simple-notebook-detail-closed'));
            });
        } else {
            // 尝试延迟查找
            setTimeout(() => {
                const delayedTabCloseButton = document.querySelector(`[data-id="${this.id}"] .lm-TabBar-tabCloseIcon`);
                if (delayedTabCloseButton) {
                    delayedTabCloseButton.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('galaxy-simple-notebook-detail-closed'));
                    });
                }
            }, 500);
        }
    }

    private observeTabRemoval(): void {
        // 监听DOM变化，检测tab是否被移除
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.removedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node as Element;
                            if (element.getAttribute('data-id') === this.id) {
                                window.dispatchEvent(new CustomEvent('galaxy-simple-notebook-detail-closed'));
                            }
                        }
                    });
                }
            });
        });

        // 监听所有tab bar的变化
        const tabBars = document.querySelectorAll('.lm-TabBar-content');
        tabBars.forEach(tabBar => {
            observer.observe(tabBar, { childList: true, subtree: true });
        });

        // 在widget销毁时停止观察
        this.disposed.connect(() => {
            observer.disconnect();
        });
    }
} 