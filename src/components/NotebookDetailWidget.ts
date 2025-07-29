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
  private rendermime: RenderMimeRegistry;
  private prismLoaded: boolean = false; // 新增标志，用于判断 Prism.js 是否加载完成

  // 新增：获取当前tab ID
  private getTabId(): string {
    // 基于当前显示的内容生成唯一标识
    // 如果是notebook detail模式，使用notebook的ID
    if (this.notebook && (this.notebook as any).globalIndex !== undefined) {
      return `notebook_${(this.notebook as any).globalIndex}`;
    }
    // 如果是overview模式，使用overview标识
    return 'overview';
  }

  constructor(notebook: any) {
    super();
    this.notebook = notebook;
    (this as any).notebook = notebook; // 让外部 handleTabSwitch 能直接访问
    const nbId = notebook.kernelVersionId;
    this.id = 'notebook-detail-widget-' + nbId;
    this.title.label = 'Notebook Detail';
    this.title.closable = true;
    this.addClass('notebook-detail-widget');
    this.rendermime = new RenderMimeRegistry({
      initialFactories: standardRendererFactories
    });

    // 加载 Prism.js
    this.loadPrismJS();

    // 确保markdown渲染器可用
    console.log('Available renderers:', this.rendermime.mimeTypes);
    console.log('Markdown renderer available:', this.rendermime.mimeTypes.includes('text/markdown'));
    console.log('Python renderer available:', this.rendermime.mimeTypes.includes('text/x-python'));

    // 检查是否有text/x-python渲染器
    if (!this.rendermime.mimeTypes.includes('text/x-python')) {
      console.log('text/x-python renderer not available, will use text/plain with syntax highlighting');
    }

    // 初始化时不选中任何cell
    this.selectedCellIdx = null;

    // 绑定事件处理器
    this.stageHoverHandler = this.handleStageHover.bind(this);
    this.transitionHoverHandler = this.handleTransitionHover.bind(this);
    this.clearCellSelectionHandler = this.handleClearCellSelection.bind(this);
    this.selectionClearedHandler = (e: Event) => {
      const tabId = (e as CustomEvent).detail?.tabId;
      // 只处理当前tab的事件
      if (tabId === this.getTabId()) {
        console.log('[NotebookDetailWidget] selectionClearedHandler called for tab:', tabId);
        this.selectedCellIdx = null;
        this.render(); // 在清除选择后重新渲染
        console.log('[NotebookDetailWidget] render completed after selection cleared');
      }
    };

    // 监听 matrix 跳转事件
    window.addEventListener('galaxy-notebook-detail-jump', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.notebookIndex !== undefined && detail.cellIndex !== undefined) {
        // 切换 notebook
        if (this.notebook.index !== undefined && this.notebook.index !== detail.notebookIndex) {
          // 这里可以根据你的 notebook 切换逻辑来实现
          // 例如 window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', { detail: { notebookIndex: detail.notebookIndex } }));
          // 这里只处理当前 notebook
          return;
        }
        this.selectedCellIdx = detail.cellIndex;
        this.render();
        setTimeout(() => {
          const cellList = this.node.querySelector('#nbd-cell-list-scroll');
          if (!cellList) return;
          const cellDivs = cellList.querySelectorAll('.nbd-cell');
          const target = cellDivs[detail.cellIndex]?.parentElement as HTMLElement;
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            target.style.background = 'linear-gradient(90deg, #f0f8ff 0%, #e6f3ff 100%)';
            target.style.transition = 'background 0.4s ease';
            setTimeout(() => {
              target.style.background = '';
              target.style.transition = '';
            }, 1000);
          }
        }, 0);
      }
    });
    // 监听 notebook 切换时的 cell 跳转请求
    this.notebookSelectedHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.jumpCellIndex !== undefined && this.notebook.index === detail.notebook.index) {
        window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
          detail: { notebookIndex: detail.notebook.index, cellIndex: detail.jumpCellIndex }
        }));
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
      // console.log('[NotebookDetailWidget] Flow selection changed, re-rendering...');
      this.render();
    });
    // 如果 Prism.js 已经加载完成，立即渲染
    if (this.prismLoaded) {
      this.render();
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
  }

  private handleStageHover(event: Event): void {
    const stage = (event as CustomEvent).detail.stage;
    // 记录当前 flow chart 悬浮 stage
    (window as any)._galaxyFlowHoverStage = stage;
    // 清除flow信息（当stage筛选时）
    if (!stage) {
      (window as any)._galaxyFlowHoverInfo = null;
    }
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;
    // 检查是否来自 minimap 内部的 hover
    const isFromMinimap = (event as any).detail?.source === 'minimap';
    const hoveredIdx = (event as any).detail?.cellIdx;

    // 检查是否有选中状态，如果有则不添加高亮
    const tabId = this.getTabId();
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
          r.classList.remove('minimap-highlight');
        }
      } else if (stage && !hasSelection) {
        // 只有在没有选中状态时才添加高亮
        // flow chart 悬浮时高亮所有同 stage 的 cell
        // console.log('[NotebookDetailWidget] stage:', stage, 'rectStage:', rectStage, 'hasSelection:', hasSelection);
        if (rectStage === stage) {
          r.classList.add('minimap-highlight');
        } else {
          r.classList.remove('minimap-highlight');
        }

        // 高亮包含该stage的transition（即使中间有markdown cell）
        const cells = this.notebook.cells ?? [];
        for (let i = 0; i < cells.length - 1; i++) {
          const currStage = String(cells[i]["1st-level label"] ?? 'None');
          const nextStage = String(cells[i + 1]["1st-level label"] ?? 'None');
          if ((currStage === stage || nextStage === stage) && currStage !== nextStage) {
            // 找到对应的minimap rect并高亮
            const currRect = minimapSvg.querySelector(`rect[data-idx="${i}"]`);
            const nextRect = minimapSvg.querySelector(`rect[data-idx="${i + 1}"]`);
            if (currRect && nextRect) {
              currRect.classList.add('minimap-highlight');
              nextRect.classList.add('minimap-highlight');
            }
          }
        }
      } else {
        // 没有 flow chart 悬浮时，清除所有高亮
        r.classList.remove('minimap-highlight');
      }
    });
  }

  private handleTransitionHover(event: Event): void {
    const { from, to } = (event as CustomEvent).detail;
    // 记录 flow chart 悬浮
    (window as any)._galaxyFlowHoverStage = from && to ? '__flow_transition__' : null;
    // 设置全局flow信息
    if (from && to) {
      (window as any)._galaxyFlowHoverInfo = { from, to };
    } else {
      (window as any)._galaxyFlowHoverInfo = null;
    }
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;

    // 检查是否有选中状态，如果有则不添加高亮
    const tabId = this.getTabId();
    const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
    const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
    const hasSelection = (window as any)[flowSelectionKey] || (window as any)[stageSelectionKey];



    if (from && to && !hasSelection) {
      // 先重置所有高亮
      minimapSvg.querySelectorAll('rect').forEach((r) => {
        r.classList.remove('minimap-highlight');
        const idx = parseInt(r.getAttribute('data-idx') || '0');
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
      this.handleStageHover({ detail: { stage: null } } as CustomEvent);
    }
  }

  private handleClearCellSelection() {
    this.selectedCellIdx = null;
    // 清除全局筛选状态
    (window as any)._galaxyFlowHoverStage = null;
    (window as any)._galaxyFlowHoverInfo = null;
    this.render();
  }



  private scrollToSelectedCell() {
    setTimeout(() => {
      if (this.selectedCellIdx == null) return;
      const target = document.getElementById('nbd-cell-row-' + this.selectedCellIdx) as HTMLElement;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    console.log('Attempting to activate Prism Line Numbers.');
    if (!Prism) {
      console.warn('Prism object not found.');
      return;
    }
    if (!Prism.plugins || !Prism.plugins.lineNumbers) {
      console.warn('Prism.js lineNumbers plugin not found on Prism.plugins.');
      console.log('Prism.plugins (missing lineNumbers):', Prism.plugins);
      return;
    }
    console.log('Prism and lineNumbers plugin are present.');
    console.log('Details of Prism.plugins.lineNumbers:', Prism.plugins.lineNumbers); // 仍然保留此行用于调试
  
    // **关键更改：只需调用 highlightAll。**
    // 如果行号插件已正确加载并与此 Prism 版本关联，
    // highlightAll() 在处理 <pre class="line-numbers"> 时应自动添加行号。
    Prism.highlightAll();
    console.log('Prism.highlightAll() called.');
  
    const blocks = document.querySelectorAll('pre.line-numbers');
    console.log(`Found ${blocks.length} pre.line-numbers blocks. Highlighted.`);
  
    // 如果需要，您可以保留 render() 中的 `scrollToSelectedCell()` 调用
    // 此处不再需要显式的循环或 _hook 调用来添加行号。
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
          this.render(); // 首次渲染
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

  private render() {
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
    const currentFlowHoverStage = (window as any)._galaxyFlowHoverStage;
    const currentFlowHoverInfo = (window as any)._galaxyFlowHoverInfo;

    // 计算筛选的cell索引
    let filteredCellIndices: number[] = [];

    // 添加调试信息
    console.log('[NotebookDetailWidget] currentFlowSelection:', currentFlowSelection);
    console.log('[NotebookDetailWidget] currentStageSelection:', currentStageSelection);
    console.log('[NotebookDetailWidget] currentFlowHoverStage:', currentFlowHoverStage);
    console.log('[NotebookDetailWidget] currentFlowHoverInfo:', currentFlowHoverInfo);

    // 优先使用选中状态，如果没有选中状态则使用hover状态
    if (currentStageSelection) {
      // stage 选中筛选
      const cells = nb.cells ?? [];
      cells.forEach((cell: any, i: number) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        if (stage === currentStageSelection) {
          filteredCellIndices.push(i);
        }
      });
      // console.log('[NotebookDetailWidget] stage selection, filtered indices:', filteredCellIndices);
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
      console.log('[NotebookDetailWidget] flow selection, filtered indices:', filteredCellIndices);
    } else if (currentFlowHoverStage && currentFlowHoverStage !== '__flow_transition__') {
      // stage hover筛选
      const cells = nb.cells ?? [];
      cells.forEach((cell: any, i: number) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        if (stage === currentFlowHoverStage) {
          filteredCellIndices.push(i);
        }
      });
      // console.log('[NotebookDetailWidget] stage hover, filtered indices:', filteredCellIndices);
    } else if (currentFlowHoverStage === '__flow_transition__' && currentFlowHoverInfo) {
      // flow hover筛选
      const cells = nb.cells ?? [];
      for (let i = 0; i < cells.length - 1; i++) {
        const currStage = String(cells[i]["1st-level label"] ?? 'None');
        const nextStage = String(cells[i + 1]["1st-level label"] ?? 'None');
        if (currStage === currentFlowHoverInfo.from && nextStage === currentFlowHoverInfo.to) {
          filteredCellIndices.push(i);
          filteredCellIndices.push(i + 1);
        }
      }
      // console.log('[NotebookDetailWidget] flow hover, filtered indices:', filteredCellIndices);
    }

    console.log('[NotebookDetailWidget] final filtered indices:', filteredCellIndices);

    // 计算当前在筛选cell中的位置
    let currentFilteredIndex = -1;
    if (filteredCellIndices.length > 0 && this.selectedCellIdx !== null) {
      currentFilteredIndex = filteredCellIndices.indexOf(this.selectedCellIdx);
    }
    console.log('[NotebookDetailWidget] currentFilteredIndex:', currentFilteredIndex, 'selectedCellIdx:', this.selectedCellIdx, 'filteredCellIndices:', filteredCellIndices);

    // 先渲染主结构和cell列表容器
    this.node.innerHTML = `
      <div style="padding:24px; max-width:900px; margin:0 auto; height:100%; box-sizing:border-box; display:flex; flex-direction:column;">
        ${(() => {
        console.log('[NotebookDetailWidget] filteredCellIndices.length:', filteredCellIndices.length);
        console.log('[NotebookDetailWidget] should show nav control:', filteredCellIndices.length > 0);
        return filteredCellIndices.length > 0 ? `
        <div style="position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:1000;">
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
        const cellHeight = 4;
        const gap = 1;
        const rectHeight = 3;
        const minimapHeight = cells.length * (cellHeight + gap);
        const minimapSvgWidth = 32;
        const rectX = (minimapSvgWidth - 20) / 2;
        const maxMinimapHeight = 800;
        let svgHeight = minimapHeight;
        let viewBox = `0 0 ${minimapSvgWidth} ${minimapHeight}`;
        let style = 'display:block; margin:0 auto;';
        if (minimapHeight > maxMinimapHeight) {
          svgHeight = maxMinimapHeight;
          style += ` height:${maxMinimapHeight}px; width:${minimapSvgWidth}px;`;
        } else {
          style += ` height:${minimapHeight}px; width:${minimapSvgWidth}px;`;
        }
        const rects = cells.map((cell: any, i: number) => {
          const stage = String(cell["1st-level label"] ?? 'None');
          const color = colorMap.get(stage) || '#ccc';
          const rectY = i * (cellHeight + gap);
          if (cell.cellType === 'markdown') {
            const stroke = '#bbb';
            const strokeWidth = 1;
            return `<rect x="${rectX}" y="${rectY}" width="20" height="${rectHeight}" fill="transparent" stroke="${stroke}" stroke-width="${strokeWidth}" data-stage="${stage}" data-idx="${i}" data-orig-width="20" data-orig-x="${rectX}" style="cursor:pointer;" />`;
          } else {
            const stageColor = colorMap.get(stage) || '#bbb';
            const stroke = stageColor;
            const strokeWidth = 1;
            return `<rect x="${rectX}" y="${rectY}" width="20" height="${rectHeight}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" data-stage="${stage}" data-idx="${i}" data-orig-width="20" data-orig-x="${rectX}" style="cursor:pointer;" />`;
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
        const isSelected = this.selectedCellIdx === i;
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
        if (isSelected) {
          const selBar = document.createElement('div');
          selBar.style.position = 'absolute';
          selBar.style.left = '0';
          selBar.style.top = '0';
          selBar.style.width = '3px';
          selBar.style.height = '100%';
          selBar.style.background = '#1976d2';
          selBar.style.borderRadius = '2px';
          left.appendChild(selBar);
        }
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
              this.render();
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
          console.log('Rendering markdown cell:', i, 'content:', content);
          try {
            // 确保JupyterLab样式已加载
            ensureJupyterlabThemeStyle();

            // 尝试使用HTML渲染器而不是markdown渲染器
            const htmlWidget = this.rendermime.createRenderer('text/html');
            console.log('Created HTML widget:', htmlWidget);

            // 先将markdown转换为HTML
            const htmlContent = this.markdownToHtml(content);
            console.log('Converted HTML content:', htmlContent);

            const model = this.rendermime.createModel({
              data: { 'text/html': htmlContent },
              metadata: {},
              trusted: true
            });
            console.log('Created model:', model);

            // 确保渲染器正确初始化
            if (htmlWidget && htmlWidget.node) {
              htmlWidget.renderModel(model);
              console.log('Widget node after render:', htmlWidget.node);
              contentDiv.appendChild(htmlWidget.node);
              console.log('HTML rendered successfully for cell:', i);
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
            console.log('Using fallback renderer for cell:', i);
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
            const flowHoverInfo = (window as any)._galaxyFlowHoverInfo;
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

          // 调试信息
          // if (shouldKeepVisible) {
          //   console.log('[setTimeout] cell', i, 'shouldKeepVisible:', shouldKeepVisible, 'currentStageSelection:', currentStageSelection, 'currentFlowSelection:', currentFlowSelection);
          // }
        }
        // 点击选中
        r.addEventListener('click', () => {
          this.selectedCellIdx = i;
          this.render();
          setTimeout(() => {
            const cellList = this.node.querySelector('#nbd-cell-list-scroll');
            if (!cellList) return;
            const cellDivs = cellList.querySelectorAll('.nbd-cell');
            const target = cellDivs[i]?.parentElement as HTMLElement;
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              target.style.background = 'linear-gradient(90deg, #f0f8ff 0%, #e6f3ff 100%)';
              target.style.transition = 'background 0.4s ease';
              setTimeout(() => {
                target.style.background = '';
                target.style.transition = '';
              }, 1000);
            }
          }, 0);
        });
        // hover 临时高亮
        r.addEventListener('mouseenter', () => {
          r.classList.add('minimap-highlight');
        });
        r.addEventListener('mouseleave', () => {
          // 只要不是选中 cell，移除高亮
          if (this.selectedCellIdx !== i) {
            r.classList.remove('minimap-highlight');
          }
        });
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
              this.render();
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
      const currentFlowHoverStage = (window as any)._galaxyFlowHoverStage;
      const currentFlowHoverInfo = (window as any)._galaxyFlowHoverInfo;

      let filteredCellIndices: number[] = [];
      // 优先使用选中状态，如果没有选中状态则使用hover状态
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
      } else if (currentFlowHoverStage && currentFlowHoverStage !== '__flow_transition__') {
        // stage hover筛选
        const cells = this.notebook.cells ?? [];
        cells.forEach((cell: any, i: number) => {
          const stage = String(cell["1st-level label"] ?? 'None');
          if (stage === currentFlowHoverStage) {
            filteredCellIndices.push(i);
          }
        });
      } else if (currentFlowHoverStage === '__flow_transition__' && currentFlowHoverInfo) {
        // flow hover筛选
        const cells = this.notebook.cells ?? [];
        for (let i = 0; i < cells.length - 1; i++) {
          const currStage = String(cells[i]["1st-level label"] ?? 'None');
          const nextStage = String(cells[i + 1]["1st-level label"] ?? 'None');
          if (currStage === currentFlowHoverInfo.from && nextStage === currentFlowHoverInfo.to) {
            filteredCellIndices.push(i);
            filteredCellIndices.push(i + 1);
          }
        }
      }

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
          this.render();
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
          this.render();
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
          // console.log('[NotebookDetailWidget] Clear filter clicked');
          // 清除选中状态
          this.selectedCellIdx = null;
          // 触发清除事件，让所有组件回到默认状态
          window.dispatchEvent(new CustomEvent('galaxy-selection-cleared', { detail: { tabId: this.getTabId() } })); // 传递当前tabId
          // 重新渲染，隐藏导航控件
          this.render();
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

    this.scrollToSelectedCell();
  }
}