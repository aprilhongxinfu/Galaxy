import { Widget } from '@lumino/widgets';
// import { LABEL_MAP } from './labelMap';
import { colorMap } from './colorMap';
import { RenderMimeRegistry, standardRendererFactories } from '@jupyterlab/rendermime';


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

export class NotebookDetailWidget extends Widget {
  private notebook: any;
  private selectedCellIdx: number | null = null;
  private stageHoverHandler: (event: Event) => void;
  private transitionHoverHandler: (event: Event) => void;
  private clearCellSelectionHandler: () => void;
  private notebookSelectedHandler: (event: Event) => void;
  private selectionClearedHandler: (event: Event) => void;
  private stageSelectedHandler: (event: Event) => void;
  private flowSelectedHandler: (event: Event) => void;
  private rendermime: RenderMimeRegistry;
  private prismLoaded: boolean = false; // 用于判断 Prism.js 是否加载完成
  private jumpHandler: (event: Event) => void;
  private minimapEventsBound: boolean = false;
  private prismObserver: IntersectionObserver | null = null; // 添加 Prism 观察器引用
  private cellSelectionUpdatePending: boolean = false; // 防止重复调用 updateCellSelection

  // 获取当前tab ID
  private getTabId(): string {
    // 使用 widget 的 ID 作为唯一标识
    return this.id || `notebook_${this.notebook?.kernelVersionId || this.notebook?.index || Date.now()}`;
  }

  constructor(notebook: any) {
    super();
    this.notebook = notebook;
    (this as any).notebook = notebook; // 让外部 handleTabSwitch 能直接访问
    const nbId = notebook.kernelVersionId;
    this.id = 'notebook-detail-widget-' + nbId;
    
    // 设置tab标题为"notebook+对应的序号"
    const notebookIndex = notebook.globalIndex !== undefined ? notebook.globalIndex + 1 : 
                         notebook.index !== undefined ? notebook.index + 1 : 
                         'unknown';
    this.title.label = `Notebook ${notebookIndex}`;
    this.title.closable = true;
    this.addClass('notebook-detail-widget');
    this.rendermime = new RenderMimeRegistry({
      initialFactories: standardRendererFactories
    });

    // 加载 Prism.js
    this.loadPrismJS();

    // 确保markdown渲染器可用
    // 检查是否有text/x-python渲染器
    if (!this.rendermime.mimeTypes.includes('text/x-python')) {
      // text/x-python renderer not available, will use text/plain with syntax highlighting
    }

    // 初始化时不选中任何cell
    this.selectedCellIdx = null;

    // 绑定事件处理器
    this.stageHoverHandler = this.handleStageHover.bind(this);
    this.transitionHoverHandler = this.handleTransitionHover.bind(this);
    this.clearCellSelectionHandler = this.handleClearCellSelection.bind(this);
    this.selectionClearedHandler = (e: Event) => {
      const tabId = (e as CustomEvent).detail?.tabId;
      if (tabId === this.getTabId()) {
        const cellList = this.node.querySelector('#nbd-cell-list-scroll');
        const prevScrollTop = cellList ? cellList.scrollTop : 0;
        this.render(false);
        setTimeout(() => {
          const cellList = this.node.querySelector('#nbd-cell-list-scroll');
          if (cellList) cellList.scrollTop = prevScrollTop;
        }, 0);
      }
    };
    this.stageSelectedHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const tabId = this.getTabId();
      
      // 检查事件是否包含 tabId，如果包含且不匹配当前 tab，则跳过
      if (detail && detail.tabId) {
        // 尝试匹配不同的 tabId 格式
        const eventTabId = detail.tabId;
        const currentTabId = tabId;
        
        // 如果事件 tabId 是 notebook_X 格式，检查是否匹配当前 notebook
        if (eventTabId.startsWith('notebook_')) {
          const eventIndex = eventTabId.replace('notebook_', '');
          const currentIndex = this.notebook.index?.toString() || this.notebook.globalIndex?.toString();
          if (eventIndex !== currentIndex) {
            return;
          }
        } else if (eventTabId !== currentTabId) {
          return;
        }
      }
      
      if (detail && detail.stage) {
        const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
        (window as any)[stageSelectionKey] = detail.stage;
        
        // 使用局部更新而不是全量 render
        this.updateMinimapHighlight();
        this.updateNavigationControls();
      }
    };
    this.flowSelectedHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const tabId = this.getTabId();
      
      // 检查事件是否包含 tabId，如果包含且不匹配当前 tab，则跳过
      if (detail && detail.tabId) {
        // 尝试匹配不同的 tabId 格式
        const eventTabId = detail.tabId;
        const currentTabId = tabId;
        
        // 如果事件 tabId 是 notebook_X 格式，检查是否匹配当前 notebook
        if (eventTabId.startsWith('notebook_')) {
          const eventIndex = eventTabId.replace('notebook_', '');
          const currentIndex = this.notebook.index?.toString() || this.notebook.globalIndex?.toString();
          if (eventIndex !== currentIndex) {
            return;
          }
        } else if (eventTabId !== currentTabId) {
          return;
        }
      }
      
      if (detail && detail.from && detail.to) {
        const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
        (window as any)[flowSelectionKey] = { from: detail.from, to: detail.to };
        
        // 使用局部更新而不是全量 render
        this.updateMinimapHighlight();
        this.updateNavigationControls();
      }
    };

    // 监听 matrix 跳转事件
    this.jumpHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.notebookIndex !== undefined && detail.cellIndex !== undefined) {
        // 检查是否是当前 notebook 的跳转
        const currentNotebookIndex = this.notebook.index;
        const targetNotebookIndex = detail.notebookIndex;
        
        // 转换为字符串进行比较，避免类型不匹配的问题
        const currentIndexStr = currentNotebookIndex?.toString();
        const targetIndexStr = targetNotebookIndex?.toString();
        
        // 如果索引不匹配，跳过（但允许 undefined 的情况）
        if (currentIndexStr !== undefined && targetIndexStr !== undefined && 
            currentIndexStr !== targetIndexStr) {
          return;
        }
        
        this.selectedCellIdx = detail.cellIndex;
        // 使用局部更新而不是全量 render
        this.updateMinimapHighlight();
        this.updateCellSelection();
        this.updateNavigationControls();
        
        setTimeout(() => {
          const cellList = this.node.querySelector('#nbd-cell-list-scroll');
          if (!cellList) return;
          const cellDivs = cellList.querySelectorAll('.nbd-cell');
          const target = cellDivs[detail.cellIndex]?.parentElement as HTMLElement;
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            target.style.background = 'linear-gradient(90deg, #f0f8ff 0%, #e6f3ff 100%)';
            target.style.transition = 'background 0.4s ease';
            setTimeout(() => {
              target.style.background = '';
              target.style.transition = '';
            }, 1000);
          }
        }, 0);
      }
    };
    // 监听 notebook 切换时的 cell 跳转请求
    this.notebookSelectedHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.jumpCellIndex !== undefined) {
        // 检查是否是当前 notebook 的跳转
        const currentNotebookIndex = this.notebook.index;
        const targetNotebookIndex = detail.notebook.index;
        
        // 转换为字符串进行比较，避免类型不匹配的问题
        const currentIndexStr = currentNotebookIndex?.toString();
        const targetIndexStr = targetNotebookIndex?.toString();
        
        // 如果索引匹配或者是 undefined 的情况，允许跳转
        if (currentIndexStr === targetIndexStr || 
            currentIndexStr === undefined || 
            targetIndexStr === undefined) {
          window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
            detail: { notebookIndex: detail.notebook.index, cellIndex: detail.jumpCellIndex }
          }));
        }
      }
    };
    window.addEventListener('galaxy-notebook-selected', this.notebookSelectedHandler);
  }

  onAfterAttach(): void {
    // 监听全局悬浮事件
    window.addEventListener('galaxy-stage-hover', this.stageHoverHandler);
    window.addEventListener('galaxy-transition-hover', this.transitionHoverHandler);
    window.addEventListener('galaxy-clear-cell-selection', this.clearCellSelectionHandler);

    // 监听选中状态清除事件
    window.addEventListener('galaxy-selection-cleared', this.selectionClearedHandler);

    // 监听筛选状态变化，重新渲染以显示跳转控件
    window.addEventListener('galaxy-flow-selection-changed', () => {
      requestAnimationFrame(() => this.render());
    });

    // 监听stage选中事件，重新渲染以显示筛选控件
    window.addEventListener('galaxy-stage-selected', this.stageSelectedHandler);

    // 监听flow选中事件，重新渲染以显示筛选控件
    window.addEventListener('galaxy-flow-selected', this.flowSelectedHandler);

    // 监听 matrix 跳转事件
    window.addEventListener('galaxy-notebook-detail-jump', this.jumpHandler);

    // 如果 Prism.js 已经加载完成，defer 渲染到下一帧
    if (this.prismLoaded) {
      requestAnimationFrame(() => this.render());
    }
  }

  onBeforeDetach(): void {
    // 移除事件监听器
    window.removeEventListener('galaxy-stage-hover', this.stageHoverHandler);
    window.removeEventListener('galaxy-transition-hover', this.transitionHoverHandler);
    window.removeEventListener('galaxy-clear-cell-selection', this.clearCellSelectionHandler);
    window.removeEventListener('galaxy-notebook-selected', this.notebookSelectedHandler);
    // 移除选中状态清除事件监听器
    window.removeEventListener('galaxy-selection-cleared', this.selectionClearedHandler);
    // 移除筛选事件监听器
    window.removeEventListener('galaxy-stage-selected', this.stageSelectedHandler);
    window.removeEventListener('galaxy-flow-selected', this.flowSelectedHandler);
    // 移除跳转事件监听器
    window.removeEventListener('galaxy-notebook-detail-jump', this.jumpHandler);

    // 清理 Prism.js 观察器
    if (this.prismObserver) {
      this.prismObserver.disconnect();
      this.prismObserver = null;
    }
  }

  private handleStageHover(event: Event): void {
    const stage = (event as CustomEvent).detail.stage;
    const tabId = this.getTabId();
    // 记录当前 flow chart 悬浮 stage（按 tab 隔离）
    (window as any)[`_galaxyFlowHoverStage_${tabId}`] = stage;
    // 清除flow信息（当stage筛选时）
    if (!stage) {
      (window as any)[`_galaxyFlowHoverInfo_${tabId}`] = null;
    }
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;
    // 检查是否来自 minimap 内部的 hover
    const isFromMinimap = (event as any).detail?.source === 'minimap';
    const hoveredIdx = (event as any).detail?.cellIdx;

    // 检查是否有选中状态，如果有则不添加高亮
    const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
    const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
    const hasSelection = (window as any)[flowSelectionKey] || (window as any)[stageSelectionKey];



    minimapSvg.querySelectorAll('rect').forEach((r) => {
      const rectStage = r.getAttribute('data-stage');
      const rectIdx = parseInt(r.getAttribute('data-idx') || '0');
      // minimap 悬浮时只高亮当前 cell
      if (isFromMinimap) {
        if (hoveredIdx === rectIdx) {
          r.classList.add('minimap-highlight');
        } else {
          // 保持选中cell的高亮
          if (this.selectedCellIdx !== rectIdx) {
            r.classList.remove('minimap-highlight');
          }
        }
      } else if (stage && !hasSelection) {
        // 只有在没有选中状态时才添加高亮
        // flow chart 悬浮时只高亮对应 stage 的 cell
        if (rectStage === stage) {
          r.classList.add('minimap-highlight');
        } else {
          // 保持选中cell的高亮
          if (this.selectedCellIdx !== rectIdx) {
            r.classList.remove('minimap-highlight');
          }
        }
      } else {
        // 没有 flow chart 悬浮时，只清除非选中cell的高亮
        if (this.selectedCellIdx !== rectIdx) {
          r.classList.remove('minimap-highlight');
        }
      }
    });
  }

  private handleTransitionHover(event: Event): void {
    const { from, to } = (event as CustomEvent).detail;
    const tabId = this.getTabId();
    // 记录 flow chart 悬浮（按 tab 隔离）
    (window as any)[`_galaxyFlowHoverStage_${tabId}`] = from && to ? '__flow_transition__' : null;
    // 设置全局flow信息（按 tab 隔离）
    if (from && to) {
      (window as any)[`_galaxyFlowHoverInfo_${tabId}`] = { from, to };
    } else {
      (window as any)[`_galaxyFlowHoverInfo_${tabId}`] = null;
    }
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;

    // 检查是否有选中状态，如果有则不添加高亮
    const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
    const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
    const hasSelection = (window as any)[flowSelectionKey] || (window as any)[stageSelectionKey];



    if (from && to && !hasSelection) {
      // 先重置所有高亮，但保持选中cell的高亮
      minimapSvg.querySelectorAll('rect').forEach((r) => {
        const idx = parseInt(r.getAttribute('data-idx') || '0');
        // 只清除非选中cell的高亮
        if (this.selectedCellIdx !== idx) {
          r.classList.remove('minimap-highlight');
        }
        const cells = this.notebook.cells ?? [];
        if (cells[idx]?.cellType === 'markdown') {
          r.setAttribute('stroke', '#ccc');
          r.setAttribute('stroke-width', '1');
        } else {
          r.setAttribute('stroke-width', '1');
        }
      });

      // 找到所有 from→to 的转换并高亮（包括跨越markdown cell的）
      const cells = this.notebook.cells ?? [];
      const transitionPairs: number[][] = [];

      // 查找所有符合transition的cell对（忽略中间的markdown cell）
      for (let i = 0; i < cells.length; i++) {
        const currStage = String(cells[i]["1st-level label"] ?? 'None');
        if (currStage === from) {
          // 向后查找下一个to stage的cell（跳过markdown cell）
          for (let j = i + 1; j < cells.length; j++) {
            const nextStage = String(cells[j]["1st-level label"] ?? 'None');
            if (nextStage === to) {
              transitionPairs.push([i, j]);
              break; // 找到第一个匹配的就停止
            } else if (nextStage !== 'None') {
              // 如果遇到其他stage，停止搜索
              break;
            }
            // 如果是markdown cell或None，继续搜索
          }
        }
      }

      // 高亮所有找到的transition pairs
      transitionPairs.forEach(([fromIdx, toIdx]) => {
        // 向前找连续的 from
        let i0 = fromIdx;
        while (i0 > 0 && String(cells[i0 - 1]["1st-level label"] ?? 'None') === from) i0--;

        // 向后找连续的 to
        let i1 = toIdx;
        while (i1 + 1 < cells.length && String(cells[i1 + 1]["1st-level label"] ?? 'None') === to) i1++;

        // 高亮完整的transition中的所有code cell（从from段开始到to段结束）
        for (let j = i0; j <= i1; j++) {
          const rect = minimapSvg.querySelector(`rect[data-idx="${j}"]`) as SVGElement;
          if (rect) {
            const cell = cells[j];
            // 只高亮code cell
            if (cell.cellType === 'code') {
              const stageColor = colorMap.get(String(cell["1st-level label"] ?? 'None')) || '#bbb';
              rect.setAttribute('stroke', stageColor);
              rect.setAttribute('stroke-width', '1');
              rect.classList.add('minimap-highlight');
              if (rect.parentNode) rect.parentNode.appendChild(rect);
            }
          }
        }
      });
    } else {
      // 取消高亮，还原所有状态
      this.handleStageHover({ detail: { stage: null, source: 'transition' } } as CustomEvent);
    }
  }

  private handleClearCellSelection() {
    this.selectedCellIdx = null;
    // 清除当前 tab 的筛选状态
    const tabId = this.getTabId();
    (window as any)[`_galaxyFlowHoverStage_${tabId}`] = null;
    (window as any)[`_galaxyFlowHoverInfo_${tabId}`] = null;
    
    // 使用局部更新而不是全量 render
    this.updateMinimapHighlight();
    this.updateCellSelection();
    this.updateNavigationControls();
  }



  private scrollToSelectedCell() {
    setTimeout(() => {
      if (this.selectedCellIdx == null) return;
      // 只在当前 tab 中查找目标元素，避免滚动到其他 tab
      const target = this.node.querySelector('#nbd-cell-row-' + this.selectedCellIdx) as HTMLElement;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        target.style.background = 'linear-gradient(90deg, #f0f8ff 0%, #e6f3ff 100%)';
        target.style.transition = 'background 0.4s ease';
        setTimeout(() => {
          target.style.background = '';
          target.style.transition = '';
        }, 1000);
      }
    }, 40);
  }

  private simpleMarkdownRender(md: string): string {
    // 支持 # ## ###、**bold**、*italic*、[text](url)、换行
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
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
  
    // 懒加载高亮：只对前10个代码块或可视区域进行初始高亮
    const codeBlocks = this.node.querySelectorAll('pre code.language-python');
    codeBlocks.forEach((block, i) => {
      if (i < 10 || block.closest('#nbd-cell-row-0')) {
        Prism.highlightElement(block as HTMLElement);
        block.classList.add('prism-highlighted');
      }
    });

    // 使用 IntersectionObserver 监听滚动，对进入可视区域的代码块进行懒加载高亮
    this.prismObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const codeBlock = entry.target as HTMLElement;
          if (!codeBlock.classList.contains('prism-highlighted')) {
            Prism.highlightElement(codeBlock);
            codeBlock.classList.add('prism-highlighted');
          }
          this.prismObserver?.unobserve(entry.target);
        }
      });
    }, {
      root: this.node.querySelector('#nbd-cell-list-scroll'),
      rootMargin: '50px', // 提前50px开始高亮
      threshold: 0.1
    });

    // 观察所有未高亮的代码块
    codeBlocks.forEach((block) => {
      if (!block.classList.contains('prism-highlighted')) {
        this.prismObserver?.observe(block);
      }
    });
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

  private markdownToHtml(md: string): string {
    // 更完整的markdown转HTML，用于JupyterLab HTML渲染器
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 标题
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

  private render(autoScroll: boolean = true) {
    // 记录滚动位置
    let prevScrollTop = 0;
    const prevCellList = this.node.querySelector('#nbd-cell-list-scroll');
    if (prevCellList) {
      prevScrollTop = prevCellList.scrollTop;
    }
    const nb = this.notebook;
    // let nbIdx = '';
    // if (nb.path && /\d+/.test(nb.path)) {
    //   nbIdx = nb.path.match(/\d+/)![0];
    // } else if (nb.index !== undefined) {
    //   nbIdx = String(nb.index + 1);
    // }
    // 获取当前筛选状态（优先使用选中状态，其次使用hover状态）
    const tabId = this.getTabId();
    const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
    const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
    const currentFlowSelection = (window as any)[flowSelectionKey];
          const currentStageSelection = (window as any)[stageSelectionKey];
      const currentFlowHoverStage = (window as any)[`_galaxyFlowHoverStage_${tabId}`];

    // 计算筛选的cell索引
    let filteredCellIndices: number[] = [];

    // 只使用选中状态，不使用hover状态来显示导航控件
    if (currentStageSelection) {
      // stage 选中筛选
      const cells = nb.cells ?? [];
      cells.forEach((cell: any, i: number) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        if (stage === currentStageSelection) {
          filteredCellIndices.push(i);
        }
      });
    } else if (currentFlowSelection && currentFlowSelection.from && currentFlowSelection.to) {
      // flow 选中筛选 - 添加所有transition的第一个cell（考虑markdown cell隔开的情况）
      const cells = nb.cells ?? [];
      // 构建stage序列，忽略markdown cell
      const stageSeq: { stage: string; cellIndex: number }[] = [];
      cells.forEach((cell: any, i: number) => {
        if (cell.cellType === 'code') {
          const stage = String(cell["1st-level label"] ?? 'None');
          stageSeq.push({ stage, cellIndex: i });
        }
      });
      // 在stage序列中查找transition
      for (let i = 0; i < stageSeq.length - 1; i++) {
        const currStage = stageSeq[i].stage;
        const nextStage = stageSeq[i + 1].stage;
        if (currStage === currentFlowSelection.from && nextStage === currentFlowSelection.to) {
          filteredCellIndices.push(stageSeq[i].cellIndex); // 添加每个transition的第一个cell
        }
      }
    }
    // 注意：hover状态只用于高亮显示，不用于显示导航控件

    // 计算当前在筛选cell中的位置
    let currentFilteredIndex = -1;
    if (filteredCellIndices.length > 0 && this.selectedCellIdx !== null) {
      currentFilteredIndex = filteredCellIndices.indexOf(this.selectedCellIdx);
    }

    // 先渲染主结构和cell列表容器
    this.node.innerHTML = `
      <div style="padding:24px; max-width:900px; margin:0 auto; height:100%; box-sizing:border-box; display:flex; flex-direction:column; position:relative;">
        ${(() => {
        return filteredCellIndices.length > 0 ? `
        <div style="position:absolute; bottom:20px; left:50%; transform:translateX(-50%); z-index:1000;">
          <div style="display:flex; align-items:center; background:rgba(255,255,255,0.95); backdrop-filter:blur(10px); border:1px solid #e0e0e0; border-radius:20px; padding:8px 12px; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
            <button id="nbd-nav-prev" style="background:none; border:none; cursor:pointer; color:#666; font-size:14px; padding:4px; margin-right:8px; border-radius:4px; transition:all 0.2s; min-width:24px; height:24px; display:flex; align-items:center; justify-content:center;" ${(currentFilteredIndex <= 0 || currentFilteredIndex === -1) ? 'disabled' : ''}>‹</button>
            <span style="color:#333; font-size:12px; font-weight:500; margin:0 8px; min-width:40px; text-align:center;">${currentFilteredIndex >= 0 ? currentFilteredIndex + 1 : 0} / ${filteredCellIndices.length}</span>
            <button id="nbd-nav-next" style="background:none; border:none; cursor:pointer; color:#666; font-size:14px; padding:4px; margin-left:8px; border-radius:4px; transition:all 0.2s; min-width:24px; height:24px; display:flex; align-items:center; justify-content:center;" ${(currentFilteredIndex >= filteredCellIndices.length - 1 && currentFilteredIndex !== -1) ? 'disabled' : ''}>›</button>
            <div style="width:1px; height:16px; background:#e0e0e0; margin:0 8px;"></div>
            <button id="nbd-nav-clear" style="background:none; border:none; cursor:pointer; color:#999; font-size:12px; padding:4px; border-radius:4px; transition:all 0.2s; min-width:24px; height:24px; display:flex; align-items:center; justify-content:center;" title="清除筛选">✕</button>
          </div>
        </div>
        ` : '';
      })()}
        <div style="flex:1 1 auto; min-height:0; display:flex; flex-direction:row; align-items:flex-start; gap:0;">
          <div style="width:20px; margin-right:14px; display:flex; flex-direction:column; justify-content:center; align-self:center; max-height:600px;">
            ${(function () {
        const cells = nb.cells ?? [];
        const gap = 3;
        const minimapSvgWidth = 32;
        const rectX = (minimapSvgWidth - 20) / 2;
        const maxMinimapHeight = 800;
        
        // 计算每个cell的行数和位置
        let currentY = 0;
        const cellRects: { y: number; height: number; cell: any; index: number }[] = [];
        
        cells.forEach((cell: any, i: number) => {
          const content = cell.source ?? cell.code ?? '';
          const lineCount = content.split('\n').length;
          // 根据行数计算高度，最小高度为3，最大高度为25
          const minHeight = 3;
          const maxHeight = 25;
          const baseHeight = 4;
          const height = Math.max(minHeight, Math.min(maxHeight, baseHeight + Math.floor(lineCount / 2)));
          
          cellRects.push({
            y: currentY,
            height: height,
            cell: cell,
            index: i
          });
          
          currentY += height + gap;
        });
        
        const minimapHeight = currentY;
        let svgHeight = minimapHeight;
        // 为stroke留出空间，避免第一个cell的上边框被裁剪
        const strokePadding = 2;
        let viewBox = `0 0 ${minimapSvgWidth} ${minimapHeight + strokePadding}`;
        let style = 'display:block; margin:0 auto; will-change: transform; transform: translateZ(0);';
        if (minimapHeight > maxMinimapHeight) {
          svgHeight = maxMinimapHeight;
          style += ` height:${maxMinimapHeight}px; width:${minimapSvgWidth}px;`;
        } else {
          style += ` height:${minimapHeight}px; width:${minimapSvgWidth}px;`;
        }
        
        const rects = cellRects.map(({ y, height, cell, index }) => {
          const stage = String(cell["1st-level label"] ?? 'None');
          const color = colorMap.get(stage) || '#ccc';
          
          if (cell.cellType === 'markdown') {
            const stroke = '#999';
            const strokeWidth = 1;
            return `<rect x="${rectX}" y="${y + strokePadding/2}" width="20" height="${height}" fill="transparent" stroke="${stroke}" stroke-width="${strokeWidth}" data-stage="${stage}" data-idx="${index}" data-orig-width="20" data-orig-x="${rectX}" style="cursor:pointer; pointer-events: visible;" />`;
          } else {
            const stageColor = colorMap.get(stage) || '#bbb';
            const stroke = stageColor;
            const strokeWidth = 2;
            return `<rect x="${rectX}" y="${y + strokePadding/2}" width="20" height="${height}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" data-stage="${stage}" data-idx="${index}" data-orig-width="20" data-orig-x="${rectX}" style="cursor:pointer; pointer-events: visible;" />`;
          }
        }).join('');
        
        return `<svg width="${minimapSvgWidth}" height="${svgHeight}" viewBox="${viewBox}" style="${style}" preserveAspectRatio="none">${rects}</svg>`;
      })()}
          </div>
          <div style="flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:18px; overflow-y:auto; height:100%;" id="nbd-cell-list-scroll"></div>
        </div>
      </div>
      <style>
        .nbd-tag { display:inline-block; border-radius:3px; padding:1px 7px; font-size:12px; margin-right:2px; }
        .nbd-breadcrumb:hover { text-decoration:underline; color:#1976d2; }
        .nbd-kw { color:#1976d2; font-weight:bold; }
        .nbd-str { color:#c41a16; }
        .nbd-cmt { color:#888; font-style:italic; }
        .nbd-md-area {
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
        .nbd-md-area * {
          all: unset;
          font-family: inherit;
          font-size: inherit;
          color: inherit;
          box-sizing: border-box;
        }
        .nbd-md-area a { color: #1976d2; text-decoration: underline; cursor: pointer; }
        .nbd-md-area h1 { font-size: 1.5em; font-weight: bold; margin: 0.5em 0; }
        .nbd-md-area h2 { font-size: 1.2em; font-weight: bold; margin: 0.4em 0; }
        .nbd-md-area h3 { font-size: 1em; font-weight: bold; margin: 0.3em 0; }
        .nbd-md-area b { font-weight: bold; }
        .nbd-md-area i { font-style: italic; }
        .nbd-md-area code { font-family: var(--jp-code-font-family, monospace); background: #f7f7fa; padding: 0 2px; border-radius: 2px; }
        
        /* 覆盖Prism.js的line-height，使用默认值 */
        pre.line-numbers,
        pre.line-numbers code {
          line-height: normal !important;
        }
      </style>
    `;
    // 渲染cell内容（JupyterLab渲染器）
    const cellList = this.node.querySelector('#nbd-cell-list-scroll');
    if (cellList) {
      cellList.innerHTML = '';
      (nb.cells ?? []).forEach((cell: any, i: number) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        const stageColor = colorMap.get(stage) || '#fff';
        const content = cell.source ?? cell.code ?? '';
        // const isSelected = this.selectedCellIdx === i;
        // cell外层div
        const wrapper = document.createElement('div');
        wrapper.id = `nbd-cell-row-${i}`;
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'row';
        wrapper.style.alignItems = 'stretch';
        // 左侧序号栏
        const left = document.createElement('div');
        left.style.position = 'relative';
        left.style.minWidth = '36px';
        left.style.marginRight = '8px';
        left.style.height = '100%';
        // 蓝色指示器由 updateCellSelection() 统一管理，不在这里创建
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

        // 为code cell添加放大镜图标
        if (cell.cellType === 'code') {
          const detailIcon = document.createElement('div');
          detailIcon.innerHTML = '🔍';
          detailIcon.style.fontSize = '12px';
          detailIcon.style.color = '#999';
          detailIcon.style.cursor = 'pointer';
          detailIcon.style.marginTop = '2px';
          detailIcon.style.textAlign = 'right';
          detailIcon.style.transition = 'color 0.2s';
          detailIcon.title = '查看详情';

          // 添加hover效果
          detailIcon.addEventListener('mouseenter', () => {
            detailIcon.style.color = '#1976d2';
          });
          detailIcon.addEventListener('mouseleave', () => {
            detailIcon.style.color = '#999';
          });

          // 点击显示详情
          detailIcon.addEventListener('click', (e) => {
            // 设置选中状态
            if (this.selectedCellIdx !== i) {
              this.selectedCellIdx = i;
              // 使用局部更新而不是全量 render
              this.updateMinimapHighlight();
              this.updateCellSelection();
              this.updateNavigationControls();
            }

            const cell = this.notebook.cells[i];
            window.dispatchEvent(new CustomEvent('galaxy-cell-detail', {
              detail: {
                cell: {
                  ...cell,
                  notebookIndex: this.notebook.index,
                  cellIndex: i,
                  _notebookDetail: this.notebook
                }
              }
            }));
            e.stopPropagation();
          });

          left.appendChild(detailIcon);
        }
        // cell内容区
        const cellDiv = document.createElement('div');
        cellDiv.className = 'nbd-cell';
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

            // 尝试使用HTML渲染器而不是markdown渲染器
            const htmlWidget = this.rendermime.createRenderer('text/html');

            // 先将markdown转换为HTML
            const htmlContent = this.markdownToHtml(content);

            const model = this.rendermime.createModel({
              data: { 'text/html': htmlContent },
              metadata: {},
              trusted: true
            });

            // 确保渲染器正确初始化
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
            fallbackDiv.className = 'nbd-md-area';
            fallbackDiv.innerHTML = this.simpleMarkdownRender(content);
            contentDiv.appendChild(fallbackDiv);
          }
        } else if (cell.cellType === 'code') {
          // 创建代码内容 - 使用 Prism.js 官方行号插件
          const preElement = document.createElement('pre');
          preElement.classList.add('line-numbers');
          preElement.style.margin = '0';
          // preElement.style.padding = '8px 12px'; // 给行号留出空间
          preElement.style.background = 'transparent';
          preElement.style.border = 'none';
          preElement.style.fontFamily = 'var(--jp-code-font-family, "SF Mono", "Monaco", "Consolas", monospace)';
          preElement.style.fontSize = '13px';
          // preElement.style.lineHeight = '1.2';

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
    // Mini map 色条动态着色
    setTimeout(() => {
      const minimapSvg = this.node.querySelector('svg');
      if (!minimapSvg) return;
      // 只绑定一次 hover 事件
      this.bindMinimapEvents(prevScrollTop);
      minimapSvg.querySelectorAll('rect').forEach((r, i) => {
        // 选中 cell 永远高亮
        if (this.selectedCellIdx === i) {
          r.classList.add('minimap-highlight');
        } else {
          // 检查是否应该保持来自flowchart的筛选高亮（但不添加高亮类）
          // const rectStage = r.getAttribute('data-stage');
          // let shouldKeepVisible = false;

          // 优先使用选中状态，其次使用hover状态
          if (currentStageSelection) {
            // 来自stage选中筛选
            // shouldKeepVisible = rectStage === currentStageSelection;
          } else if (currentFlowSelection && currentFlowSelection.from && currentFlowSelection.to) {
            // 来自flow选中筛选
            const cells = this.notebook.cells ?? [];
            if (i < cells.length - 1) {
              const currStage = String(cells[i]["1st-level label"] ?? 'None');
              const nextStage = String(cells[i + 1]["1st-level label"] ?? 'None');
              if (currStage === currentFlowSelection.from && nextStage === currentFlowSelection.to) {
                // shouldKeepVisible = true;
              }
            }
          } else if (currentFlowHoverStage && currentFlowHoverStage !== '__flow_transition__') {
            // 来自stage hover筛选
            // shouldKeepVisible = rectStage === currentFlowHoverStage;
          } else if (currentFlowHoverStage === '__flow_transition__') {
            // 来自flow hover筛选，需要检查当前cell是否在flow中
            const flowHoverInfo = (window as any)[`_galaxyFlowHoverInfo_${tabId}`];
            if (flowHoverInfo && flowHoverInfo.from && flowHoverInfo.to) {
              const cells = this.notebook.cells ?? [];
              if (i < cells.length - 1) {
                const currStage = String(cells[i]["1st-level label"] ?? 'None');
                const nextStage = String(cells[i + 1]["1st-level label"] ?? 'None');
                if (currStage === flowHoverInfo.from && nextStage === flowHoverInfo.to) {
                  // shouldKeepVisible = true;
                }
              }
            }
          }

          // 点击选中后不添加高亮类，只有hover时才高亮
          r.classList.remove('minimap-highlight');
        }
        // 点击选中
        r.onclick = () => {
          this.selectedCellIdx = i;
          // 使用局部更新而不是全量 render
          this.updateMinimapHighlight();
          this.updateCellSelection();
          this.updateNavigationControls();
          
          setTimeout(() => {
            const cellList = this.node.querySelector('#nbd-cell-list-scroll');
            if (!cellList) return;
            const cellDivs = cellList.querySelectorAll('.nbd-cell');
            const target = cellDivs[i]?.parentElement as HTMLElement;
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              target.style.background = 'linear-gradient(90deg, #f0f8ff 0%, #e6f3ff 100%)';
              target.style.transition = 'background 0.4s ease';
              setTimeout(() => {
                target.style.background = '';
                target.style.transition = '';
              }, 1000);
            }
          }, 0);
        };
      });
      // cell 列表点击选中（只选中，不显示详情）
      const cellList = this.node.querySelector('#nbd-cell-list-scroll');
      if (cellList) {
        // 选中cell的外层div（display:flex; flex-direction:row; align-items:stretch;）
        const cellWrappers = Array.from(cellList.children) as HTMLElement[];
        cellWrappers.forEach((wrapper, idx) => {
          wrapper.onclick = (e) => {
            if (this.selectedCellIdx !== idx) {
              this.selectedCellIdx = idx;
              // 使用局部更新而不是全量 render
              this.updateMinimapHighlight();
              this.updateCellSelection();
              this.updateNavigationControls();
            }
            e.stopPropagation();
          };
        });
      }
      // 恢复滚动位置
      if (cellList && typeof prevScrollTop === 'number') {
        cellList.scrollTop = prevScrollTop;
      }
    }, 0);

    // 绑定导航按钮事件
    const navPrev = this.node.querySelector('#nbd-nav-prev') as HTMLButtonElement;
    const navNext = this.node.querySelector('#nbd-nav-next') as HTMLButtonElement;
    const navClear = this.node.querySelector('#nbd-nav-clear') as HTMLButtonElement;

    if (navPrev && navNext) {
      // 重新计算筛选的cell索引（使用与渲染时相同的逻辑）
      const tabId = this.getTabId();
      const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
      const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
      const currentFlowSelection = (window as any)[flowSelectionKey];
      const currentStageSelection = (window as any)[stageSelectionKey];

      let filteredCellIndices: number[] = [];
      // 只使用选中状态，不使用hover状态
      if (currentStageSelection) {
        // stage 选中筛选
        const cells = this.notebook.cells ?? [];
        cells.forEach((cell: any, i: number) => {
          const stage = String(cell["1st-level label"] ?? 'None');
          if (stage === currentStageSelection) {
            filteredCellIndices.push(i);
          }
        });
      } else if (currentFlowSelection && currentFlowSelection.from && currentFlowSelection.to) {
        // flow 选中筛选 - 添加所有transition的第一个cell（考虑markdown cell隔开的情况）
        const cells = this.notebook.cells ?? [];
        // 构建stage序列，忽略markdown cell
        const stageSeq: { stage: string; cellIndex: number }[] = [];
        cells.forEach((cell: any, i: number) => {
          if (cell.cellType === 'code') {
            const stage = String(cell["1st-level label"] ?? 'None');
            stageSeq.push({ stage, cellIndex: i });
          }
        });
        // 在stage序列中查找transition
        for (let i = 0; i < stageSeq.length - 1; i++) {
          const currStage = stageSeq[i].stage;
          const nextStage = stageSeq[i + 1].stage;
          if (currStage === currentFlowSelection.from && nextStage === currentFlowSelection.to) {
            filteredCellIndices.push(stageSeq[i].cellIndex); // 添加每个transition的第一个cell
          }
        }
      }
      // 注意：hover状态只用于高亮显示，不用于导航控件

      navPrev.addEventListener('click', () => {
        if (filteredCellIndices.length > 0) {
          let currentIndex = filteredCellIndices.indexOf(this.selectedCellIdx ?? -1);
          // 如果没有选中具体cell，选中第一个
          if (currentIndex === -1) {
            currentIndex = 0;
            this.selectedCellIdx = filteredCellIndices[0];
          } else if (currentIndex <= 0) {
            currentIndex = filteredCellIndices.length - 1; // 循环到最后一个
          } else {
            currentIndex--;
          }
          this.selectedCellIdx = filteredCellIndices[currentIndex];
          // 使用局部更新而不是全量 render
          this.updateMinimapHighlight();
          this.updateCellSelection();
          this.updateNavigationControls();
          this.scrollToSelectedCell();
        }
      });

      navNext.addEventListener('click', () => {
        if (filteredCellIndices.length > 0) {
          let currentIndex = filteredCellIndices.indexOf(this.selectedCellIdx ?? -1);
          // 如果没有选中具体cell，选中第一个
          if (currentIndex === -1) {
            currentIndex = 0;
            this.selectedCellIdx = filteredCellIndices[0];
          } else if (currentIndex < 0 || currentIndex >= filteredCellIndices.length - 1) {
            currentIndex = 0; // 循环到第一个
          } else {
            currentIndex++;
          }
          this.selectedCellIdx = filteredCellIndices[currentIndex];
          // 使用局部更新而不是全量 render
          this.updateMinimapHighlight();
          this.updateCellSelection();
          this.updateNavigationControls();
          this.scrollToSelectedCell();
        }
      });

      // 添加hover效果
      navPrev.addEventListener('mouseenter', () => {
        if (!navPrev.disabled) {
          navPrev.style.background = '#f5f5f5';
          navPrev.style.color = '#333';
        }
      });
      navPrev.addEventListener('mouseleave', () => {
        navPrev.style.background = 'none';
        navPrev.style.color = '#666';
      });
      navNext.addEventListener('mouseenter', () => {
        if (!navNext.disabled) {
          navNext.style.background = '#f5f5f5';
          navNext.style.color = '#333';
        }
      });
      navNext.addEventListener('mouseleave', () => {
        navNext.style.background = 'none';
        navNext.style.color = '#666';
      });

      // 清除筛选按钮事件
      if (navClear) {
        navClear.addEventListener('click', () => {
          const cellList = this.node.querySelector('#nbd-cell-list-scroll');
          const prevScrollTop = cellList ? cellList.scrollTop : 0;
          console.log('[NotebookDetailWidget] Clear button clicked for tab:', this.getTabId());
          // 不清除选中状态，保持当前 cell 选中
          // this.selectedCellIdx = null;
          
          // 直接清除当前 tab 的选中状态
          const tabId = this.getTabId();
          const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
          const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
          delete (window as any)[stageSelectionKey];
          delete (window as any)[flowSelectionKey];
          
          console.log('[NotebookDetailWidget] Cleared selection state for tab:', tabId);
          
          // 触发清除事件，让 flowchart 也恢复原状
          window.dispatchEvent(new CustomEvent('galaxy-selection-cleared', { detail: { tabId: this.getTabId() } }));
          
          // 重新渲染，隐藏导航控件，但不自动滚动
          this.render(false);
          setTimeout(() => {
            const cellList = this.node.querySelector('#nbd-cell-list-scroll');
            if (cellList) cellList.scrollTop = prevScrollTop;
          }, 0);
        });

        // 清除按钮hover效果
        navClear.addEventListener('mouseenter', () => {
          navClear.style.background = '#ffebee';
          navClear.style.color = '#d32f2f';
        });
        navClear.addEventListener('mouseleave', () => {
          navClear.style.background = 'none';
          navClear.style.color = '#999';
        });
      }
    }

    // 顶部 Overview 点击返回
    const overview = this.node.querySelector('.nbd-breadcrumb') as HTMLSpanElement;
    if (overview) {
      overview.onclick = () => {
        window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-back'));
      };
    }

    // 延迟高亮执行,确保 DOM 完成后再运行
    // 只有当 Prism.js 已经加载完成时才尝试激活行号
    if (this.prismLoaded) {
      setTimeout(() => this.activatePrismLineNumbers(), 30);
    }

    // 使用 requestIdleCallback 延迟绑定 minimap 事件和滚动操作
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this.bindMinimapEvents(prevScrollTop);
        // 确保初始选中状态正确
        this.updateCellSelection();
        if (autoScroll) {
          this.scrollToSelectedCell();
        }
      });
    } else {
      // 降级到 setTimeout
      setTimeout(() => {
        this.bindMinimapEvents(prevScrollTop);
        // 确保初始选中状态正确
        this.updateCellSelection();
        if (autoScroll) {
          this.scrollToSelectedCell();
        }
      }, 30);
    }
  }

  private updateMinimapHighlight() {
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;
    
    minimapSvg.querySelectorAll('rect').forEach((r, i) => {
      const idx = parseInt(r.getAttribute('data-idx') || '0');
      // 如果是选中的 cell，确保有高亮
      if (this.selectedCellIdx === idx) {
        r.classList.add('minimap-highlight');
      } else {
        // 如果不是选中的 cell，移除高亮（让 hover 事件自己管理）
        r.classList.remove('minimap-highlight');
      }
    });
  }

  private updateCellSelection() {
    // 防止重复调用
    if (this.cellSelectionUpdatePending) {
      return;
    }
    this.cellSelectionUpdatePending = true;
    
    // 更新 cell 列表中的选中状态
    const cellList = this.node.querySelector('#nbd-cell-list-scroll');
    if (!cellList) {
      this.cellSelectionUpdatePending = false;
      return;
    }
    
    const cellWrappers = Array.from(cellList.children) as HTMLElement[];
    cellWrappers.forEach((wrapper, idx) => {
      const leftBar = wrapper.querySelector('div:first-child') as HTMLElement;
      if (!leftBar) return;
      
      // 清除之前的选中指示器 - 使用更精确的选择器
      const existingBars = leftBar.querySelectorAll('.cell-selection-bar');
      existingBars.forEach(bar => bar.remove());
      
      // 添加新的选中指示器
      if (this.selectedCellIdx === idx) {
        const selBar = document.createElement('div');
        selBar.className = 'cell-selection-bar'; // 添加特殊类名
        selBar.style.position = 'absolute';
        selBar.style.left = '0';
        selBar.style.top = '0';
        selBar.style.width = '3px';
        selBar.style.height = '100%';
        selBar.style.background = '#1976d2';
        selBar.style.borderRadius = '2px';
        leftBar.appendChild(selBar);
      }
    });
    
    // 重置标志
    setTimeout(() => {
      this.cellSelectionUpdatePending = false;
    }, 0);
  }

  private updateNavigationControls() {
    // 更新导航控件（如果存在）
    const navContainer = this.node.querySelector('[style*="position:absolute; bottom:20px"]');
    if (!navContainer) return;
    
    const tabId = this.getTabId();
    const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
    const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
    const currentFlowSelection = (window as any)[flowSelectionKey];
    const currentStageSelection = (window as any)[stageSelectionKey];

    let filteredCellIndices: number[] = [];
    if (currentStageSelection) {
      const cells = this.notebook.cells ?? [];
      cells.forEach((cell: any, i: number) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        if (stage === currentStageSelection) {
          filteredCellIndices.push(i);
        }
      });
    } else if (currentFlowSelection && currentFlowSelection.from && currentFlowSelection.to) {
      const cells = this.notebook.cells ?? [];
      const stageSeq: { stage: string; cellIndex: number }[] = [];
      cells.forEach((cell: any, i: number) => {
        if (cell.cellType === 'code') {
          const stage = String(cell["1st-level label"] ?? 'None');
          stageSeq.push({ stage, cellIndex: i });
        }
      });
      for (let i = 0; i < stageSeq.length - 1; i++) {
        const currStage = stageSeq[i].stage;
        const nextStage = stageSeq[i + 1].stage;
        if (currStage === currentFlowSelection.from && nextStage === currentFlowSelection.to) {
          filteredCellIndices.push(stageSeq[i].cellIndex);
        }
      }
    }

    let currentFilteredIndex = -1;
    if (filteredCellIndices.length > 0 && this.selectedCellIdx !== null) {
      currentFilteredIndex = filteredCellIndices.indexOf(this.selectedCellIdx);
    }

    const navPrev = navContainer.querySelector('#nbd-nav-prev') as HTMLButtonElement;
    const navNext = navContainer.querySelector('#nbd-nav-next') as HTMLButtonElement;
    const navCount = navContainer.querySelector('span') as HTMLSpanElement;

    if (navPrev && navNext && navCount) {
      navPrev.disabled = (currentFilteredIndex <= 0 || currentFilteredIndex === -1);
      navNext.disabled = (currentFilteredIndex >= filteredCellIndices.length - 1 && currentFilteredIndex !== -1);
      navCount.textContent = `${currentFilteredIndex >= 0 ? currentFilteredIndex + 1 : 0} / ${filteredCellIndices.length}`;
    }
  }

  private bindMinimapEvents(prevScrollTop?: number) {
    if (this.minimapEventsBound) return;
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;
    this.minimapEventsBound = true;
    
    // 绑定 hover 事件（事件委托）
    minimapSvg.addEventListener('mouseover', (e) => {
      const target = e.target as SVGElement;
      if (target.tagName === 'rect') {
        const idx = parseInt(target.getAttribute('data-idx') || '0');
        // 如果不是选中的 cell，添加 hover 高亮
        if (this.selectedCellIdx !== idx) {
          target.classList.add('minimap-highlight');
        }
      }
    });
    minimapSvg.addEventListener('mouseout', (e) => {
      const target = e.target as SVGElement;
      if (target.tagName === 'rect') {
        const idx = parseInt(target.getAttribute('data-idx') || '0');
        // 如果不是选中的 cell，移除 hover 高亮
        if (this.selectedCellIdx !== idx) {
          target.classList.remove('minimap-highlight');
        }
      }
    });
    
    // 绑定 click 事件和其他操作
    minimapSvg.querySelectorAll('rect').forEach((r, i) => {
      // 点击选中
      r.onclick = () => {
        this.selectedCellIdx = i;
        // 使用局部更新而不是全量 render
        this.updateMinimapHighlight();
        this.updateCellSelection();
        this.updateNavigationControls();
        
        setTimeout(() => {
          const cellList = this.node.querySelector('#nbd-cell-list-scroll');
          if (!cellList) return;
          const cellDivs = cellList.querySelectorAll('.nbd-cell');
          const target = cellDivs[i]?.parentElement as HTMLElement;
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            target.style.background = 'linear-gradient(90deg, #f0f8ff 0%, #e6f3ff 100%)';
            target.style.transition = 'background 0.4s ease';
            setTimeout(() => {
              target.style.background = '';
              target.style.transition = '';
            }, 1000);
          }
        }, 0);
      };
    });
    
    // cell 列表点击选中（只选中，不显示详情）
    const cellList = this.node.querySelector('#nbd-cell-list-scroll');
    if (cellList) {
      // 选中cell的外层div（display:flex; flex-direction:row; align-items:stretch;）
      const cellWrappers = Array.from(cellList.children) as HTMLElement[];
      cellWrappers.forEach((wrapper, idx) => {
        wrapper.onclick = (e) => {
          if (this.selectedCellIdx !== idx) {
            this.selectedCellIdx = idx;
            // 使用局部更新而不是全量 render
            this.updateMinimapHighlight();
            this.updateCellSelection();
            this.updateNavigationControls();
          }
          e.stopPropagation();
        };
      });
    }
    
    // 恢复滚动位置
    if (cellList && typeof prevScrollTop === 'number') {
      cellList.scrollTop = prevScrollTop;
    }
  }
}