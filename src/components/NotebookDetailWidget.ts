import { Widget } from '@lumino/widgets';
// import { LABEL_MAP } from './labelMap';
import { colorMap } from './colorMap';
import { RenderMimeRegistry, standardRendererFactories } from '@jupyterlab/rendermime';
import { CodeMirrorEditorFactory } from '@jupyterlab/codemirror';
import { CodeEditor } from '@jupyterlab/codeeditor';
// import '@jupyterlab/codemirror/style/index.css';
// import '@jupyterlab/theme-light-extension/style/theme.css'; // 或 dark 主题

// function highlightPython(code: string): string {
//   // 简单高亮，支持常见关键字
//   const keywords = [
//     'import', 'from', 'as', 'def', 'class', 'return', 'for', 'if', 'else', 'elif', 'with', 'try', 'except', 'while', 'print', 'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None'
//   ];
//   let html = code
//     .replace(/(&)/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;');
//   for (const kw of keywords) {
//     html = html.replace(new RegExp('(?<=^|\W)(' + kw + ')(?=\W|$)', 'g'), '<span class="nbd-kw">$1</span>');
//   }
//   // 字符串
//   html = html.replace(/('[^']*'|"[^"]*")/g, '<span class="nbd-str">$1</span>');
//   // 注释
//   html = html.replace(/(#.*)/g, '<span class="nbd-cmt">$1</span>');
//   return html;
// }

// function simpleMarkdown(md: string): string {
//   // 支持 # ## ###、**bold**、*italic*、[text](url)、换行
//   let html = md
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;');
//   html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
//   html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
//   html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
//   html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
//   html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
//   html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
//   html = html.replace(/\n/g, '<br>');
//   return html;
// }

export class NotebookDetailWidget extends Widget {
  private notebook: any;
  private selectedCellIdx: number | null = null;
  private stageHoverHandler: (event: Event) => void;
  private transitionHoverHandler: (event: Event) => void;
  private clearCellSelectionHandler: () => void;
  private rendermime: RenderMimeRegistry;
  private codeMirrorFactory: CodeMirrorEditorFactory;

  constructor(notebook: any) {
    super();
    this.notebook = notebook;
    (this as any).notebook = notebook; // 让外部 handleTabSwitch 能直接访问
    const nbId = notebook.kernelVersionId;
    this.id = 'notebook-detail-widget-' + nbId;
    this.title.label = 'Notebook Detail';
    this.title.closable = true;
    this.addClass('notebook-detail-widget');
    this.rendermime = new RenderMimeRegistry({ initialFactories: standardRendererFactories });
    this.codeMirrorFactory = new CodeMirrorEditorFactory();

    // 绑定事件处理器
    this.stageHoverHandler = this.handleStageHover.bind(this);
    this.transitionHoverHandler = this.handleTransitionHover.bind(this);
    this.clearCellSelectionHandler = this.handleClearCellSelection.bind(this);

    this.render();

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
    window.addEventListener('galaxy-notebook-selected', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.jumpCellIndex !== undefined && this.notebook.index === detail.notebook.index) {
        window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
          detail: { notebookIndex: detail.notebook.index, cellIndex: detail.jumpCellIndex }
        }));
      }
    });
  }

  onAfterAttach(): void {
    // 监听全局悬浮事件
    window.addEventListener('galaxy-stage-hover', this.stageHoverHandler);
    window.addEventListener('galaxy-transition-hover', this.transitionHoverHandler);
    window.addEventListener('galaxy-clear-cell-selection', this.clearCellSelectionHandler);
  }

  onBeforeDetach(): void {
    // 移除事件监听器
    window.removeEventListener('galaxy-stage-hover', this.stageHoverHandler);
    window.removeEventListener('galaxy-transition-hover', this.transitionHoverHandler);
    window.removeEventListener('galaxy-clear-cell-selection', this.clearCellSelectionHandler);
  }

  private handleStageHover(event: Event): void {
    const stage = (event as CustomEvent).detail.stage;
    // 记录当前 flow chart 悬浮 stage
    (window as any)._galaxyFlowHoverStage = stage;
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;
    // 检查是否来自 minimap 内部的 hover
    const isFromMinimap = (event as any).detail?.source === 'minimap';
    const hoveredIdx = (event as any).detail?.cellIdx;
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
      } else if (stage) {
        // flow chart 悬浮时高亮所有同 stage 的 cell
        if (rectStage === stage) {
          r.classList.add('minimap-highlight');
        } else {
          r.classList.remove('minimap-highlight');
        }
      } else {
        // 没有 flow chart 悬浮时，只给 selected cell 加 minimap-highlight
        if (this.selectedCellIdx === rectIdx) {
          r.classList.add('minimap-highlight');
        } else {
          r.classList.remove('minimap-highlight');
        }
      }
    });
  }

  private handleTransitionHover(event: Event): void {
    const { from, to } = (event as CustomEvent).detail;
    // 记录 flow chart 悬浮
    (window as any)._galaxyFlowHoverStage = from && to ? '__flow_transition__' : null;
    const minimapSvg = this.node.querySelector('svg');
    if (!minimapSvg) return;

    if (from && to) {
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

      // 找到所有 from→to 的相邻转换并高亮
      const cells = this.notebook.cells ?? [];
      for (let i = 0; i < cells.length - 1; i++) {
        const currStage = String(cells[i]["1st-level label"] ?? 'None');
        const nextStage = String(cells[i + 1]["1st-level label"] ?? 'None');

        if (currStage === from && nextStage === to) {
          // 向前找连续的 from
          let i0 = i;
          while (i0 > 0 && String(cells[i0 - 1]["1st-level label"] ?? 'None') === from) i0--;

          // 向后找连续的 to
          let i1 = i + 1;
          while (i1 + 1 < cells.length && String(cells[i1 + 1]["1st-level label"] ?? 'None') === to) i1++;

          // 高亮 from 段
          for (let j = i0; j <= i; j++) {
            const rect = minimapSvg.querySelector(`rect[data-idx="${j}"]`) as SVGElement;
            if (rect) {
              const cell = cells[j];
              const stageColor = cell && cell.cellType === 'code' ? (colorMap.get(String(cell["1st-level label"] ?? 'None')) || '#bbb') : '#ccc';
              rect.setAttribute('stroke', stageColor);
              rect.setAttribute('stroke-width', '1');
              rect.classList.add('minimap-highlight');
              if (rect.parentNode) rect.parentNode.appendChild(rect);
            }
          }

          // 高亮 to 段
          for (let j = i + 1; j <= i1; j++) {
            const rect = minimapSvg.querySelector(`rect[data-idx="${j}"]`) as SVGElement;
            if (rect) {
              const cell = cells[j];
              const stageColor = cell && cell.cellType === 'code' ? (colorMap.get(String(cell["1st-level label"] ?? 'None')) || '#bbb') : '#ccc';
              rect.setAttribute('stroke', stageColor);
              rect.setAttribute('stroke-width', '1');
              rect.classList.add('minimap-highlight');
              if (rect.parentNode) rect.parentNode.appendChild(rect);
            }
          }
        }
      }
    } else {
      // 取消高亮，还原所有状态
      this.handleStageHover({ detail: { stage: null } } as CustomEvent);
    }
  }

  private handleClearCellSelection() {
    this.selectedCellIdx = null;
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

  private render() {
    // 记录滚动位置
    let prevScrollTop = 0;
    const prevCellList = this.node.querySelector('#nbd-cell-list-scroll');
    if (prevCellList) {
      prevScrollTop = prevCellList.scrollTop;
    }
    const nb = this.notebook;
    let nbIdx = '';
    if (nb.path && /\d+/.test(nb.path)) {
      nbIdx = nb.path.match(/\d+/)![0];
    } else if (nb.index !== undefined) {
      nbIdx = String(nb.index + 1);
    }
    // 先渲染主结构和cell列表容器
    this.node.innerHTML = `
      <div style="padding:24px; max-width:900px; margin:0 auto; height:100%; box-sizing:border-box; display:flex; flex-direction:column;">
        <!--<div style="display:flex; align-items:center; font-size:15px; font-weight:500; margin-bottom:18px; margin-top:8px;">
          <span class="nbd-breadcrumb" style="color:#3182bd; cursor:pointer; text-decoration:underline;">Overview</span>
          <span style="margin:0 8px; color:#888;">/</span>
          <span style="color:#222;">notebook ${nbIdx || ''}</span>
        </div>-->
        <div style="flex:1 1 auto; min-height:0; display:flex; flex-direction:row; align-items:flex-start; gap:0;">
          <!-- Mini map -->
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
          <!-- Cell 列表 -->
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
      </style>
    `;
    // 渲染cell内容（JupyterLab渲染器）
    const cellList = this.node.querySelector('#nbd-cell-list-scroll');
    if (cellList) {
      cellList.innerHTML = '';
      (nb.cells ?? []).forEach((cell: any, i: number) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        const stageColor = colorMap.get(stage) || '#ccc';
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
        // cell内容区
        const cellDiv = document.createElement('div');
        cellDiv.className = 'nbd-cell';
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
          const mdWidget = this.rendermime.createRenderer('text/markdown');
          const model = this.rendermime.createModel({
            data: { 'text/markdown': content },
            metadata: {},
            trusted: true
          });
          mdWidget.renderModel(model);
          contentDiv.appendChild(mdWidget.node);
        } else if (cell.cellType === 'code') {
          const host = document.createElement('div');
          const model = new CodeEditor.Model();
          model.sharedModel.setSource(content);
          model.mimeType = 'text/x-python';
          const editor = this.codeMirrorFactory.newInlineEditor({ host, model });
          editor.setOption('readOnly', true);
          contentDiv.appendChild(host);
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
          r.classList.remove('minimap-highlight');
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
      // cell 列表点击选中
      const cellList = this.node.querySelector('#nbd-cell-list-scroll');
      if (cellList) {
        // 选中cell的外层div（display:flex; flex-direction:row; align-items:stretch;）
        const cellWrappers = Array.from(cellList.children) as HTMLElement[];
        cellWrappers.forEach((wrapper, idx) => {
          wrapper.onclick = (e) => {
            if (this.selectedCellIdx !== idx) {
              this.selectedCellIdx = idx;
              this.render();
              const cell = this.notebook.cells[idx];
              window.dispatchEvent(new CustomEvent('galaxy-cell-detail', { detail: { cell: { ...cell, notebookIndex: this.notebook.index, cellIndex: idx, _notebookDetail: this.notebook } } }));
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
    // 顶部 Overview 点击返回
    const overview = this.node.querySelector('.nbd-breadcrumb') as HTMLSpanElement;
    if (overview) {
      overview.onclick = () => {
        window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-back'));
      };
    }
    this.scrollToSelectedCell();
  }
} 