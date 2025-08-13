import { Widget } from '@lumino/widgets';
import { RenderMimeRegistry, standardRendererFactories } from '@jupyterlab/rendermime';
import { LABEL_MAP } from './labelMap';

// 工具函数：根据英文名或 id 找到 stage id（字符串）
function getStageIdByName(name: string): string | undefined {
  // 先查 labelMap 反查
  for (const [id, label] of Object.entries(LABEL_MAP)) {
    if (label === name || id === name) return id;
  }
  return undefined;
}

export class DetailSidebar extends Widget {
  private colorMap: Map<string, string>;
  private notebookOrder: number[] = []; // 保存notebook的原始排序
  private filter: any = null;
  private _allData: any[] = [];
  private _mostFreqStage: string | undefined;
  private _mostFreqFlow: string | undefined;
  private _hiddenStages?: Set<string>;
  private similarityGroups: any[] = []; // 存储similarity groups数据
  private currentNotebook: any = null; // 保存当前 notebook detail
  private _currentTitle: string = 'Notebook Overview'; // 跟踪当前标题
  private _currentSelection: any = null; // 跟踪当前选中状态
  private rendermime: RenderMimeRegistry;

  private _getTitleStyle(): string {
    if (!this._currentSelection) return 'color: #222';
    if (this._currentSelection.type === 'stage') {
      let color = this.colorMap.get(this._currentSelection.stage) || '#222';
      // 确保颜色格式正确（移除alpha通道）
      if (color.length === 9 && color.startsWith('#')) {
        color = color.substring(0, 7);
      }
      return `color: ${color}`;
    } else if (this._currentSelection.type === 'flow') {
      // 对于flow，使用渐变CSS
      let fromColor = this.colorMap.get(this._currentSelection.from) || '#222';
      let toColor = this.colorMap.get(this._currentSelection.to) || '#222';
      // 确保颜色格式正确（移除alpha通道）
      if (fromColor.length === 9 && fromColor.startsWith('#')) {
        fromColor = fromColor.substring(0, 7);
      }
      if (toColor.length === 9 && toColor.startsWith('#')) {
        toColor = toColor.substring(0, 7);
      }
      return `background: linear-gradient(90deg, ${fromColor}, ${toColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; display: inline; word-break: break-word;`;
    }
    return 'color: #222';
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

  // 动态插入 JupyterLab 主题样式（只插入一次）
  private ensureJupyterlabThemeStyle() {
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

  constructor(colorMap: Map<string, string>, notebookOrder: number[], hiddenStages?: Set<string>, similarityGroups?: any[]) {
    super();
    this.colorMap = colorMap;
    this.notebookOrder = notebookOrder || []; // 保存notebook的原始排序
    this.similarityGroups = similarityGroups || []; // 保存similarity groups数据
    this.id = 'galaxy-detail-sidebar';
    this.title.label = 'Details';
    this.title.closable = true;
    this.addClass('galaxy-detail-sidebar');
    this.rendermime = new RenderMimeRegistry({
      initialFactories: standardRendererFactories
    });
    this.setDefault();
    this.node.style.overflowY = 'auto';
    this.node.style.minWidth = '305px'; // 设置最小宽度
    this._hiddenStages = hiddenStages ?? new Set(['10', '12']);
    // 监听左侧 legend 显隐变化，自动刷新统计
    window.addEventListener('galaxy-hidden-stages-changed', (e: any) => {
      const arr = e.detail?.hiddenStages ?? [];
      this._hiddenStages = new Set(arr);
      if (this._allData && this._allData.length > 0) {
        if (this.filter) {
          this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
        } else if (this.currentNotebook) {
          this.setNotebookDetail(this.currentNotebook, true); // 跳过事件派发，避免循环
        } else {
          this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
        }
      }
    });
    // 监听 matrix 筛选事件，summary 状态下刷新统计
    window.addEventListener('galaxy-matrix-filtered', (e: any) => {
      const filteredData = e.detail?.notebooks ?? [];
      if (!this.currentNotebook) {
        this.setSummary(filteredData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
      }
    });
    // 监听 notebook order 变化事件 - 只更新notebookOrder，不重新渲染
    window.addEventListener('galaxy-notebook-order-changed', (e: any) => {
      this.notebookOrder = e.detail?.notebookOrder ?? [];
    });
  }

  onAfterAttach() {
    // 恢复之前的筛选状态
    this.restoreDetailFilterState();
    window.addEventListener('galaxy-cell-detail', this._cellDetailHandler);
  }
  onBeforeDetach() {
    window.removeEventListener('galaxy-cell-detail', this._cellDetailHandler);
  }
  private _cellDetailHandler = (e: Event) => {
    const cell = (e as CustomEvent).detail.cell;
    this.setCellDetail(cell);
  };



  setDefault() {
    this.currentNotebook = null; // 重置notebook状态
    this._currentSelection = null; // 重置选择状态
    this.node.innerHTML = `<div style="padding:16px; color:#888;">请选择一个 notebook 或 cell 查看详情。</div>`;
  }

  setNotebookDetail(nb: any, skipEventDispatch: boolean = false) {
    this.currentNotebook = nb; // 保存当前 notebook
    // 在notebook detail视图下，不改变标题颜色
    this._currentSelection = null;
    // 确保 nb 有 index 字段
    if (nb && nb.index === undefined) {
      nb.index = 0;
    }

    // 设置notebook的默认标题
    this._currentTitle = nb.notebook_name ?? nb.kernelVersionId ?? `Notebook ${nb.globalIndex || nb.index || 0}`;
    this.saveDetailFilterState();

    // 只有在不跳过事件派发时才派发notebook选中事件
    if (!skipEventDispatch) {
      const notebookObj = { ...nb, index: nb.globalIndex };
      window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', {
        detail: { notebook: notebookObj }
      }));
    }

    // 使用所有cell，与LeftSidebar保持一致
    const cells = nb.cells ?? [];
    const total = cells.length;
    const codeCount = cells.filter((c: any) => c.cellType === 'code').length;
    const mdCount = cells.filter((c: any) => c.cellType === 'markdown').length;
    // 统计最常见stage和flow（与flowchart一致）
    const stageFreq: Record<string, number> = {};
    const transitions: Record<string, number> = {};

    // 只考虑code cell，与LeftSidebar保持一致
    const codeCells = cells.filter((c: any) => c.cellType === 'code');

    // 获取被隐藏的stage列表
    const hiddenStages = this._hiddenStages ?? new Set(['6', '1']);

    // 统计stage频率，排除被隐藏的stage
    for (let i = 0; i < codeCells.length; i++) {
      const stage = String(codeCells[i]["1st-level label"] ?? 'None');
      if (stage !== 'None' && !hiddenStages.has(stage)) {
        stageFreq[stage] = (stageFreq[stage] || 0) + 1;
      }
    }

    // 构建stage序列（连续的相同stage合并）
    const stageSeq: string[] = [];
    for (let i = 0; i < codeCells.length; i++) {
      const stage = String(codeCells[i]["1st-level label"] ?? 'None');
      if (stageSeq.length === 0 || stageSeq[stageSeq.length - 1] !== stage) {
        stageSeq.push(stage);
      }
    }

    // 计算stage序列中的transitions，排除被隐藏的stage
    for (let i = 0; i < stageSeq.length - 1; i++) {
      const from = stageSeq[i];
      const to = stageSeq[i + 1];
      if (from !== 'None' && to !== 'None' && !hiddenStages.has(from) && !hiddenStages.has(to)) {
        const key = `${from}->${to}`;
        transitions[key] = (transitions[key] || 0) + 1;
      }
    }
    // 找到所有频率最高的stage和transition
    const maxStageFreq = Object.keys(stageFreq).length > 0 ? Math.max(...Object.values(stageFreq)) : 0;
    const maxFlowFreq = Object.keys(transitions).length > 0 ? Math.max(...Object.values(transitions)) : 0;
    const mostFreqStages = Object.entries(stageFreq)
      .filter(([_, freq]) => freq === maxStageFreq)
      .map(([stage, _]) => stage);
    const mostFreqFlows = Object.entries(transitions)
      .filter(([_, freq]) => freq === maxFlowFreq)
      .map(([flow, _]) => flow);

    // 统计出现次数
    // 只显示出现次数，不显示(tie)
    const stageCountText = maxStageFreq > 0 ? `${maxStageFreq} count(s)` : 'None';
    const flowCountText = maxFlowFreq > 0 ? `${maxFlowFreq} count(s)` : 'None';
    // 展开/收起逻辑变量（notebook detail）
    let showAllStages = false;
    let showAllFlows = false;
    // 过滤 stage 和 flow，隐藏包含 hidden stage 的
    // 过滤 stage
    const mostFreqStagesFiltered = mostFreqStages.filter(stage => {
      const id = getStageIdByName(stage);
      return typeof id === 'string' && !hiddenStages.has(String(id));
    });
    // 过滤 flow
    const mostFreqFlowsFiltered = mostFreqFlows.filter(f => {
      let [from, to] = f.split(/->|→/);
      from = String(from); to = String(to);
      const fromId = getStageIdByName(from);
      const toId = getStageIdByName(to);
      return (
        typeof fromId === 'string' &&
        typeof toId === 'string' &&
        !hiddenStages.has(String(fromId)) &&
        !hiddenStages.has(String(toId))
      );
    });
    // 渲染函数，支持收缩/展开
    const renderStageLinks = () => {
      const arr = showAllStages ? mostFreqStagesFiltered : mostFreqStagesFiltered.slice(0, 3);
      return arr.map(stage =>
        `<a href="#" class="dsb-stage-link" data-stage="${stage}" style="color:${this.colorMap.get(stage) || '#0066cc'} !important; text-decoration:underline; cursor:pointer; font-weight:600; font-size:14px; margin-right:8px;">${LABEL_MAP[stage] ?? stage}</a>`
      ).join('') + (mostFreqStagesFiltered.length > 3 ? `<button type='button' class='dsb-stage-expand-btn' style='background:none; border:none; color:#1976d2; font-size:13px; font-weight:500; margin-left:6px; cursor:pointer; padding:0; text-decoration:underline; transition:color 0.15s;'>${showAllStages ? 'Show less' : 'Show more'}</button>` : '');
    };
    const renderFlowLinks = () => {
      const arr = showAllFlows ? mostFreqFlowsFiltered : mostFreqFlowsFiltered.slice(0, 3);
      return arr.map(flow => {
        const [from, to] = flow.split(/->|→/);
        const fromColor = this.colorMap.get(from) || '#1976d2';
        const toColor = this.colorMap.get(to) || '#42a5f5';
        return `<div style=\"margin-bottom:4px;\"><a href=\"#\" class=\"dsb-flow-link\" data-flow=\"${flow}\" style=\"cursor:pointer; font-weight:600; font-size:14px; text-decoration:none; border-bottom:2px solid; border-image:linear-gradient(90deg, ${fromColor}, ${toColor}) 1;\"><span style=\"background: linear-gradient(90deg, ${fromColor}, ${toColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent;\">${LABEL_MAP[from] ?? from} → ${LABEL_MAP[to] ?? to}</span></a></div>`;
      }).join('') + (mostFreqFlowsFiltered.length > 3 ? `<button type='button' class='dsb-flow-expand-btn' style='background:none; border:none; color:#1976d2; font-size:13px; font-weight:500; margin-left:6px; cursor:pointer; padding:0; text-decoration:underline; transition:color 0.15s;'>${showAllFlows ? 'Show less' : 'Show more'}</button>` : '');
    };

    const stageCounts: Record<string, number> = {};
    cells.forEach((c: any) => {
      const stage = String(c["1st-level label"] ?? "None");
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    });

    const sortedStages = Object.entries(stageCounts).sort((a, b) => b[1] - a[1]);

    const { colorMap } = this;
    const maxBar = Math.max(...sortedStages.map(([_, n]) => n), 1);
    const barW = 28, barH = 64, gap = 10;
    const svgW = sortedStages.length * (barW + gap);
    const svgH = barH + 38;

    const barChart = `<svg width="100%" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="overflow:visible;">
      <g>
        ${sortedStages
        .filter(([stage]) => stage !== "None")
        .map(([stage, n], i) => `
            <rect x="${i * (barW + gap)}"
                  y="${barH - (n / maxBar) * barH}"
                  width="${barW}"
                  height="${(n / maxBar) * barH}"
                  fill="${colorMap.get(stage) || '#bbb'}"
                  rx="4" ry="4"
                  data-tooltip="${LABEL_MAP?.[stage] ?? stage}: ${n}">
            </rect>
            <text x="${i * (barW + gap) + barW / 2}"
                  y="${barH - (n / maxBar) * barH - 6}"
                  font-size="12"
                  text-anchor="middle"
                  fill="#222">${n}</text>
          `).join('')}
      </g>
    </svg>`;

    // 计算选中stage和transition的统计信息
    let selectedStageInfo = '';
    let selectedTransitionInfo = '';

    if (this.filter && this.filter.type === 'stage') {
      const stageCells = cells.filter((cell: any) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        return stage === this.filter.stage;
      });
      const selectedStageCount = stageCells.length;
      const selectedStageCodeCells = stageCells.filter((cell: any) => cell.cellType === 'code');
      let selectedStageAvgLines = 0;
      if (selectedStageCodeCells.length > 0) {
        const totalLines = selectedStageCodeCells.reduce((sum: number, cell: any) => {
          const code = cell.source ?? cell.code ?? '';
          return sum + code.split(/\r?\n/).length;
        }, 0);
        selectedStageAvgLines = totalLines / selectedStageCodeCells.length;
      }
      const stageColor = this.colorMap.get(this.filter.stage) || '#1976d2';
      const stageLabel = LABEL_MAP[this.filter.stage] ?? this.filter.stage;
      selectedStageInfo = `
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#555;">
            <span style="font-weight:500;">Selected Stage: <span style="color:${stageColor}; font-weight:600;">${stageLabel}</span></span>
          </div>
          <div style="display:flex; flex-direction:row; gap:18px;">
            <div style="flex:1;">
              <div style="font-size:13px; color:#888;">Occurrences</div>
              <div style="font-size:20px; font-weight:600;">${selectedStageCount}</div>
            </div>
            <div style="flex:1;">
              <div style="font-size:13px; color:#888;">Avg Lines</div>
              <div style="font-size:20px; font-weight:600;">${selectedStageAvgLines.toFixed(1)}</div>
            </div>
          </div>
        </div>
      `;
    } else if (this.filter && this.filter.type === 'flow') {
      let flowCount = 0;
      let totalLines = 0;
      let codeCellCount = 0;

      // 先构建stage序列（连续的相同stage合并）
      const stageSeq: string[] = [];
      // 只考虑code cell，与LeftSidebar保持一致
      const codeCells = cells.filter((c: any) => c.cellType === 'code');
      for (let i = 0; i < codeCells.length; i++) {
        const stage = String(codeCells[i]["1st-level label"] ?? 'None');
        if (stageSeq.length === 0 || stageSeq[stageSeq.length - 1] !== stage) {
          stageSeq.push(stage);
        }
      }

      // 计算stage序列中的transitions
      for (let i = 0; i < stageSeq.length - 1; i++) {
        const from = stageSeq[i];
        const to = stageSeq[i + 1];
        if (from === this.filter.from && to === this.filter.to) {
          flowCount++;
        }
      }

      // 单独计算from stage的code cells平均行数
      for (let i = 0; i < cells.length; i++) {
        const cellStage = String(cells[i]["1st-level label"] ?? 'None');
        if (cellStage === this.filter.from && cells[i].cellType === 'code') {
          const code = cells[i].source ?? cells[i].code ?? '';
          totalLines += code.split(/\r?\n/).length;
          codeCellCount++;
        }
      }
      const avgLines = codeCellCount > 0 ? totalLines / codeCellCount : 0;
      const fromColor = this.colorMap.get(this.filter.from) || '#1976d2';
      const toColor = this.colorMap.get(this.filter.to) || '#42a5f5';
      const fromLabel = LABEL_MAP[this.filter.from] ?? this.filter.from;
      const toLabel = LABEL_MAP[this.filter.to] ?? this.filter.to;
      selectedTransitionInfo = `
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#555;">
            <span style="font-weight:500;">Selected Transition: <span style="background: linear-gradient(90deg, ${fromColor}, ${toColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent; font-weight:600;">${fromLabel} → ${toLabel}</span></span>
          </div>
          <div style="display:flex; flex-direction:row; gap:18px;">
            <div style="flex:1;">
              <div style="font-size:13px; color:#888;">Occurrences</div>
              <div style="font-size:20px; font-weight:600;">${flowCount}</div>
            </div>
            <div style="flex:1;">
              <div style="font-size:13px; color:#888;">Avg Lines</div>
              <div style="font-size:20px; font-weight:600;">${avgLines.toFixed(1)}</div>
            </div>
          </div>
        </div>
      `;
    }

    // 插入内容
    this.node.innerHTML = `
      <div style="padding:28px 18px 18px 18px; font-size:15px; color:#222; max-width:420px; margin:0 auto;">
        <div style="font-size:20px; font-weight:700; margin-bottom:18px; line-height:1.2; word-break:break-all;" id="detail-sidebar-title"><span style="${this._getTitleStyle()}">Notebook ${nb.globalIndex !== undefined ? nb.globalIndex + 1 : ''}: ${nb.notebook_name ?? nb.kernelVersionId}</span></div>
        
        ${nb.creationDate || nb.totalLines ? `
        <div style="display:flex; flex-direction:row; gap:18px; margin-bottom:18px;">
          ${nb.creationDate ? `
          <div style="flex:1;">
            <div style="font-size:13px; color:#888;">Creation Date</div>
            <div style="font-size:16px; font-weight:600;">${nb.creationDate}</div>
          </div>
          ` : ''}
          ${nb.totalLines ? `
          <div style="flex:1;">
            <div style="font-size:13px; color:#888;">Total Lines</div>
            <div style="font-size:16px; font-weight:600;">${nb.totalLines.toLocaleString()}</div>
          </div>
          ` : ''}
        </div>
        ` : ''}
        
        <div style="display:flex; flex-direction:row; gap:18px; margin-bottom:18px;">
          <div style="flex:1;">
            <div style="font-size:13px; color:#888;">Total Cells</div>
            <div style="font-size:20px; font-weight:600;">${total}</div>
          </div>
          <div style="flex:1;">
            <div style="font-size:13px; color:#888;">Code Cells</div>
            <div style="font-size:20px; font-weight:600;">${codeCount}</div>
          </div>
          <div style="flex:1;">
            <div style="font-size:13px; color:#888;">Markdown Cells</div>
            <div style="font-size:20px; font-weight:600;">${mdCount}</div>
          </div>
        </div>
        
        <div style="font-size:16px; font-weight:600; margin-bottom:10px;">Stage Analysis</div>
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#555;"><span style="font-weight:500;">Most Common Stage(s)</span><span style="color:#1976d2; font-size:14px; font-weight:600;">${stageCountText}</span></div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;" id="dsb-stage-links">${renderStageLinks()}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#555;"><span style="font-weight:500;">Most Common Transition(s)</span><span style="color:#1976d2; font-size:14px; font-weight:600;">${flowCountText}</span></div>
          <div style="display:flex; flex-direction:column; gap:4px;" id="dsb-flow-links">${renderFlowLinks()}</div>
        </div>
        <div style="margin:18px 0 8px 0; font-weight:600; font-size:15px;">Stage Frequency Distribution</div>
        <div style="height:16px;"></div>
        <div style="margin: 8px 0 12px 0; width:100%; max-width:600px; margin-left:auto; margin-right:auto;">${barChart}</div>
        
        ${selectedStageInfo}
        ${selectedTransitionInfo}
        
        ${nb.toc && nb.toc.length > 0 ? `
        <div style="margin:18px 0 8px 0; font-weight:600; font-size:15px;">Table of Contents</div>
        <div class="toc-scroll" style="background:#f8f9fa; border-radius:8px; padding:20px; margin-bottom:16px; max-height:300px; overflow-y:auto; overflow-x:hidden; border:1px solid #e0e0e0;">
          ${nb.toc.map((item: any) => {
      // 统计#数量，决定层级
      const match = item.heading.match(/^(#+)\s+/);
      const level = match ? match[1].length : 1;
      const marginLeft = 12 * (level - 1);
      const fontSize = level === 1 ? 15 : (level === 2 ? 14 : 13);
      const fontWeight = level === 1 ? 600 : (level === 2 ? 500 : 400);
      const color = level === 1 ? '#1976d2' : (level === 2 ? '#1565c0' : '#666');
      const padding = level === 1 ? '8px 0' : (level === 2 ? '6px 0' : '4px 0');
      return `
              <div style="margin-bottom:2px; margin-left:${marginLeft}px;">
                <div class="toc-item" data-cell-id="${item.cellId}" 
                     style="color:${color}; font-size:${fontSize}px; font-weight:${fontWeight}; cursor:pointer; line-height:1.4; padding:${padding}; border-radius:4px; transition:all 0.2s ease;"
                     onmouseover="this.style.background='#e3f2fd'; this.style.color='#1565c0';"
                     onmouseout="this.style.background='transparent'; this.style.color='${color}';">
                  ${item.heading.replace(/^#+\s*/, '')}
                </div>
              </div>
            `;
    }).join('')}
        </div>
        ` : `
        <div style="margin:18px 0 8px 0; font-weight:600; font-size:15px;">Table of Contents</div>
        <div style="background:#f8f9fa; border-radius:8px; padding:20px; margin-bottom:16px; color:#888; font-size:14px; text-align:center; border:1px solid #e0e0e0;">
          No table of contents available for this notebook.
        </div>
        `}
      </div>
      <style>
        /* TOC滚动条样式 */
        .toc-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .toc-scroll::-webkit-scrollbar-track {
          background: #f5f5f5;
          border-radius: 4px;
        }
        .toc-scroll::-webkit-scrollbar-thumb {
          background: #d0d0d0;
          border-radius: 4px;
          border: 1px solid #f5f5f5;
        }
        .toc-scroll::-webkit-scrollbar-thumb:hover {
          background: #b0b0b0;
        }
        /* TOC项目悬停效果 */
        .toc-item:hover {
          transform: translateX(2px);
        }
      </style>
    `;

    // ✅ Tooltip 注入 + 事件绑定
    setTimeout(() => {
      let tooltip = document.getElementById("tooltip");
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "tooltip";
        tooltip.style.position = "absolute";
        tooltip.style.background = "rgba(0, 0, 0, 0.8)";
        tooltip.style.color = "white";
        tooltip.style.padding = "6px 10px";
        tooltip.style.fontSize = "12px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.pointerEvents = "none";
        tooltip.style.opacity = "0";
        tooltip.style.transition = "opacity 0.2s ease";
        tooltip.style.zIndex = "9999";
        document.body.appendChild(tooltip);
      }

      const bars = this.node.querySelectorAll("rect[data-tooltip]");
      bars.forEach((bar) => {
        bar.addEventListener("mouseenter", () => {
          tooltip!.textContent = bar.getAttribute("data-tooltip") ?? '';
          tooltip!.style.opacity = "1";
        });

        bar.addEventListener("mousemove", (e) => {
          tooltip!.style.left = `${(e as MouseEvent).pageX + 10}px`;
          tooltip!.style.top = `${(e as MouseEvent).pageY + 10}px`;
        });

        bar.addEventListener("mouseleave", () => {
          tooltip!.style.opacity = "0";
        });
      });

      // 绑定stage和flow链接事件
      const stageLinks = this.node.querySelectorAll('.dsb-stage-link');
      const flowLinks = this.node.querySelectorAll('.dsb-flow-link');

      stageLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const stage = (link as HTMLElement).getAttribute('data-stage');
          if (stage) {
            // 触发stage选中效果，与选中block相同
            this.setFilter({ type: 'stage', stage });
          }
        });
      });

      flowLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const flow = (link as HTMLElement).getAttribute('data-flow');
          if (flow) {
            // 解析flow字符串，格式为 "from→to" 或 "from->to"
            const [from, to] = flow.split(/→|->/);
            if (from && to) {
              // 触发flow选中效果，与选中flow相同
              this.setFilter({ type: 'flow', from, to });
            }
          }
        });
      });

      // 绑定TOC项目点击事件
      const tocItems = this.node.querySelectorAll('.toc-item');
      tocItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const cellId = (item as HTMLElement).getAttribute('data-cell-id');
          if (cellId) {
            window.dispatchEvent(new CustomEvent('galaxy-toc-item-clicked', {
              detail: { cellId: cellId }
            }));
          }
        });
      });
    }, 0);
    // 展开/收起事件绑定（notebook detail）
    setTimeout(() => {
      // 绑定stage和flow链接事件
      const stageLinks = this.node.querySelectorAll('.dsb-stage-link');
      const flowLinks = this.node.querySelectorAll('.dsb-flow-link');

      stageLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const stage = (link as HTMLElement).getAttribute('data-stage');
          if (stage) {
            // 触发stage选中效果，与选中block相同
            this.setFilter({ type: 'stage', stage });
          }
        });
      });

      flowLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const flow = (link as HTMLElement).getAttribute('data-flow');
          if (flow) {
            // 解析flow字符串，格式为 "from→to" 或 "from->to"
            const [from, to] = flow.split(/→|->/);
            if (from && to) {
              // 触发flow选中效果，与选中flow相同
              this.setFilter({ type: 'flow', from, to });
            }
          }
        });
      });

      const stageLinksDiv = this.node.querySelector('#dsb-stage-links');
      const flowLinksDiv = this.node.querySelector('#dsb-flow-links');
      if (stageLinksDiv) {
        stageLinksDiv.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('dsb-stage-expand') || target.classList.contains('dsb-stage-expand-btn')) {
            showAllStages = !showAllStages;
            stageLinksDiv.innerHTML = renderStageLinks();
          }
        });
      }
      if (flowLinksDiv) {
        flowLinksDiv.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('dsb-flow-expand') || target.classList.contains('dsb-flow-expand-btn')) {
            showAllFlows = !showAllFlows;
            flowLinksDiv.innerHTML = renderFlowLinks();
          }
        });
      }
      // 按钮hover效果
      const addHover = (selector: string) => {
        const btns = this.node.querySelectorAll(selector);
        btns.forEach(btn => {
          btn.addEventListener('mouseenter', () => {
            (btn as HTMLElement).style.textDecoration = 'underline';
            (btn as HTMLElement).style.color = '#1251a2';
          });
          btn.addEventListener('mouseleave', () => {
            (btn as HTMLElement).style.textDecoration = 'underline';
            (btn as HTMLElement).style.color = '#1976d2';
          });
        });
      };
      addHover('.dsb-stage-expand-btn');
      addHover('.dsb-flow-expand-btn');

      // 绑定TOC项目点击事件
      const tocItems = this.node.querySelectorAll('.toc-item');
      tocItems.forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const cellId = (item as HTMLElement).getAttribute('data-cell-id');
          if (cellId) {
            window.dispatchEvent(new CustomEvent('galaxy-toc-item-clicked', {
              detail: { cellId: cellId }
            }));
          }
        });
      });
    }, 0);
  }



  setCellDetail(cell: any) {
    this.currentNotebook = cell.notebook; // 保存当前 notebook
    // 在cell detail视图下，不改变标题颜色
    this._currentSelection = null;
    this.saveDetailFilterState();
    // Show cell details in English, including stage name
    const code = cell.source ?? cell.code ?? '';
    const codeLines = code.split(/\r?\n/);
    const stage = cell["1st-level label"] ?? '';
    const stageLabel = stage ? (LABEL_MAP[stage] ?? stage) : '';
    // 尝试获取 notebook index 和 cell index
    const nbIdx = cell.notebookIndex !== undefined ? cell.notebookIndex + 1 : '';
    const cellIdx = cell.cellIndex !== undefined ? cell.cellIndex + 1 : '';
    // 统计所有该 stage 的 cell 在各自 notebook 中的相对位置
    let allStagePositions: number[] = [];
    let currentCellPosition: number | null = null;
    let allNotebooks: any[] = [];
    if (this._allData && Array.isArray(this._allData) && this._allData.length > 0) {
      allNotebooks = this._allData.map((nb, i) => ({ ...nb, index: nb.index !== undefined ? nb.index : i }));
    } else if (cell && cell._notebookDetail) {
      allNotebooks = [{ ...cell._notebookDetail, index: cell._notebookDetail.index !== undefined ? cell._notebookDetail.index : 0 }];
    }
    if (cell && cell["1st-level label"]) {
      const stage = cell["1st-level label"];
      allNotebooks.forEach((nb: any) => {
        const cells = nb.cells ?? [];
        const stageCells = cells
          .map((c: any, idx: number) => ({ c, idx }))
          .filter(({ c }) => c["1st-level label"] === stage && c.cellType === 'code');
        stageCells.forEach(({ idx }) => {
          if (cells.length > 1) {
            allStagePositions.push(idx / (cells.length - 1));
          } else {
            allStagePositions.push(0);
          }
        });
      });
      // 当前 cell 的相对位置
      if (cell.cellIndex !== undefined && cell._notebookDetail && cell._notebookDetail.cells?.length > 1) {
        currentCellPosition = cell.cellIndex / (cell._notebookDetail.cells.length - 1);
      } else if (cell.cellIndex !== undefined) {
        currentCellPosition = 0;
      }
    }
    // 统计分布
    const binCount = 20;
    const bins = Array(binCount).fill(0);
    allStagePositions.forEach(pos => {
      const bin = Math.min(binCount - 1, Math.floor(pos * binCount));
      bins[bin]++;
    });
    const maxBin = Math.max(...bins, 1);
    const avgPos = allStagePositions.length ? allStagePositions.reduce((a, b) => a + b, 0) / allStagePositions.length : null;
    // 柱状图 SVG
    const chartW = 220, chartH = 48, barW = chartW / binCount;
    // 获取当前 stage 的主色
    const stageLabelStr = String((cell && cell["1st-level label"]) ?? "None");
    const stageColor = this.colorMap?.get?.(stageLabelStr) || '#90caf9';
    let barsSvg = '';
    for (let i = 0; i < binCount; ++i) {
      const x = i * barW;
      const h = bins[i] / maxBin * (chartH - 16);
      const binStart = (i / binCount).toFixed(2);
      const binEnd = ((i + 1) / binCount).toFixed(2);
      const tooltip = `Pos: [${binStart}, ${binEnd})\nCount: ${bins[i]}`;
      barsSvg += `<rect x="${x}" y="${chartH - h}" width="${barW - 2}" height="${h}" fill="${stageColor}" rx="2" data-tooltip="${tooltip}" />`;
    }
    // 平均位置线
    let avgLineSvg = '';
    if (avgPos !== null) {
      const avgX = avgPos * chartW;
      avgLineSvg = `<line x1="${avgX}" y1="0" x2="${avgX}" y2="${chartH}" stroke="#1976d2" stroke-width="2" stroke-dasharray="3,2" />`;
    }
    // 当前 cell 位置高亮
    let currLineSvg = '';
    if (currentCellPosition !== null) {
      const currX = currentCellPosition * chartW;
      currLineSvg = `<line x1="${currX}" y1="0" x2="${currX}" y2="${chartH}" stroke="#c41a16" stroke-width="2" />`;
    }
    // 横纵坐标标注
    const axisTicks = [0, 0.25, 0.5, 0.75, 1];
    const axisSvg = [
      // 横坐标主线
      `<line x1="0" y1="${chartH}" x2="${chartW}" y2="${chartH}" stroke="#bbb" stroke-width="1" />`,
      // 横坐标刻度
      ...axisTicks.map(t => `<text x="${t * chartW}" y="${chartH + 12}" font-size="11" fill="#888" text-anchor="middle">${t}</text>`),
      // 纵坐标主线
      `<line x1="0" y1="0" x2="0" y2="${chartH}" stroke="#bbb" stroke-width="1" />`,
      // 纵坐标最大值和0
      `<text x="-2" y="10" font-size="11" fill="#888" text-anchor="end">${maxBin}</text>`,
      `<text x="-2" y="${chartH}" font-size="11" fill="#888" text-anchor="end">0</text>`
    ].join('');
    const chartSvg = `<svg width="100%" height="${chartH + 22}" viewBox="-18 0 ${chartW + 18} ${chartH + 22}">${barsSvg}${avgLineSvg}${currLineSvg}${axisSvg}</svg>`;
    // legend 英文精致版
    const legendHtml = `<div style="display:flex; align-items:center; gap:14px; font-size:12px; color:#888; margin-top:2px; justify-content:center;">
      <span style="display:inline-flex;align-items:center;"><span style="display:inline-block;width:18px;height:8px;background:${stageColor};border-radius:2px;margin-right:4px;"></span>Count</span>
      <span style="display:inline-flex;align-items:center;"><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #1976d2;margin-right:4px;"></span>Mean</span>
      <span style="display:inline-flex;align-items:center;"><span style="display:inline-block;width:14px;height:0;border-top:2px solid #c41a16;margin-right:4px;"></span>Current Cell</span>
    </div>`;
    // cellType label tag
    const cellTypeLabel = cell.cellType ? `<span style="display:inline-block; background:#e3eaf3; color:#1976d2; font-size:12px; border-radius:4px; padding:2px 8px; margin-left:8px; vertical-align:middle;">${cell.cellType}</span>` : '';
    // tab header
    const tabHeader = `<div style="display:flex; justify-content:center; gap:2px; margin:18px 0 10px 0;">
      <button class="galaxy-tab-btn" data-tab="first" style="padding:6px 28px 6px 28px; border:none; border-bottom:2px solid #1976d2; border-radius:6px 6px 0 0; background:#fff; color:#1976d2; font-weight:700; font-size:15px; cursor:pointer; transition:color 0.15s;">first stage</button>
      <button class="galaxy-tab-btn" data-tab="second" style="padding:6px 28px 6px 28px; border:none; border-bottom:2px solid transparent; border-radius:6px 6px 0 0; background:#f7f9fb; color:#888; font-weight:600; font-size:15px; cursor:pointer; transition:color 0.15s;">second stage</button>
    </div>`;
    // 获取所有notebook和当前notebook索引
    const allNotebooksArr = Array.isArray(this._allData) && this._allData.length > 0 ? this._allData.map((nb, i) => ({ ...nb, index: nb.index !== undefined ? nb.index : i })) : (cell && cell._notebookDetail ? [{ ...cell._notebookDetail, index: cell._notebookDetail.index !== undefined ? cell._notebookDetail.index : 0 }] : []);
    const currentNbIdx = cell.notebookIndex !== undefined ? cell.notebookIndex : 0;
    // 下拉框HTML
    const notebookSelectHtml = `<div style="margin:18px 0 8px 0;">
      <label style="font-size:13px; color:#888; margin-right:8px;">Notebook:</label>
      <select id="galaxy-stage-nb-select" style="font-size:14px; padding:3px 10px; border-radius:4px; border:1px solid #bbb;">
        ${allNotebooksArr.map((nb, i) => `<option value="${i}" ${i === currentNbIdx ? 'selected' : ''}>${nb.kernelVersionId ?? nb.path ?? 'Notebook ' + (i + 1)}</option>`).join('')}
      </select>
    </div>`;
    // cell卡片渲染函数（完全按照NotebookDetailWidget的方式）
    const renderStageCellCards = (nb: any, stage: string) => {
      const cells = (nb.cells ?? [])
        .map((c: any, i: number) => ({ ...c, cellIndex: i }))
        .filter((c: any) => c["1st-level label"] === stage && c.cellIndex !== cell.cellIndex);
      if (!cells.length) return '<div style="color:#aaa; font-size:13px; margin-bottom:12px;">No other cells in this stage in this notebook.</div>';

      // 创建容器div
      const containerDiv = document.createElement('div');
      containerDiv.style.display = 'flex';
      containerDiv.style.flexDirection = 'column';
      containerDiv.style.gap = '14px';
      containerDiv.style.marginBottom = '12px';

      cells.forEach((c: any) => {
        const content = c.source ?? c.code ?? '';
        const cellIdx = c.cellIndex !== undefined ? c.cellIndex + 1 : '';
        const nbIdx = c.notebookIndex !== undefined ? c.notebookIndex : (nb.index !== undefined ? nb.index : 0);

        // cell外层div
        const wrapper = document.createElement('div');
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
        idxDiv.textContent = `[${cellIdx}]`;
        left.appendChild(idxDiv);

        // 跳转图标
        const jumpIcon = document.createElement('div');
        jumpIcon.className = 'nbd-jump-icon';
        jumpIcon.setAttribute('data-nb-idx', String(nbIdx));
        jumpIcon.setAttribute('data-cell-idx', String(c.cellIndex));
        jumpIcon.style.cursor = 'pointer';
        jumpIcon.style.marginTop = '2px';
        jumpIcon.style.textAlign = 'right';
        jumpIcon.style.fontSize = '12px';
        jumpIcon.style.color = '#999';
        jumpIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7" stroke="#1976d2" stroke-width="2"/><circle cx="10" cy="10" r="2.5" fill="#1976d2"/><line x1="10" y1="3" x2="10" y2="0" stroke="#1976d2" stroke-width="1.5"/><line x1="10" y1="17" x2="10" y2="20" stroke="#1976d2" stroke-width="1.5"/><line x1="3" y1="10" x2="0" y2="10" stroke="#1976d2" stroke-width="1.5"/><line x1="17" y1="10" x2="20" y2="10" stroke="#1976d2" stroke-width="1.5"/></svg>';
        left.appendChild(jumpIcon);

        // cell内容区
        const cellDiv = document.createElement('div');
        cellDiv.className = 'nbd-cell';
        cellDiv.setAttribute('contenteditable', 'false');
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
        if (c.cellType === 'markdown') {
          try {
            // 确保JupyterLab样式已加载
            this.ensureJupyterlabThemeStyle();

            // 尝试使用HTML渲染器
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
            console.error('HTML rendering failed for cell:', c.cellIndex, 'error:', error);
            // 如果JupyterLab渲染器失败，使用简单的HTML渲染
            const fallbackDiv = document.createElement('div');
            fallbackDiv.className = 'nbd-md-area';
            fallbackDiv.innerHTML = this.simpleMarkdownRender(content);
            contentDiv.appendChild(fallbackDiv);
          }
        } else if (c.cellType === 'code') {
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
        containerDiv.appendChild(wrapper);
      });

      return containerDiv.outerHTML;
    }
    // tab content
    const tabContent = `<div class="galaxy-tab-content" data-tab-content="first">
      <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
        <tr>
          <td style="font-weight:500;">Stage</td>
          <td style="text-align:right;">
            <button style="background:${stageColor}; color:#fff; border:none; border-radius:16px; padding:3px 18px; font-size:15px; font-weight:700; cursor:pointer;">${stageLabel}</button>
          </td>
        </tr>
        <tr>
          <td style="font-weight:500;">Code lines</td>
          <td style="text-align:right; font-weight:600; color:#222;">${codeLines.length}</td>
        </tr>
      </table>
      <div style="font-size:16px; font-weight:600; margin-bottom:10px; color:#222;">Stage Position Distribution</div>
      <div style="width:100%; max-width:320px; margin-bottom:12px;">${chartSvg}</div>
      ${legendHtml}
      <div style="font-size:16px; font-weight:600; margin-bottom:10px; color:#222;">Code Line Count Distribution</div>
      <div style="width:100%; max-width:320px;">${this._renderCodeLineDistChart(cell, allNotebooks, stageColor)}</div>
      <div style="font-size:16px; font-weight:600; margin:18px 0 10px 0; color:#222;">Cells in this Stage</div>
      ${notebookSelectHtml}
      <div id="galaxy-stage-cell-list">${renderStageCellCards(allNotebooksArr[currentNbIdx], cell["1st-level label"] ?? "")}</div>
    </div>
    <div class="galaxy-tab-content" data-tab-content="second" style="display:none;"></div>`;
    this.node.innerHTML = `<div style="padding:24px 18px 18px 18px; margin:18px 0; width:100%; font-size:15px; color:#222; box-sizing:border-box;">
      <div style="font-size:17px; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:10px; flex-wrap;" id="detail-sidebar-title">
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="dsb-back-btn" style="cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Back to notebook overview">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 10H5M5 10L10 15M5 10L10 5" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span style="color:#3182bd; font-weight:600;">Notebook ${nbIdx ? + nbIdx : ''}</span>
        </div>
        ${cellIdx ? `<span style='color:#888; font-size:14px;'>/ Cell ${cellIdx}</span>` : ''}
        ${cellTypeLabel}
      </div>
      ${tabHeader}
      ${tabContent}
    </div>
    <style>
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
    </style>`;
    // tab 切换逻辑
    setTimeout(() => {
      const btns = this.node.querySelectorAll('.galaxy-tab-btn');
      const contents = this.node.querySelectorAll('.galaxy-tab-content');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          btns.forEach(b => {
            if (b.getAttribute('data-tab') === btn.getAttribute('data-tab')) {
              b.setAttribute('style', 'padding:6px 28px 6px 28px; border:none; border-bottom:2px solid #1976d2; border-radius:6px 6px 0 0; background:#fff; color:#1976d2; font-weight:700; font-size:15px; cursor:pointer; transition:color 0.15s;');
            } else {
              b.setAttribute('style', 'padding:6px 28px 6px 28px; border:none; border-bottom:2px solid transparent; border-radius:6px 6px 0 0; background:#f7f9fb; color:#888; font-weight:600; font-size:15px; cursor:pointer; transition:color 0.15s;');
            }
          });
          contents.forEach(c => {
            c.setAttribute('style', c.getAttribute('data-tab-content') === btn.getAttribute('data-tab') ? '' : 'display:none;');
          });
        });
        // 鼠标悬浮效果
        btn.addEventListener('mouseenter', () => {
          if (!btn.classList.contains('active')) (btn as HTMLElement).style.color = '#1976d2';
        });
        btn.addEventListener('mouseleave', () => {
          if (!btn.classList.contains('active') && btn.getAttribute('data-tab') === 'second') (btn as HTMLElement).style.color = '#888';
        });
      });
      // 默认激活 first stage
      (btns[0] as HTMLElement).click();
      // 为跳转icon绑定事件
      function bindJumpIconEvents(cellListDiv: HTMLElement | null) {
        if (!cellListDiv) return;
        const jumpIcons = cellListDiv.querySelectorAll('.nbd-jump-icon');
        if (!jumpIcons) return;
        jumpIcons.forEach(icon => {
          icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const nbIdx = parseInt((icon as HTMLElement).getAttribute('data-nb-idx') || '0', 10);
            const cellIdx = parseInt((icon as HTMLElement).getAttribute('data-cell-idx') || '0', 10);
            // 智能 notebook 跳转/高亮
            if (allNotebooksArr[nbIdx]) {
              const currentNotebookIndex = (window as any).galaxyCurrentNotebookDetail?.index;
              if (currentNotebookIndex === nbIdx) {
                window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
                  detail: { notebookIndex: nbIdx, cellIndex: cellIdx }
                }));
                // 不再立即触发 cell-detail 事件
              } else {
                // 不是当前 notebook，切换 notebook
                window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', {
                  detail: { notebook: allNotebooksArr[nbIdx], jumpCellIndex: cellIdx }
                }));
                setTimeout(() => {
                  const targetCell = allNotebooksArr[nbIdx].cells[cellIdx];
                  if (targetCell) {
                    window.dispatchEvent(new CustomEvent('galaxy-cell-detail', {
                      detail: { cell: { ...targetCell, notebookIndex: nbIdx, cellIndex: cellIdx, _notebookDetail: allNotebooksArr[nbIdx] } }
                    }));
                  }
                }, 0);
              }
            }
          });
        });
      }
      // notebook下拉框切换事件
      const nbSelect = this.node.querySelector('#galaxy-stage-nb-select') as HTMLSelectElement;
      const cellListDiv = this.node.querySelector('#galaxy-stage-cell-list');
      if (nbSelect && cellListDiv) {
        nbSelect.addEventListener('change', () => {
          const nbIdx = parseInt(nbSelect.value, 10);
          cellListDiv.innerHTML = renderStageCellCards(allNotebooksArr[nbIdx], cell["1st-level label"] ?? "");
          // 重新绑定 jump icon 事件
          bindJumpIconEvents(cellListDiv as HTMLElement);

          // 激活Prism.js行号
          setTimeout(() => {
            const Prism = (window as any).Prism;
            if (Prism && Prism.plugins && Prism.plugins.lineNumbers) {
              Prism.highlightAll();
            }
          }, 50);
        });
      }
      // 初始绑定
      bindJumpIconEvents(cellListDiv as HTMLElement);
    }, 0);
    // 绑定 notebook 返回事件
    setTimeout(() => {
      const backBtn = this.node.querySelector('.dsb-back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          // 直接返回到当前notebook的概览视图，不打开新tab，不清除cell selection
          if (cell._notebookDetail) {
            this.setNotebookDetail(cell._notebookDetail, true); // skipEventDispatch = true
          } else if ((window as any).galaxyCurrentNotebookDetail) {
            this.setNotebookDetail((window as any).galaxyCurrentNotebookDetail, true); // skipEventDispatch = true
          }
        });
      }
    }, 0);
    // 绑定柱状图 tooltip 事件
    setTimeout(() => {
      // code line 分布图 tooltip
      const codeLineSvg = this.node.querySelector('svg[data-cdf]');
      if (codeLineSvg) {
        let tooltipDiv = document.getElementById('galaxy-tooltip');
        if (!tooltipDiv) {
          tooltipDiv = document.createElement('div');
          tooltipDiv.id = 'galaxy-tooltip';
          tooltipDiv.style.position = 'fixed';
          tooltipDiv.style.display = 'none';
          tooltipDiv.style.pointerEvents = 'none';
          tooltipDiv.style.background = 'rgba(0,0,0,0.75)';
          tooltipDiv.style.color = '#fff';
          tooltipDiv.style.padding = '6px 10px';
          tooltipDiv.style.borderRadius = '4px';
          tooltipDiv.style.fontSize = '12px';
          tooltipDiv.style.zIndex = '9999';
          document.body.appendChild(tooltipDiv);
        }
        const points = codeLineSvg.querySelectorAll('circle[data-tooltip]');
        points.forEach((pt) => {
          pt.addEventListener('mouseenter', (e) => {
            tooltipDiv!.textContent = pt.getAttribute('data-tooltip') ?? '';
            tooltipDiv!.style.display = 'block';
          });
          pt.addEventListener('mousemove', (e) => {
            tooltipDiv!.style.left = (e as MouseEvent).clientX + 12 + 'px';
            tooltipDiv!.style.top = (e as MouseEvent).clientY + 12 + 'px';
          });
          pt.addEventListener('mouseleave', () => {
            tooltipDiv!.style.display = 'none';
          });
        });
      }
      // 其它柱状图 tooltip
      const chartDiv = this.node.querySelector('svg');
      if (!chartDiv) return;
      let tooltipDiv = document.getElementById('galaxy-tooltip');
      if (!tooltipDiv) {
        tooltipDiv = document.createElement('div');
        tooltipDiv.id = 'galaxy-tooltip';
        tooltipDiv.style.position = 'fixed';
        tooltipDiv.style.display = 'none';
        tooltipDiv.style.pointerEvents = 'none';
        tooltipDiv.style.background = 'rgba(0,0,0,0.75)';
        tooltipDiv.style.color = '#fff';
        tooltipDiv.style.padding = '6px 10px';
        tooltipDiv.style.borderRadius = '4px';
        tooltipDiv.style.fontSize = '12px';
        tooltipDiv.style.zIndex = '9999';
        document.body.appendChild(tooltipDiv);
      }
      const bars = chartDiv.querySelectorAll('rect[data-tooltip]');
      bars.forEach((bar) => {
        bar.addEventListener('mouseenter', (e) => {
          tooltipDiv!.textContent = bar.getAttribute('data-tooltip') ?? '';
          tooltipDiv!.style.display = 'block';
        });
        bar.addEventListener('mousemove', (e) => {
          tooltipDiv!.style.left = (e as MouseEvent).clientX + 12 + 'px';
          tooltipDiv!.style.top = (e as MouseEvent).clientY + 12 + 'px';
        });
        bar.addEventListener('mouseleave', () => {
          tooltipDiv!.style.display = 'none';
        });
      });
    }, 0);

    // 激活Prism.js行号
    setTimeout(() => {
      const Prism = (window as any).Prism;
      if (Prism && Prism.plugins && Prism.plugins.lineNumbers) {
        Prism.highlightAll();
      }
    }, 50);
  }

  setFilter(selection: any, skipEventDispatch: boolean = false) {
    this.filter = selection;
    this._currentSelection = selection; // 更新当前选中状态

    // 设置全局筛选状态，供NotebookDetailWidget使用
    if (selection) {
      if (selection.type === 'stage') {
        (window as any)._galaxyFlowSelection = { type: 'stage', stage: selection.stage };
        const stageName = LABEL_MAP[selection.stage] || selection.stage;
        this._currentTitle = stageName;
      } else if (selection.type === 'flow') {
        (window as any)._galaxyFlowSelection = { type: 'flow', from: selection.from, to: selection.to };
        const fromName = LABEL_MAP[selection.from] || selection.from;
        const toName = LABEL_MAP[selection.to] || selection.to;
        const flowName = `${fromName} → ${toName}`;
        this._currentTitle = flowName;
      }
    } else {
      (window as any)._galaxyFlowSelection = null;
      this._currentTitle = this.currentNotebook ? 'Notebook Detail' : 'Notebook Overview';
    }

    this.saveDetailFilterState();

    // 只有在不跳过事件派发时才触发事件
    if (!skipEventDispatch) {
      // 触发筛选状态变化事件，通知NotebookDetailWidget重新渲染
      window.dispatchEvent(new CustomEvent('galaxy-flow-selection-changed', { detail: selection }));

      // 触发MatrixWidget和flowchart的事件通知
      if (selection) {
        if (selection.type === 'stage') {
          // 通知MatrixWidget和flowchart选中stage
          const tabId = this.getTabId();
          window.dispatchEvent(new CustomEvent('galaxy-stage-selected', { detail: { stage: selection.stage, tabId } }));
        } else if (selection.type === 'flow') {
          // 通知MatrixWidget和flowchart选中flow
          const tabId = this.getTabId();
          window.dispatchEvent(new CustomEvent('galaxy-flow-selected', { detail: { from: selection.from, to: selection.to, tabId } }));
        }
      } else {
        // 清除选中状态
        const tabId = this.getTabId();
        window.dispatchEvent(new CustomEvent('galaxy-selection-cleared', { detail: { tabId } }));
      }
    }

    // 根据当前状态调用相应的方法
    if (this.currentNotebook) {
      // 在notebook detail状态下，重新渲染notebook detail
      this.setNotebookDetail(this.currentNotebook, true); // 跳过事件派发，避免循环
    } else {
      this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
    }
  }

  setSummary(data: any[], mostFreqStage?: string, mostFreqFlow?: string, notebookOrder?: number[]) {
    this.currentNotebook = null;
    // 只在首次初始化时赋值 this._allData，后续不再覆盖
    if (!this._allData || !Array.isArray(this._allData) || this._allData.length === 0) {
      this._allData = data.map((nb, i) => ({ ...nb, globalIndex: i + 1 }));
    } else {
      // 补全缺失的globalIndex
      this._allData.forEach((nb, i) => {
        if (typeof nb.globalIndex !== 'number') nb.globalIndex = i + 1;
      });
    }
    // 更新notebookOrder
    if (notebookOrder && notebookOrder.length > 0) {
      this.notebookOrder = notebookOrder;
    }
    this._mostFreqStage = mostFreqStage;
    this._mostFreqFlow = mostFreqFlow;
    const hiddenStages = this._hiddenStages ?? new Set(['6', '1']);
    // 过滤掉 hiddenStages 的 cell
    let filteredData = data.map((nb) => {
      // 用 kernelVersionId 在 this._allData 里查找 globalIndex
      const orig = this._allData.find(item =>
        item.kernelVersionId && nb.kernelVersionId && item.kernelVersionId === nb.kernelVersionId
      );
      return {
        ...nb,
        globalIndex: orig ? orig.globalIndex : -1,
        cells: (nb.cells ?? []).filter(cell => {
          const stage = String(cell["1st-level label"] ?? "None");
          return !hiddenStages.has(stage);
        })
      };
    }).filter(nb => nb.cells.length > 0);
    if (this.filter) {
      if (this.filter.type === 'stage') {
        filteredData = filteredData.filter(nb => nb.cells.some((cell: any) => String(cell["1st-level label"] ?? "None") === this.filter.stage));
      } else if (this.filter.type === 'flow') {
        filteredData = filteredData.filter(nb => {
          const cells = nb.cells;
          for (let i = 0; i < cells.length - 1; i++) {
            const a = String(cells[i]["1st-level label"] ?? "None");
            const b = String(cells[i + 1]["1st-level label"] ?? "None");
            if (a === this.filter.from && b === this.filter.to) return true;
          }
          return false;
        });
      }
    }
    if (!filteredData || !Array.isArray(filteredData) || filteredData.length === 0) {
      this.setDefault();
      return;
    }
    // 统计
    const notebookCount = filteredData.length;

    // 根据是否有filter显示不同的统计信息
    if (this.filter) {
      // 有filter时：显示选中stage/flow的统计
      let totalOccurrences = 0;
      let containingNotebooks = 0;
      let avgPerNotebook = 0;

      if (this.filter.type === 'stage') {
        // 统计选中的stage
        filteredData.forEach(nb => {
          let stageCount = 0;
          nb.cells?.forEach((cell: any) => {
            const stage = String(cell["1st-level label"] ?? 'None');
            if (stage === this.filter.stage) {
              stageCount++;
            }
          });
          if (stageCount > 0) {
            containingNotebooks++;
            totalOccurrences += stageCount;
          }
        });
        avgPerNotebook = containingNotebooks > 0 ? (totalOccurrences / containingNotebooks) : 0;
      } else if (this.filter.type === 'flow') {
        // 统计选中的flow
        filteredData.forEach(nb => {
          let flowCount = 0;
          const cells = nb.cells ?? [];
          for (let i = 0; i < cells.length - 1; i++) {
            const from = String(cells[i]["1st-level label"] ?? 'None');
            const to = String(cells[i + 1]["1st-level label"] ?? 'None');
            if (from === this.filter.from && to === this.filter.to) {
              flowCount++;
            }
          }
          if (flowCount > 0) {
            containingNotebooks++;
            totalOccurrences += flowCount;
          }
        });
        avgPerNotebook = containingNotebooks > 0 ? (totalOccurrences / containingNotebooks) : 0;
      }

      // 按原始顺序排序filteredData
      const sortedFilteredData = [...filteredData].sort((a, b) => {
        // 找到notebook在原始数据中的索引
        const aOrigIndex = this._allData.findIndex(item =>
          item.kernelVersionId && a.kernelVersionId && item.kernelVersionId === a.kernelVersionId
        );
        const bOrigIndex = this._allData.findIndex(item =>
          item.kernelVersionId && b.kernelVersionId && item.kernelVersionId === b.kernelVersionId
        );

        // 根据notebookOrder中的位置排序
        const aOrderIndex = this.notebookOrder.indexOf(aOrigIndex);
        const bOrderIndex = this.notebookOrder.indexOf(bOrigIndex);
        return aOrderIndex - bOrderIndex;
      });

      // 渲染选中项的统计信息和筛选后的列表
      const notebookTableHtml = sortedFilteredData.map((nb, displayIndex) => {
        let occurrenceCount = 0;
        if (this.filter.type === 'stage') {
          nb.cells?.forEach((cell: any) => {
            const stage = String(cell["1st-level label"] ?? 'None');
            if (stage === this.filter.stage) {
              occurrenceCount++;
            }
          });
        } else if (this.filter.type === 'flow') {
          const cells = nb.cells ?? [];
          for (let i = 0; i < cells.length - 1; i++) {
            const from = String(cells[i]["1st-level label"] ?? 'None');
            const to = String(cells[i + 1]["1st-level label"] ?? 'None');
            if (from === this.filter.from && to === this.filter.to) {
              occurrenceCount++;
            }
          }
        }

        // 获取cluster_id
        const kernelId = nb.kernelVersionId?.toString();
        const simRow = kernelId ? this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId) : null;
        const clusterId = simRow ? simRow.cluster_id : '-';

        return `
          <tr class="filtered-notebook-item" data-notebook-index="${displayIndex}" style="cursor:pointer; transition:background-color 0.15s;">
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#888; font-size:12px; width:40px;">${nb.globalIndex}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#666; font-size:12px; width:60px;">${clusterId}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; font-weight:500; color:#333;">${nb.notebook_name ?? nb.kernelVersionId ?? `Notebook ${nb.globalIndex}`}</td>
            <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right; color:#666;">${occurrenceCount}</td>
          </tr>`;
      }).join('');

      this.node.innerHTML = `
        <div style="padding:20px 18px 18px 18px; font-size:14px; line-height:1.7; color:#222;">
          <div style="font-size:18px; font-weight:600; margin-bottom:14px;" id="detail-sidebar-title"><span style="${this._getTitleStyle()}">${this._currentTitle}</span></div>
          <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
            <tr><td style="font-weight:500;">Total Occurrences</td><td style="text-align:right;"><b>${totalOccurrences}</b></td></tr>
            <tr><td style="font-weight:500;">Containing Notebooks</td><td style="text-align:right;"><b>${containingNotebooks}</b></td></tr>
            <tr><td style="font-weight:500;">Avg per Notebook</td><td style="text-align:right;"><b>${avgPerNotebook.toFixed(1)}</b></td></tr>
          </table>
          <div style="margin-top:16px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <div style="font-weight:600; color:#333;">Filtered Notebooks (${filteredData.length})</div>
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="font-size:12px; color:#666;">Sort by:</span>
                <button id="sort-occurrences-btn" style="background:none; border:none; cursor:pointer; padding:4px; border-radius:4px; transition:background-color 0.15s;" title="Original order (click for occurrences desc)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 12h18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
            <div style="max-height:300px; overflow-y:auto;">
              <table style="width:100%; border-collapse:collapse; font-size:13px;">
                <thead>
                  <tr style="background:#f5f5f5;">
                    <th style="padding:8px 12px; text-align:center; font-weight:600; color:#333; border-bottom:2px solid #ddd; width:40px;">#</th>
                    <th style="padding:8px 12px; text-align:center; font-weight:600; color:#333; border-bottom:2px solid #ddd; width:60px;">Cluster</th>
                    <th style="padding:8px 12px; text-align:left; font-weight:600; color:#333; border-bottom:2px solid #ddd;">Notebook</th>
                    <th style="padding:8px 12px; text-align:right; font-weight:600; color:#333; border-bottom:2px solid #ddd;">Occurrences</th>
                  </tr>
                </thead>
                <tbody id="filtered-notebooks-tbody">
                  ${notebookTableHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>`;

      // 绑定点击事件和悬停效果
      setTimeout(() => {
        const notebookItems = this.node.querySelectorAll('.filtered-notebook-item');
        notebookItems.forEach((item, index) => {
          item.addEventListener('click', () => {
            const notebook = sortedFilteredData[index];
            if (notebook) {
              this.setNotebookDetail(notebook);
            }
          });

          // 添加悬停效果
          item.addEventListener('mouseenter', () => {
            (item as HTMLElement).style.backgroundColor = '#f0f8ff';
          });
          item.addEventListener('mouseleave', () => {
            (item as HTMLElement).style.backgroundColor = '';
          });
        });

        // 绑定排序按钮事件
        const sortBtn = this.node.querySelector('#sort-occurrences-btn');
        if (sortBtn) {
          let sortMode = 'original'; // 'original', 'desc', 'asc'

          sortBtn.addEventListener('click', () => {
            // 切换排序模式：original -> desc -> asc -> original
            if (sortMode === 'original') {
              sortMode = 'desc';
            } else if (sortMode === 'desc') {
              sortMode = 'asc';
            } else {
              sortMode = 'original';
            }

            // 更新图标和提示文本
            const svg = sortBtn.querySelector('svg');
            if (svg) {
              if (sortMode === 'original') {
                // 原始顺序：使用横线图标
                svg.innerHTML = '<path d="M3 12h18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
                (sortBtn as HTMLButtonElement).title = 'Original order (click for occurrences desc)';
              } else if (sortMode === 'desc') {
                // 降序：向下箭头
                svg.innerHTML = '<path d="M7 10l5 5 5-5" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
                (sortBtn as HTMLButtonElement).title = 'Occurrences descending (click for ascending)';
              } else {
                // 升序：向上箭头
                svg.innerHTML = '<path d="M7 14l5-5 5 5" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
                (sortBtn as HTMLButtonElement).title = 'Occurrences ascending (click for original order)';
              }
            }

            // 重新排序数据
            let sortedData;
            if (sortMode === 'original') {
              // 按原始顺序排序
              sortedData = [...filteredData].sort((a, b) => {
                const aIndex = this.notebookOrder.indexOf(a.globalIndex - 1);
                const bIndex = this.notebookOrder.indexOf(b.globalIndex - 1);
                return aIndex - bIndex;
              });
            } else {
              // 按occurrences排序
              sortedData = [...filteredData].sort((a, b) => {
                let aCount = 0, bCount = 0;

                if (this.filter.type === 'stage') {
                  a.cells?.forEach((cell: any) => {
                    const stage = String(cell["1st-level label"] ?? 'None');
                    if (stage === this.filter.stage) aCount++;
                  });
                  b.cells?.forEach((cell: any) => {
                    const stage = String(cell["1st-level label"] ?? 'None');
                    if (stage === this.filter.stage) bCount++;
                  });
                } else if (this.filter.type === 'flow') {
                  const aCells = a.cells ?? [];
                  const bCells = b.cells ?? [];
                  for (let i = 0; i < aCells.length - 1; i++) {
                    const from = String(aCells[i]["1st-level label"] ?? 'None');
                    const to = String(aCells[i + 1]["1st-level label"] ?? 'None');
                    if (from === this.filter.from && to === this.filter.to) aCount++;
                  }
                  for (let i = 0; i < bCells.length - 1; i++) {
                    const from = String(bCells[i]["1st-level label"] ?? 'None');
                    const to = String(bCells[i + 1]["1st-level label"] ?? 'None');
                    if (from === this.filter.from && to === this.filter.to) bCount++;
                  }
                }

                return sortMode === 'desc' ? bCount - aCount : aCount - bCount;
              });
            }

            // 重新生成表格HTML
            const newTableHtml = sortedData.map((nb, displayIndex) => {
              let occurrenceCount = 0;
              if (this.filter.type === 'stage') {
                nb.cells?.forEach((cell: any) => {
                  const stage = String(cell["1st-level label"] ?? 'None');
                  if (stage === this.filter.stage) {
                    occurrenceCount++;
                  }
                });
              } else if (this.filter.type === 'flow') {
                const cells = nb.cells ?? [];
                for (let i = 0; i < cells.length - 1; i++) {
                  const from = String(cells[i]["1st-level label"] ?? 'None');
                  const to = String(cells[i + 1]["1st-level label"] ?? 'None');
                  if (from === this.filter.from && to === this.filter.to) {
                    occurrenceCount++;
                  }
                }
              }

              // 获取cluster_id
              const kernelId = nb.kernelVersionId?.toString();
              const simRow = kernelId ? this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId) : null;
              const clusterId = simRow ? simRow.cluster_id : '-';

              return `
                <tr class="filtered-notebook-item" data-notebook-index="${displayIndex}" style="cursor:pointer; transition:background-color 0.15s;">
                  <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#888; font-size:12px; width:40px;">${nb.globalIndex}</td>
                  <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#666; font-size:12px; width:60px;">${clusterId}</td>
                  <td style="padding:8px 12px; border-bottom:1px solid #eee; font-weight:500; color:#333;">${nb.notebook_name ?? nb.kernelVersionId ?? `Notebook ${nb.globalIndex}`}</td>
                  <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right; color:#666;">${occurrenceCount}</td>
                </tr>`;
            }).join('');

            // 更新表格内容
            const tbody = this.node.querySelector('#filtered-notebooks-tbody');
            if (tbody) {
              tbody.innerHTML = newTableHtml;

              // 重新绑定点击事件
              const newNotebookItems = tbody.querySelectorAll('.filtered-notebook-item');
              newNotebookItems.forEach((item, index) => {
                item.addEventListener('click', () => {
                  const notebook = sortedData[index];
                  if (notebook) {
                    this.setNotebookDetail(notebook);
                  }
                });

                // 重新绑定悬停效果
                item.addEventListener('mouseenter', () => {
                  (item as HTMLElement).style.backgroundColor = '#f0f8ff';
                });
                item.addEventListener('mouseleave', () => {
                  (item as HTMLElement).style.backgroundColor = '';
                });
              });
            }
          });
        }
      }, 0);

      return;
    }

    // 没有filter时：显示原来的统计信息
    // 统计真实cell数并保留全局globalIndex
    const cellCountsWithIndex = data.map(nb => {
      const orig = this._allData.find(item =>
        item.kernelVersionId && nb.kernelVersionId && item.kernelVersionId === nb.kernelVersionId
      );
      return {
        count: (nb.cells ?? []).length,
        globalIndex: orig ? orig.globalIndex : 0,
        nb: orig || nb
      };
    });
    const totalCellCount = cellCountsWithIndex.reduce((a, b) => a + b.count, 0);
    const avgCellCount = notebookCount ? (totalCellCount / notebookCount) : 0;
    // stage/flow 统计只用可见 cell，排除被隐藏的stage
    const stageFreq: Record<string, number> = {};
    const stageFlowFreq: Record<string, number> = {};
    filteredData.forEach(nb => {
      let prevStage: string | null = null;
      nb.cells?.forEach((cell: any) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        // 排除被隐藏的stage
        if (stage !== 'None' && !hiddenStages.has(stage)) {
          stageFreq[stage] = (stageFreq[stage] || 0) + 1;
        }
        if (
          prevStage !== null &&
          prevStage !== undefined &&
          prevStage !== 'None' &&
          stage !== 'None' &&
          prevStage !== stage &&
          !hiddenStages.has(prevStage) &&
          !hiddenStages.has(stage)
        ) {
          const flow = prevStage + '→' + stage;
          stageFlowFreq[flow] = (stageFlowFreq[flow] || 0) + 1;
        }
        prevStage = stage;
      });
    });
    // Most Common Stage(s)
    const maxStageFreq = Object.keys(stageFreq).length > 0 ? Math.max(...Object.values(stageFreq)) : 0;
    const mostFreqStages = Object.entries(stageFreq)
      .filter(([_, freq]) => freq === maxStageFreq)
      .map(([stage, _]) => stage);
    // Most Common Transition(s)
    const maxFlowFreq = Object.keys(stageFlowFreq).length > 0 ? Math.max(...Object.values(stageFlowFreq)) : 0;
    const mostFreqFlows = Object.entries(stageFlowFreq)
      .filter(([_, freq]) => freq === maxFlowFreq)
      .map(([flow, _]) => flow);
    const stageCountText = maxStageFreq > 0 ? `${maxStageFreq} count(s)` : 'None';
    const flowCountText = maxFlowFreq > 0 ? `${maxFlowFreq} count(s)` : 'None';
    let showAllStages = false;
    let showAllFlows = false;
    // 渲染函数
    const renderStageLinks = () => {
      const arr = showAllStages ? mostFreqStages : mostFreqStages.slice(0, 3);
      return arr.map(stage =>
        `<a href=\"#\" class=\"dsb-stage-link\" data-stage=\"${stage}\" style=\"color:${this.colorMap.get(stage) || '#0066cc'} !important; text-decoration:underline; cursor:pointer; font-weight:600; font-size:14px; margin-right:8px;\">${LABEL_MAP[stage] ?? stage}</a>`
      ).join('') + (mostFreqStages.length > 3 ? `<button type='button' class='dsb-stage-expand-btn' style='background:none; border:none; color:#1976d2; font-size:13px; font-weight:500; margin-left:6px; cursor:pointer; padding:0; text-decoration:underline; transition:color 0.15s;'>${showAllStages ? 'Show less' : 'Show more'}</button>` : '');
    };
    const renderFlowLinks = () => {
      if (mostFreqFlows.length === 0) {
        return `<span style='color:#aaa; font-size:13px;'>无</span>`;
      }
      const arr = showAllFlows ? mostFreqFlows : mostFreqFlows.slice(0, 3);
      return arr.map(flow => {
        const [from, to] = flow.split(/->|→/);
        const fromColor = this.colorMap.get(from) || '#1976d2';
        const toColor = this.colorMap.get(to) || '#42a5f5';
        return `<div style=\"margin-bottom:4px;\"><a href=\"#\" class=\"dsb-flow-link\" data-flow=\"${flow}\" style=\"cursor:pointer; font-weight:600; font-size:14px; text-decoration:none; border-bottom:2px solid; border-image:linear-gradient(90deg, ${fromColor}, ${toColor}) 1;\"><span style=\"background: linear-gradient(90deg, ${fromColor}, ${toColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent;\">${LABEL_MAP[from] ?? from} → ${LABEL_MAP[to] ?? to}</span></a></div>`;
      }).join('') + (mostFreqFlows.length > 3 ? `<button type='button' class='dsb-flow-expand-btn' style='background:none; border:none; color:#1976d2; font-size:13px; font-weight:500; margin-left:6px; cursor:pointer; padding:0; text-decoration:underline; transition:color 0.15s;'>${showAllFlows ? 'Show less' : 'Show more'}</button>` : '');
    };

    // 统计每个 notebook 的 unique stage 数
    const uniqueStageCounts = filteredData.map(nb => {
      // 只统计非None的stage
      const stages = new Set((nb.cells ?? []).map((cell: any) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        return stage !== 'None' ? stage : undefined;
      }).filter((stage) => stage !== undefined));
      return stages.size;
    });
    // 统计 unique stage 数的分布
    const uniqueStageDist: Record<number, number> = {};
    uniqueStageCounts.forEach(count => {
      uniqueStageDist[count] = (uniqueStageDist[count] || 0) + 1;
    });
    const uniqueStageDistArr = Object.entries(uniqueStageDist)
      .map(([count, n]) => [parseInt(count), n])
      .sort((a, b) => a[0] - b[0]);
    const maxDistCount = Math.max(...uniqueStageDistArr.map(([_, n]) => n), 1);
    const barW3 = 24, barH3 = 40, gap3 = 6;
    const svgW3 = uniqueStageDistArr.length * (barW3 + gap3);
    const svgH3 = barH3 + 32;
    // 自适应宽度
    const viewBoxW = Math.max(svgW3 + 20, 200);
    const uniqueStageDistChart = `<svg width="100%" height="${svgH3}" viewBox="0 0 ${viewBoxW} ${svgH3}" style="overflow:visible;">
      <g transform="translate(18,0)">
        ${uniqueStageDistArr.map(([count, n], i) => `
          <rect x="${i * (barW3 + gap3)}" y="${barH3 - (n / maxDistCount) * barH3}" width="${barW3}" height="${(n / maxDistCount) * barH3}" fill="#3182bd" rx="3" ry="3"
            onmousemove="(function(evt){var t=document.getElementById('galaxy-tooltip');if(!t){t=document.createElement('div');t.id='galaxy-tooltip';t.style.position='fixed';t.style.display='none';t.style.pointerEvents='none';t.style.background='rgba(0,0,0,0.75)';t.style.color='#fff';t.style.padding='6px 10px';t.style.borderRadius='4px';t.style.fontSize='12px';t.style.zIndex='9999';document.body.appendChild(t);}t.innerHTML='${count} unique stages: ${n} notebooks';t.style.display='block';t.style.left=evt.clientX+12+'px';t.style.top=evt.clientY+12+'px';}) (event)"
            onmouseleave="(function(){var t=document.getElementById('galaxy-tooltip');if(t)t.style.display='none';})()"
          >
          </rect>
          <text x="${i * (barW3 + gap3) + barW3 / 2}" y="${barH3 + 14}" font-size="11" text-anchor="middle" fill="#888">${count}</text>
          <text x="${i * (barW3 + gap3) + barW3 / 2}" y="${barH3 - (n / maxDistCount) * barH3 - 4}" font-size="11" text-anchor="middle" fill="#222">${n}</text>
        `).join('')}
        <text x="-6" y="${barH3 + 4}" font-size="10" text-anchor="end" fill="#888">0</text>
        <text x="-6" y="10" font-size="10" text-anchor="end" fill="#888">${maxDistCount}</text>
      </g>
    </svg>`;

    // stage 频率柱状图
    const stageFreqArr = Object.entries(stageFreq).sort((a, b) => b[1] - a[1]);
    const maxStageCount = Math.max(...stageFreqArr.map(([_, c]) => c), 1);
    const barW2 = 24, barH2 = 60, gap2 = 6;
    const svgW2 = stageFreqArr.length * (barW2 + gap2);
    const svgH2 = barH2 + 32;
    // Stage Occurrence 柱状图自适应宽度+tooltip
    const stageBarViewBoxW = Math.max(svgW2 + 20, 200);
    const stageBarChart = `<svg width="100%" height="${svgH2}" viewBox="0 0 ${stageBarViewBoxW} ${svgH2}" style="overflow:visible;">
      <g transform="translate(18,0)">
        ${stageFreqArr.map(([stage, count], i) => `
          <rect x="${i * (barW2 + gap2)}" y="${barH2 - (count / maxStageCount) * barH2}" width="${barW2}" height="${(count / maxStageCount) * barH2}" fill="${this.colorMap.get(stage) || '#3182bd'}" rx="3" ry="3"
            onmousemove="(function(evt){var t=document.getElementById('galaxy-tooltip');if(!t){t=document.createElement('div');t.id='galaxy-tooltip';t.style.position='fixed';t.style.display='none';t.style.pointerEvents='none';t.style.background='rgba(0,0,0,0.75)';t.style.color='#fff';t.style.padding='6px 10px';t.style.borderRadius='4px';t.style.fontSize='12px';t.style.zIndex='9999';document.body.appendChild(t);}t.innerHTML='${LABEL_MAP[stage] ?? stage}: ${count}';t.style.display='block';t.style.left=evt.clientX+12+'px';t.style.top=evt.clientY+12+'px';}) (event)"
            onmouseleave="(function(){var t=document.getElementById('galaxy-tooltip');if(t)t.style.display='none';})()"
          >
          </rect>
          <text x="${i * (barW2 + gap2) + barW2 / 2}" y="${barH2 - (count / maxStageCount) * barH2 - 4}" font-size="11" text-anchor="middle" fill="#222">${count}</text>
        `).join('')}
        <text x="-6" y="${barH2 + 4}" font-size="10" text-anchor="end" fill="#888">0</text>
        <text x="-6" y="10" font-size="10" text-anchor="end" fill="#888">${maxStageCount}</text>
      </g>
    </svg>`;

    // Notebook kernelVersionId 列表
    let notebookListHtml = '';

    if (!this.filter && notebookOrder) {
      // 只有在没有筛选时才允许排序
      // 根据notebookOrder重新排序filteredData
      const sortedFilteredData = [...filteredData].sort((a, b) => {
        // 找到notebook在原始数据中的索引
        const aOrigIndex = this._allData.findIndex(item =>
          item.kernelVersionId && a.kernelVersionId && item.kernelVersionId === a.kernelVersionId
        );
        const bOrigIndex = this._allData.findIndex(item =>
          item.kernelVersionId && b.kernelVersionId && item.kernelVersionId === b.kernelVersionId
        );

        // 根据notebookOrder中的位置排序
        const aOrderIndex = this.notebookOrder.indexOf(aOrigIndex);
        const bOrderIndex = this.notebookOrder.indexOf(bOrigIndex);
        return aOrderIndex - bOrderIndex;
      });

      notebookListHtml = sortedFilteredData.map((nb, displayIndex) => {
        // 获取cluster_id
        const kernelId = nb.kernelVersionId?.toString();
        const simRow = kernelId ? this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId) : null;
        const clusterId = simRow ? simRow.cluster_id : '-';

        return `<tr class="overview-notebook-item" data-notebook-index="${nb.globalIndex}" style="cursor:pointer; transition:background-color 0.15s;">
          <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#888; font-size:12px; width:40px;">${nb.globalIndex}</td>
          <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#666; font-size:12px; width:60px;">${clusterId}</td>
          <td style="padding:8px 12px; border-bottom:1px solid #eee; font-weight:500; color:#333;">${nb.notebook_name ?? nb.kernelVersionId}</td>
        </tr>`;
      }).join('');
    } else {
      // 有筛选时保持filteredData顺序
      notebookListHtml = filteredData.map((nb, displayIndex) => {
        // 获取cluster_id
        const kernelId = nb.kernelVersionId?.toString();
        const simRow = kernelId ? this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId) : null;
        const clusterId = simRow ? simRow.cluster_id : '-';

        return `<tr class="overview-notebook-item" data-notebook-index="${nb.globalIndex}" style="cursor:pointer; transition:background-color 0.15s;">
          <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#888; font-size:12px; width:40px;">${nb.globalIndex}</td>
          <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center; color:#666; font-size:12px; width:60px;">${clusterId}</td>
          <td style="padding:8px 12px; border-bottom:1px solid #eee; font-weight:500; color:#333;">${nb.notebook_name ?? nb.kernelVersionId}</td>
        </tr>`;
      }).join('');
    }

    // 找到所有cell数等于最大值和最小值的notebook索引
    const maxCellCount = Math.max(...cellCountsWithIndex.map(x => x.count));
    const minCellCount = Math.min(...cellCountsWithIndex.map(x => x.count));
    const longest = cellCountsWithIndex.filter(x => x.count === maxCellCount && x.globalIndex !== -1);
    const shortest = cellCountsWithIndex.filter(x => x.count === minCellCount && x.globalIndex !== -1);
    const longestLinks = longest
      .filter(x => x.globalIndex > 0)
      .map(x =>
        `<a href=\"#\" class=\"dsb-nb-longest-link\" data-idx=\"${x.globalIndex}\" data-global-idx=\"${x.globalIndex}\" style=\"color:#0066cc !important; text-decoration:underline; cursor:pointer; font-weight:600; font-size:14px;\">#${x.globalIndex}</a>`
      ).join(', ');
    const shortestLinks = shortest
      .filter(x => x.globalIndex > 0)
      .map(x =>
        `<a href=\"#\" class=\"dsb-nb-shortest-link\" data-idx=\"${x.globalIndex}\" data-global-idx=\"${x.globalIndex}\" style=\"color:#0066cc !important; text-decoration:underline; cursor:pointer; font-weight:600; font-size:14px;\">#${x.globalIndex}</a>`
      ).join(', ');
    // 渲染
    this.node.innerHTML = `
      <div style="padding:20px 18px 18px 18px; font-size:14px; line-height:1.7; color:#222;">
        <div style="font-size:18px; font-weight:600; margin-bottom:14px;" id="detail-sidebar-title"><span style="${this._getTitleStyle()}">${this._currentTitle}</span></div>
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="font-weight:500;">Total Notebooks</td><td style="text-align:right;"><b>${notebookCount}</b></td></tr>
          <tr><td style="font-weight:500;">Total Cells</td><td style="text-align:right;"><b>${totalCellCount}</b></td></tr>
          <tr><td style="font-weight:500;">Average Cells per Notebook</td><td style="text-align:right;"><b>${avgCellCount.toFixed(2)}</b></td></tr>
          <tr><td style="font-weight:500;">Notebook(s) with Most Cells</td><td style="text-align:right;"><b>${maxCellCount} cell(s)</b></td></tr>
        </table>
        <div style='margin: 0 0 8px 0; font-size:13px; color:#1976d2;'><span> ${longestLinks}</span></div>
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="font-weight:500;">Notebook(s) with Fewest Cells</td><td style="text-align:right;"><b>${minCellCount} cell(s)</b></td></tr>
        </table>
        <div style='margin: 0 0 8px 0; font-size:13px; color:#1976d2;'><span> ${shortestLinks}</span></div>
        <div style="font-weight:500; margin-bottom:10px;">Number of Unique Stages Distribution</div>
        <div style="margin: 8px 0 12px 0; width:100%; max-width:600px; margin-left:auto; margin-right:auto;">${uniqueStageDistChart}</div>
        <hr style="margin:16px 0 10px 0; border:none; border-top:1px solid #eee;">
        <div style="font-size:16px; font-weight:600; margin-bottom:10px;">Stage Analysis</div>
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#555;"><span style="font-weight:500;">Most Common Stage(s)</span><span style="color:#1976d2; font-size:14px; font-weight:600;">${stageCountText}</span></div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;" id="dsb-stage-links">${renderStageLinks()}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:#555;"><span style="font-weight:500;">Most Common Transition(s)</span><span style="color:#1976d2; font-size:14px; font-weight:600;">${flowCountText}</span></div>
          <div style="display:flex; flex-direction:column; gap:4px;" id="dsb-flow-links">${renderFlowLinks()}</div>
        </div>
        <div style="margin:18px 0 8px 0; font-weight:600; font-size:15px;">Stage Frequency Distribution</div>
        <div style="height:16px;"></div>
        <div style="margin: 8px 0 12px 0; width:100%; max-width:600px; margin-left:auto; margin-right:auto;">${stageBarChart}</div>
        <hr style="margin:16px 0 10px 0; border:none; border-top:1px solid #eee;">
        <div style="font-size:16px; font-weight:600; margin:24px 0 10px 0;">Notebook List</div>
        <div style="max-height:300px; overflow-y:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="padding:8px 12px; text-align:center; font-weight:600; color:#333; border-bottom:2px solid #ddd; width:40px;">#</th>
                <th style="padding:8px 12px; text-align:center; font-weight:600; color:#333; border-bottom:2px solid #ddd; width:60px;">Cluster</th>
                <th style="padding:8px 12px; text-align:left; font-weight:600; color:#333; border-bottom:2px solid #ddd;">Notebook</th>
              </tr>
            </thead>
            <tbody>
              ${notebookListHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
    // 绑定 notebook 行点击事件和悬停效果
    setTimeout(() => {
      const notebookItems = this.node.querySelectorAll('.overview-notebook-item');
      notebookItems.forEach((item) => {
        const globalIdx = parseInt((item as HTMLElement).getAttribute('data-notebook-index') || '0', 10);

        item.addEventListener('click', () => {
          if (this._allData && this._allData[globalIdx - 1]) { // globalIndex从1开始，所以需要减1
            window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', {
              detail: { notebook: { ...this._allData[globalIdx - 1], index: globalIdx - 1 } }
            }));
            this.setNotebookDetail(this._allData[globalIdx - 1], true); // 跳过事件派发，避免循环
          }
        });

        // 添加悬停效果
        item.addEventListener('mouseenter', () => {
          (item as HTMLElement).style.backgroundColor = '#f0f8ff';
        });
        item.addEventListener('mouseleave', () => {
          (item as HTMLElement).style.backgroundColor = '';
        });
      });

      // 添加表格行的悬停效果
      const overviewItems = this.node.querySelectorAll('.overview-notebook-item');
      overviewItems.forEach(item => {
        item.addEventListener('mouseenter', () => {
          (item as HTMLElement).style.backgroundColor = '#f0f8ff';
        });
        item.addEventListener('mouseleave', () => {
          (item as HTMLElement).style.backgroundColor = '';
        });
      });

      // 绑定最长和最短notebook跳转事件
      const longestLinks = this.node.querySelectorAll('.dsb-nb-longest-link');
      const shortestLinks = this.node.querySelectorAll('.dsb-nb-shortest-link');

      longestLinks.forEach(link => {
        link.addEventListener('mouseenter', () => {
          (link as HTMLElement).style.background = '#e3eaf3';
          (link as HTMLElement).style.color = '#1565c0';
        });
        link.addEventListener('mouseleave', () => {
          (link as HTMLElement).style.background = '';
          (link as HTMLElement).style.color = '#0066cc';
        });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const globalIdx = parseInt((link as HTMLElement).getAttribute('data-global-idx') || '0', 10);
          if (this._allData && this._allData[globalIdx]) {
            window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', {
              detail: { notebook: { ...this._allData[globalIdx], index: globalIdx } }
            }));
            this.setNotebookDetail(this._allData[globalIdx], true); // 跳过事件派发，避免循环
          }
        });
      });

      shortestLinks.forEach(link => {
        link.addEventListener('mouseenter', () => {
          (link as HTMLElement).style.background = '#e3eaf3';
          (link as HTMLElement).style.color = '#1565c0';
        });
        link.addEventListener('mouseleave', () => {
          (link as HTMLElement).style.background = '';
          (link as HTMLElement).style.color = '#0066cc';
        });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const globalIdx = parseInt((link as HTMLElement).getAttribute('data-global-idx') || '0', 10);
          if (this._allData && this._allData[globalIdx]) {
            window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', {
              detail: { notebook: { ...this._allData[globalIdx], index: globalIdx } }
            }));
            this.setNotebookDetail(this._allData[globalIdx], true); // 跳过事件派发，避免循环
          }
        });
      });

      // 绑定stage和flow链接事件
      const stageLinks = this.node.querySelectorAll('.dsb-stage-link');
      const flowLinks = this.node.querySelectorAll('.dsb-flow-link');

      stageLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const stage = (link as HTMLElement).getAttribute('data-stage');
          if (stage) {
            // 触发stage选中效果，与选中block相同
            this.setFilter({ type: 'stage', stage });
          }
        });
      });

      flowLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const flow = (link as HTMLElement).getAttribute('data-flow');
          if (flow) {
            // 解析flow字符串，格式为 "from→to" 或 "from->to"
            const [from, to] = flow.split(/→|->/);
            if (from && to) {
              // 触发flow选中效果，与选中flow相同
              this.setFilter({ type: 'flow', from, to });
            }
          }
        });
      });
    }, 0);
    // 在渲染后绑定 tooltip 事件
    setTimeout(() => {
      const chartDiv = this.node.querySelector('svg');
      if (!chartDiv) return;
      let tooltipDiv = document.getElementById('galaxy-tooltip');
      if (!tooltipDiv) {
        tooltipDiv = document.createElement('div');
        tooltipDiv.id = 'galaxy-tooltip';
        tooltipDiv.style.position = 'fixed';
        tooltipDiv.style.display = 'none';
        tooltipDiv.style.pointerEvents = 'none';
        tooltipDiv.style.background = 'rgba(0,0,0,0.75)';
        tooltipDiv.style.color = '#fff';
        tooltipDiv.style.padding = '6px 10px';
        tooltipDiv.style.borderRadius = '4px';
        tooltipDiv.style.fontSize = '12px';
        tooltipDiv.style.zIndex = '9999';
        document.body.appendChild(tooltipDiv);
      }
      const bars = chartDiv.querySelectorAll('rect[data-tooltip]');
      bars.forEach((bar) => {
        bar.addEventListener('mouseenter', (e) => {
          tooltipDiv!.textContent = bar.getAttribute('data-tooltip') ?? '';
          tooltipDiv!.style.display = 'block';
        });
        bar.addEventListener('mousemove', (e) => {
          tooltipDiv!.style.left = (e as MouseEvent).clientX + 12 + 'px';
          tooltipDiv!.style.top = (e as MouseEvent).clientY + 12 + 'px';
        });
        bar.addEventListener('mouseleave', () => {
          tooltipDiv!.style.display = 'none';
        });
      });
    }, 0);
    // 展开/收起事件绑定（summary）
    setTimeout(() => {
      const stageLinksDiv = this.node.querySelector('#dsb-stage-links');
      const flowLinksDiv = this.node.querySelector('#dsb-flow-links');
      if (stageLinksDiv) {
        stageLinksDiv.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('dsb-stage-expand') || target.classList.contains('dsb-stage-expand-btn')) {
            showAllStages = !showAllStages;
            stageLinksDiv.innerHTML = renderStageLinks();
          }
        });
      }
      if (flowLinksDiv) {
        flowLinksDiv.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('dsb-flow-expand') || target.classList.contains('dsb-flow-expand-btn')) {
            showAllFlows = !showAllFlows;
            flowLinksDiv.innerHTML = renderFlowLinks();
          }
        });
      }
      // 按钮hover效果
      const addHover = (selector: string) => {
        const btns = this.node.querySelectorAll(selector);
        btns.forEach(btn => {
          btn.addEventListener('mouseenter', () => {
            (btn as HTMLElement).style.textDecoration = 'underline';
            (btn as HTMLElement).style.color = '#1251a2';
          });
          btn.addEventListener('mouseleave', () => {
            (btn as HTMLElement).style.textDecoration = 'underline';
            (btn as HTMLElement).style.color = '#1976d2';
          });
        });
      };
      addHover('.dsb-stage-expand-btn');
      addHover('.dsb-flow-expand-btn');
    }, 0);


  }

  // 渲染代码行数分布柱状图
  private _renderCodeLineDistChart(cell: any, allNotebooks: any[], stageColor?: string): string {
    // 收集所有同 stage 的 code cell 的代码行数
    const stage = cell["1st-level label"];
    let codeLineCounts: number[] = [];
    allNotebooks.forEach(nb => {
      const cells = nb.cells ?? [];
      cells.forEach((c: any) => {
        if (c["1st-level label"] === stage && c.cellType === 'code') {
          const code = c.source ?? c.code ?? '';
          codeLineCounts.push(code.split(/\r?\n/).length);
        }
      });
    });
    if (codeLineCounts.length === 0) return '<div style="color:#aaa; font-size:13px;">No code cells in this stage.</div>';
    // 累计分布（CDF）
    codeLineCounts.sort((a, b) => a - b);
    const n = codeLineCounts.length;
    // 横轴分点（自适应，最多30个点）
    const maxLine = codeLineCounts[n - 1];
    let xTicks: number[] = [];
    if (maxLine <= 30) {
      for (let i = 0; i <= maxLine; ++i) xTicks.push(i);
    } else {
      const step = Math.ceil(maxLine / 30);
      for (let i = 0; i <= maxLine; i += step) xTicks.push(i);
      if (xTicks[xTicks.length - 1] !== maxLine) xTicks.push(maxLine);
    }
    // 计算每个 xTick 的累计百分比
    const cdf: { x: number, y: number }[] = xTicks.map(x => {
      const count = codeLineCounts.filter(v => v <= x).length;
      return { x, y: count / n };
    });
    // 当前 cell 的代码行数
    const currLines = (cell.source ?? cell.code ?? '').split(/\r?\n/).length;
    // SVG
    const chartW = 220, chartH = 48;
    const xMin = 0, xMax = xTicks[xTicks.length - 1];
    const yMin = 0, yMax = 1;
    // 坐标变换，顶部留8像素边距
    const yTopMargin = 8;
    const yMap = (y: number) => yTopMargin + (chartH - yTopMargin) - ((y - yMin) / (yMax - yMin)) * (chartH - yTopMargin);
    const xMap = (x: number) => ((x - xMin) / (xMax - xMin)) * chartW;
    // 折线
    let linePath = '';
    cdf.forEach((pt, i) => {
      const x = xMap(pt.x), y = yMap(pt.y);
      linePath += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
    });
    // 当前 cell 的竖线
    const currX = xMap(currLines);
    const mainColor = stageColor || '#1976d2';
    const currLineSvg = `<line x1="${currX}" y1="${yTopMargin}" x2="${currX}" y2="${chartH}" stroke="${mainColor}" stroke-width="2" />`;
    // 横纵坐标
    const axisSvg = [
      `<line x1="0" y1="${chartH}" x2="${chartW}" y2="${chartH}" stroke="#bbb" stroke-width="1" />`,
      `<text x="0" y="${chartH + 12}" font-size="11" fill="#888" text-anchor="start">0</text>`,
      `<text x="${chartW}" y="${chartH + 12}" font-size="11" fill="#888" text-anchor="end">${xMax}</text>`,
      `<line x1="0" y1="${yTopMargin}" x2="0" y2="${chartH}" stroke="#bbb" stroke-width="1" />`,
      `<text x="-2" y="${yTopMargin + 10}" font-size="11" fill="#888" text-anchor="end">100%</text>`,
      `<text x="-2" y="${chartH}" font-size="11" fill="#888" text-anchor="end">0%</text>`
    ].join('');
    // tooltip 事件
    // 鼠标悬浮在折线上最近的点显示 tooltip
    // 生成点
    const pointsSvg = cdf.map(pt => {
      const x = xMap(pt.x), y = yMap(pt.y);
      return `<circle cx="${x}" cy="${y}" r="3" fill="${mainColor}" data-tooltip="≤${pt.x} lines: ${(pt.y * 100).toFixed(1)}%" />`;
    }).join('');
    return `<svg data-cdf="1" width="100%" height="${chartH + 32}" viewBox="-18 0 ${chartW + 18} ${chartH + 32}">
      <path d="${linePath}" fill="none" stroke="${mainColor}" stroke-width="2" />
      ${pointsSvg}
      ${currLineSvg}
      ${axisSvg}
    </svg>`;
  }

  // 获取当前tab ID
  private getTabId(): string {
    // 基于当前显示的内容生成唯一标识
    // 如果是notebook detail模式，使用notebook的ID
    if (this.currentNotebook && (this.currentNotebook as any).globalIndex !== undefined) {
      return `notebook_${(this.currentNotebook as any).globalIndex}`;
    }
    // 如果是overview模式，使用overview标识
    return 'overview';
  }

  // 保存DetailSidebar筛选状态到全局变量（按tab隔离）
  private saveDetailFilterState() {
    const tabId = this.getTabId();
    const stateKey = `_galaxyDetailSidebarFilterState_${tabId}`;
    (window as any)[stateKey] = {
      filter: this.filter,
      currentNotebook: this.currentNotebook,
      currentTitle: this._currentTitle,
      currentSelection: this._currentSelection
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

  // 从全局变量恢复DetailSidebar筛选状态（按tab隔离）
  private restoreDetailFilterState() {
    // 切换tab时隐藏所有tooltip
    this.hideAllTooltips();

    const tabId = this.getTabId();
    const stateKey = `_galaxyDetailSidebarFilterState_${tabId}`;
    const savedState = (window as any)[stateKey];

    if (savedState) {
      this.filter = savedState.filter;
      this.currentNotebook = savedState.currentNotebook;
      this._currentTitle = savedState.currentTitle;
      this._currentSelection = savedState.currentSelection;

      // 恢复状态后重新渲染
      if (this.currentNotebook) {
        // 确保notebook detail视图下没有选中状态
        this._currentSelection = null;
        this.setNotebookDetail(this.currentNotebook, true); // 跳过事件派发，避免循环
      } else if (this.filter) {
        this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
      } else {
        this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
      }
    }
  }
} 