import { Widget } from '@lumino/widgets';
import { LABEL_MAP } from './labelMap';
import { STAGE_GROUP_MAP } from './stage_hierarchy';

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
  private voteData: any[] = []; // 存储投票数据
  private currentNotebook: any = null; // 保存当前 notebook detail
  private _currentTitle: string = 'Notebook Overview'; // 跟踪当前标题
  private _currentSelection: any = null; // 跟踪当前选中状态
  private competitionInfo: { id: string; name: string; url: string } | null = null; // 添加competition信息

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

  constructor(colorMap: Map<string, string>, notebookOrder: number[], hiddenStages?: Set<string>, similarityGroups?: any[], voteData?: any[], competitionInfo?: { id: string; name: string; url: string }) {
    super();
    this.colorMap = colorMap;
    this.notebookOrder = notebookOrder || []; // 保存notebook的原始排序
    this.similarityGroups = similarityGroups || []; // 保存similarity groups数据
    this.voteData = voteData || []; // 保存投票数据
    this.competitionInfo = competitionInfo || null; // 保存competition信息
    this.id = 'galaxy-detail-sidebar';
    this.title.label = 'Details';
    this.title.closable = true;
    this.addClass('galaxy-detail-sidebar');
    this.setDefault();
    this.node.style.overflowY = 'hidden'; // 禁用整体滚动
    this.node.style.minWidth = '340px'; // 设置最小宽度
    this.node.style.height = '100vh'; // 设置为屏幕高度
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
    // 监听 notebook order 变化事件 - 更新notebookOrder并重新渲染
    window.addEventListener('galaxy-notebook-order-changed', (e: any) => {
      this.notebookOrder = e.detail?.notebookOrder ?? [];
      // 如果有filter，重新渲染以更新notebook list顺序
      if (this.filter) {
        this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
      }
    });
  }

  onAfterAttach() {
    // 恢复之前的筛选状态
    this.restoreDetailFilterState();
    window.addEventListener('galaxy-cell-detail', this._cellDetailHandler);
    window.addEventListener('galaxy-notebook-highlight', this._notebookHighlightHandler);
  }
  onBeforeDetach() {
    window.removeEventListener('galaxy-cell-detail', this._cellDetailHandler);
    window.removeEventListener('galaxy-notebook-highlight', this._notebookHighlightHandler);
  }
  private _cellDetailHandler = (e: Event) => {
    const cell = (e as CustomEvent).detail.cell;
    // 如果是markdown cell，显示notebook信息而不是cell detail
    if (cell.cellType === 'markdown') {
      this.setNotebookDetail(cell._notebookDetail || cell.notebook, true);
    } else {
      this.setCellDetail(cell);
    }
  };

  private _notebookHighlightHandler = (e: Event) => {
    const { notebookIndex, highlight } = (e as CustomEvent).detail;
    this.highlightNotebookInList(notebookIndex, highlight);
  };



  setDefault() {
    this.currentNotebook = null; // 重置notebook状态
    this._currentSelection = null; // 重置选择状态
    this.node.innerHTML = `
      <div style="padding:40px 20px; text-align:center; color:#6c757d;">
        <div style="margin-bottom:16px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 12H15M9 16H15M9 8H15M5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3Z" stroke="#dee2e6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div style="font-size:16px; font-weight:500; margin-bottom:8px; color:#495057;">No Selection</div>
        <div style="font-size:14px; color:#6c757d;">Please select a notebook or cell to view details.</div>
      </div>
    `;
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
    // 渲染函数，显示为block图标和黑色文本
    const renderStageText = () => {
      // 检查是否所有stage都只出现一次
      const allStageFreqs = Object.values(stageFreq);
      const allStagesOnlyOnce = allStageFreqs.length > 0 && allStageFreqs.every(freq => freq === 1);

      if (allStagesOnlyOnce && mostFreqStagesFiltered.length > 3) {
        return `<span style="color:#6c757d; font-size:13px; font-style:italic;">All stages appear only once (${mostFreqStagesFiltered.length} unique stages)</span>`;
      }

      return mostFreqStagesFiltered.map(stage => {
        const stageColor = this.colorMap.get(stage) || '#0066cc';
        const group = STAGE_GROUP_MAP[stage];
        let borderStyle = 'none';
        let borderWidth = '0px';
        let borderColor = 'transparent';

        if (group === 'Data-oriented') {
          borderStyle = 'solid';
          borderWidth = '1.5px';
          borderColor = '#666666';
        } else if (group === 'Model-oriented') {
          borderStyle = 'dashed';
          borderWidth = '1.5px';
          borderColor = '#666666';
        }

        return `<div style="display:inline-flex; align-items:center; margin-right:8px; margin-bottom:4px;">
          <div style="width:10px; height:12px; background-color:${stageColor}; border-radius:2px; margin-right:6px; flex-shrink:0; border:${borderWidth} ${borderStyle} ${borderColor}; align-self:center;"></div>
          <span style="color:#222; font-weight:600; font-size:13px; line-height:12px; display:flex; align-items:center;">${LABEL_MAP[stage] ?? stage}</span>
        </div>`;
      }).join('');
    };
    const renderFlowText = () => {
      // 检查是否所有transition都只出现一次
      const allFlowFreqs = Object.values(transitions);
      const allFlowsOnlyOnce = allFlowFreqs.length > 0 && allFlowFreqs.every(freq => freq === 1);

      if (allFlowsOnlyOnce && mostFreqFlowsFiltered.length > 3) {
        return `<span style="color:#6c757d; font-size:13px; font-style:italic;">All transitions appear only once (${mostFreqFlowsFiltered.length} unique transitions)</span>`;
      }

      return mostFreqFlowsFiltered.map(flow => {
        const [from, to] = flow.split(/->|→/);
        const fromColor = this.colorMap.get(from) || '#1976d2';
        const toColor = this.colorMap.get(to) || '#42a5f5';

        // 获取stage的group信息用于边框样式
        const fromGroup = STAGE_GROUP_MAP[from];
        const toGroup = STAGE_GROUP_MAP[to];

        let fromBorderStyle = 'none';
        let fromBorderWidth = '0px';
        let fromBorderColor = 'transparent';
        let toBorderStyle = 'none';
        let toBorderWidth = '0px';
        let toBorderColor = 'transparent';

        if (fromGroup === 'Data-oriented') {
          fromBorderStyle = 'solid';
          fromBorderWidth = '1.5px';
          fromBorderColor = '#666666';
        } else if (fromGroup === 'Model-oriented') {
          fromBorderStyle = 'dashed';
          fromBorderWidth = '1.5px';
          fromBorderColor = '#666666';
        }

        if (toGroup === 'Data-oriented') {
          toBorderStyle = 'solid';
          toBorderWidth = '1.5px';
          toBorderColor = '#666666';
        } else if (toGroup === 'Model-oriented') {
          toBorderStyle = 'dashed';
          toBorderWidth = '1.5px';
          toBorderColor = '#666666';
        }

        return `<div style="display:inline-flex; align-items:center; margin-right:8px; margin-bottom:4px;">
          <div style="width:10px; height:12px; background-color:${fromColor}; border-radius:2px; margin-right:6px; flex-shrink:0; border:${fromBorderWidth} ${fromBorderStyle} ${fromBorderColor}; align-self:center;"></div>
          <span style="color:#222; font-weight:600; font-size:13px; line-height:12px; display:flex; align-items:center;">${LABEL_MAP[from] ?? from}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin:0 4px;">
            <path d="M5 12H19M19 12L14 7M19 12L14 17" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div style="width:10px; height:12px; background-color:${toColor}; border-radius:2px; margin-right:6px; flex-shrink:0; border:${toBorderWidth} ${toBorderStyle} ${toBorderColor}; align-self:center;"></div>
          <span style="color:#222; font-weight:600; font-size:13px; line-height:12px; display:flex; align-items:center;">${LABEL_MAP[to] ?? to}</span>
        </div>`;
      }).join('');
    };

    const stageCounts: Record<string, number> = {};
    cells.forEach((c: any) => {
      const stage = String(c["1st-level label"] ?? "None");
      // 排除被隐藏的stage
      if (stage !== 'None' && !hiddenStages.has(stage)) {
        stageCounts[stage] = (stageCounts[stage] || 0) + 1;
      }
    });

    const sortedStages = Object.entries(stageCounts).sort((a, b) => b[1] - a[1]);

    const { colorMap } = this;
    const maxBar = Math.max(...sortedStages.map(([_, n]) => n), 1);
    const barW = 24, barH = 60, gap = 6;
    const svgW = sortedStages.length * (barW + gap);
    const svgH = barH + 32;

    // 自适应缩放：如果图表宽度超过容器，则缩小bar宽度和间距
    let actualBarW = barW;
    let actualGap = gap;
    let actualSvgW = svgW;

    if (svgW > 280) { // 留20px边距
      const scale = 280 / svgW;
      actualBarW = Math.max(barW * scale, 8); // 最小8px宽度
      actualGap = Math.max(gap * scale, 2); // 最小2px间距
      actualSvgW = sortedStages.filter(([stage]) => stage !== "None" && !hiddenStages.has(stage)).length * (actualBarW + actualGap);
    }

    const barChart = `<svg width="100%" height="${svgH}" viewBox="0 0 320 ${svgH}" style="overflow:visible;">
      <g transform="translate(${(320 - actualSvgW) / 2}, ${(svgH - barH) / 2})">
        ${sortedStages
        .filter(([stage]) => stage !== "None" && !hiddenStages.has(stage))
        .map(([stage, n], i) => `
            <rect x="${i * (actualBarW + actualGap)}"
                  y="${barH - (n / maxBar) * barH}"
                  width="${actualBarW}"
                  height="${(n / maxBar) * barH}"
                  fill="${colorMap.get(stage) || '#bbb'}"
                  rx="4" ry="4"
                  style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.1));"
                  onmousemove="(function(evt){var t=document.getElementById('galaxy-tooltip');if(!t){t=document.createElement('div');t.id='galaxy-tooltip';t.style.position='fixed';t.style.display='none';t.style.pointerEvents='none';t.style.background='rgba(0,0,0,0.75)';t.style.color='#fff';t.style.padding='6px 10px';t.style.borderRadius='4px';t.style.fontSize='12px';t.style.zIndex='9999';document.body.appendChild(t);}t.innerHTML='${LABEL_MAP?.[stage] ?? stage}: ${n}';t.style.display='block';t.style.left=evt.clientX+12+'px';t.style.top=evt.clientY+12+'px';}) (event)"
                  onmouseleave="(function(){var t=document.getElementById('galaxy-tooltip');if(t)t.style.display='none';})()">
            </rect>
            <text x="${i * (actualBarW + actualGap) + actualBarW / 2}"
                  y="${barH - (n / maxBar) * barH - 6}"
                  font-size="10"
                  font-weight="600"
                  text-anchor="middle"
                  fill="#495057">${n}</text>
          `).join('')}
        <text x="-6" y="${barH + 4}" font-size="9" text-anchor="end" fill="#6c757d">0</text>
        <text x="-6" y="10" font-size="9" text-anchor="end" fill="#6c757d">${maxBar}</text>
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
          <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px;">
            Selected Stage: <span style="color:${stageColor}; font-weight:600;">${stageLabel}</span>
          </div>
          <div style="background:#fff; border-radius:6px; padding:12px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="display:flex; flex-direction:row; gap:12px;">
              <div style="flex:1;">
                <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Occurrences</div>
                <div style="font-size:13px; font-weight:600; color:#495057;">${selectedStageCount}</div>
              </div>
              <div style="flex:1;">
                <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Avg Lines</div>
                <div style="font-size:13px; font-weight:600; color:#495057;">${selectedStageAvgLines.toFixed(1)}</div>
              </div>
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
          <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px;">
            Selected Transition: <span style="background: linear-gradient(90deg, ${fromColor}, ${toColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent; font-weight:600;">${fromLabel} → ${toLabel}</span>
          </div>
          <div style="background:#fff; border-radius:6px; padding:12px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="display:flex; flex-direction:row; gap:12px;">
              <div style="flex:1;">
                <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Occurrences</div>
                <div style="font-size:13px; font-weight:600; color:#495057;">${flowCount}</div>
              </div>
              <div style="flex:1;">
                <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Avg Lines</div>
                <div style="font-size:13px; font-weight:600; color:#495057;">${avgLines.toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 插入内容
    this.node.innerHTML = `
      <div style="padding:12px 12px 8px 12px; font-size:14px; color:#222; max-width:420px; margin:0 auto; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
        <div style="font-size:16px; font-weight:700; margin-bottom:8px; line-height:1.3; word-break:break-all; padding-bottom:6px; border-bottom:1px solid #e9ecef; flex-shrink:0;" id="detail-sidebar-title">
          <span style="${this._getTitleStyle()}">Notebook ${nb.globalIndex !== undefined ? nb.globalIndex : ''}: ${nb.notebook_name ?? nb.kernelVersionId}</span>
          ${nb.url ? `
          <a href="${nb.url}" target="_blank" class="kaggle-link" style="display:inline-flex; align-items:center; text-decoration:none; margin-left:8px; vertical-align:baseline; height:23.4px; line-height:23.4px;" title="View on Kaggle">
            <svg width="24" height="24" viewBox="0 0 163 63.2" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M26.92 47c-.05.18-.24.27-.56.27h-6.17a1.24 1.24 0 0 1-1-.48L9 33.78l-2.83 2.71v10.06a.61.61 0 0 1-.69.69H.69a.61.61 0 0 1-.69-.69V.69A.61.61 0 0 1 .69 0h4.79a.61.61 0 0 1 .69.69v28.24l12.21-12.35a1.44 1.44 0 0 1 1-.49h6.39a.54.54 0 0 1 .55.35.59.59 0 0 1-.07.63L13.32 29.55l13.46 16.72a.65.65 0 0 1 .14.73ZM51.93 47.24h-4.79c-.51 0-.76-.23-.76-.69v-1a12.77 12.77 0 0 1-7.84 2.29A11.28 11.28 0 0 1 31 45.16a9 9 0 0 1-3.12-7.07q0-6.81 8.46-9.23a61.55 61.55 0 0 1 10.06-1.67A5.47 5.47 0 0 0 40.48 21a14 14 0 0 0-7.91 2.77c-.41.24-.71.19-.9-.13l-2.5-3.54c-.23-.28-.16-.6.21-1a19.32 19.32 0 0 1 11.1-3.68A13.29 13.29 0 0 1 48 17.55q4.59 3.06 4.58 9.78v19.22a.61.61 0 0 1-.65.69Zm-5.55-14.5q-6.8.7-9.3 1.81Q33.69 36 34 38.71a3.49 3.49 0 0 0 1.53 2.46 5.87 5.87 0 0 0 3 1.08 9.49 9.49 0 0 0 7.77-2.57ZM81 59.28q-3.81 3.92-10.74 3.92a15.41 15.41 0 0 1-7.63-2c-.51-.33-1.11-.76-1.81-1.29s-1.5-1.19-2.43-2a.72.72 0 0 1-.07-1l3.26-3.26a.76.76 0 0 1 .56-.21.68.68 0 0 1 .49.21c2.58 2.58 5.11 3.88 7.56 3.88q8.39 0 8.39-8.74v-3.63a13.1 13.1 0 0 1-8.67 2.71 12.48 12.48 0 0 1-10.55-5.07A18.16 18.16 0 0 1 56 31.63a18 18 0 0 1 3.2-10.82 12.19 12.19 0 0 1 10.61-5.34 13.93 13.93 0 0 1 8.74 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .7.7v31q.03 7.57-3.73 11.49ZM78.58 26q-1.74-4.44-8-4.44-8.11 0-8.11 10.12 0 5.63 2.7 8.19a7.05 7.05 0 0 0 5.21 2q6.51 0 8.25-4.44ZM113.59 59.28q-3.78 3.91-10.72 3.92a15.44 15.44 0 0 1-7.63-2q-.76-.49-1.8-1.29c-.7-.53-1.51-1.19-2.43-2a.7.7 0 0 1-.07-1l3.26-3.26a.74.74 0 0 1 .55-.21.67.67 0 0 1 .49.21c2.59 2.58 5.11 3.88 7.56 3.88q8.4 0 8.4-8.74v-3.63a13.14 13.14 0 0 1-8.68 2.71A12.46 12.46 0 0 1 92 42.8a18.09 18.09 0 0 1-3.33-11.17 18 18 0 0 1 3.19-10.82 12.21 12.21 0 0 1 10.61-5.34 14 14 0 0 1 8.75 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .69.7v31q-.02 7.57-3.8 11.49ZM111.2 26q-1.74-4.44-8-4.44-8.2-.05-8.2 10.07 0 5.63 2.71 8.19a7 7 0 0 0 5.2 2q6.53 0 8.26-4.44ZM128 47.24h-4.78a.62.62 0 0 1-.7-.69V.69a.62.62 0 0 1 .7-.69H128a.61.61 0 0 1 .7.69v45.86a.61.61 0 0 1-.7.69ZM162.91 33.16a.62.62 0 0 1-.7.69h-22.54a8.87 8.87 0 0 0 2.91 5.69 10.63 10.63 0 0 0 7.15 2.46 11.64 11.64 0 0 0 6.86-2.15c.42-.28.77-.28 1 0l3.26 3.33c.37.37.37.69 0 1a18.76 18.76 0 0 1-11.58 3.75 16 16 0 0 1-11.8-4.72 16.2 16.2 0 0 1-4.57-11.86 16 16 0 0 1 4.51-11.52 14.36 14.36 0 0 1 10.82-4.3A14.07 14.07 0 0 1 158.88 20 15 15 0 0 1 163 31.63ZM153.82 23a8.18 8.18 0 0 0-5.69-2.15 8.06 8.06 0 0 0-5.48 2.08 9.24 9.24 0 0 0-3 5.41h16.71a7 7 0 0 0-2.54-5.34Z" fill="#20beff"/>
            </svg>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left:2px;">
              <path d="M7 17L17 7M17 7H7M17 7V17" stroke="#20beff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
          ` : ''}
        </div>
        
        ${nb.displayname ? `
        <div style="margin-bottom:8px; flex-shrink:0;">
          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
            <span style="font-size:12px; color:#6c757d; font-weight:500;">by</span>
            <span style="font-size:13px; color:#495057; font-weight:600;">${nb.displayname}</span>
          </div>
        </div>
        ` : ''}
        
        ${nb.creationDate || nb.totalLines || this.getVoteCount(nb) ? `
        <div style="background:#f8f9fa; border-radius:6px; padding:10px; margin-bottom:8px; border:1px solid #e9ecef; flex-shrink:0;">
          <div style="display:flex; flex-direction:row; gap:12px;">
            ${nb.creationDate ? `
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Creation Date</div>
              <div style="font-size:13px; font-weight:600; color:#495057;">${nb.creationDate.split(' ')[0]}</div>
            </div>
            ` : ''}
            ${nb.totalLines ? `
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Total Lines</div>
              <div style="font-size:13px; font-weight:600; color:#495057;">${nb.totalLines.toLocaleString()}</div>
            </div>
            ` : ''}
            ${this.getVoteCount(nb) !== null ? `
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Total Votes</div>
              <div style="font-size:13px; font-weight:600; color:#495057;">${this.getVoteCount(nb)!.toLocaleString()}</div>
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
        
        <div style="margin-bottom:12px; flex-shrink:0;">
          <div style="font-size:14px; font-weight:600; margin-bottom:6px; color:#222; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 11H15M9 15H15M9 7H15M5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3Z" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Workflow Analysis
          </div>
          <div style="background:#fff; border-radius:6px; padding:10px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="margin-bottom:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; color:#495057;">
                <span style="font-weight:500; font-size:13px;">Top Stage(s)</span>
                <span style="color:#1976d2; font-size:12px; font-weight:600;">${stageCountText}</span>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;" id="dsb-stage-links">${renderStageText()}</div>
            </div>
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; color:#495057;">
                <span style="font-weight:500; font-size:13px;">Top Transition(s)</span>
                <span style="color:#1976d2; font-size:12px; font-weight:600;">${flowCountText}</span>
              </div>
              <div style="display:flex; flex-direction:column; gap:3px;" id="dsb-flow-links">${renderFlowText()}</div>
            </div>
          </div>
        </div>
        
        <div style="margin-bottom:12px; flex-shrink:0;">
          <div style="font-size:14px; font-weight:600; margin-bottom:6px; color:#222; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 3v18h18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M18 17V9" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M13 17V5" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 17v-3" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Stage Frequency Distribution
          </div>
          <div style="background:#fff; border-radius:6px; padding:6px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="width:100%; max-width:320px; margin:0 auto;">${barChart}</div>
          </div>
        </div>
        
        ${selectedStageInfo}
        ${selectedTransitionInfo}
        
        <div style="flex:1; min-height:0; display:flex; flex-direction:column; margin-top:4px;">
          ${nb.toc && nb.toc.length > 0 ? `
          <div style="flex:1; min-height:0; display:flex; flex-direction:column;">
            <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px; flex-shrink:0;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 6H20M4 10H20M4 14H20M4 18H20" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Table of Contents
            </div>
            <div class="toc-scroll" style="background:#fff; border-radius:6px; padding:12px; flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
              ${nb.toc.map((item: any) => {
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
      </div>
      <style>
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
          border: 1px solid #f8f9fa;
        }
        .toc-scroll::-webkit-scrollbar-thumb:hover {
          background: #adb5bd;
        }
        /* TOC项目悬停效果 */
        .toc-item:hover {
          transform: translateX(2px);
        }
        /* Kaggle链接悬停效果 */
        .kaggle-link:hover {
          opacity: 0.8;
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
        tooltip.style.background = "rgba(33, 37, 41, 0.9)";
        tooltip.style.color = "white";
        tooltip.style.padding = "8px 12px";
        tooltip.style.fontSize = "12px";
        tooltip.style.borderRadius = "6px";
        tooltip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
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
          e.stopPropagation();
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



  setCellDetail(cell: any) {
    this.currentNotebook = cell.notebook; // 保存当前 notebook
    // 在cell detail视图下，不改变标题颜色
    this._currentSelection = null;
    this.saveDetailFilterState();
    // Show cell details in English, including stage name
    const code = cell.source ?? cell.code ?? '';
    const codeLines = code.split(/\r?\n/);
    const stage = cell["1st-level label"] ?? '';
    const stageLabel = stage !== '' ? (LABEL_MAP[stage] ?? stage) : '';
    // 尝试获取 notebook index 和 cell index
    const nbIdx = cell._notebookDetail?.globalIndex !== undefined ? cell._notebookDetail.globalIndex : (cell.notebookIndex !== undefined ? cell.notebookIndex : '');
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
    if (cell && cell["1st-level label"] !== undefined && cell["1st-level label"] !== null) {
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
    const chartW = 280, chartH = 100, barW = chartW / binCount;
    // 获取当前 stage 的主色和group信息
    const stageLabelStr = String((cell && cell["1st-level label"]) ?? "None");
    const stageColor = this.colorMap?.get?.(stageLabelStr) || '#90caf9';
    const group = STAGE_GROUP_MAP[stageLabelStr];
    let borderStyle = 'none';
    let borderWidth = '0px';
    let borderColor = 'transparent';

    if (group === 'Data-oriented') {
      borderStyle = 'solid';
      borderWidth = '1.5px';
      borderColor = '#666666';
    } else if (group === 'Model-oriented') {
      borderStyle = 'dashed';
      borderWidth = '1.5px';
      borderColor = '#666666';
    }
    let barsSvg = '';
    for (let i = 0; i < binCount; ++i) {
      const x = i * barW;
      const h = bins[i] / maxBin * (chartH - 28);
      const binStart = (i / binCount).toFixed(2);
      const binEnd = ((i + 1) / binCount).toFixed(2);
      const tooltip = `Position: [${binStart}, ${binEnd})\nCount: ${bins[i]}`;
      barsSvg += `<rect x="${x}" y="${chartH - h}" width="${barW - 2}" height="${h}" fill="${stageColor}" rx="2" data-tooltip="${tooltip}" />`;
    }
    // 平均位置线
    let avgLineSvg = '';
    if (avgPos !== null) {
      const avgX = avgPos * chartW;
      avgLineSvg = `<line x1="${avgX}" y1="0" x2="${avgX}" y2="${chartH}" stroke="#1976d2" stroke-width="2.5" stroke-dasharray="4,3" />`;
    }
    // 当前 cell 位置高亮
    let currLineSvg = '';
    if (currentCellPosition !== null) {
      const currX = currentCellPosition * chartW;
      currLineSvg = `<line x1="${currX}" y1="0" x2="${currX}" y2="${chartH}" stroke="#dc3545" stroke-width="2.5" />`;
    }
    // 横纵坐标标注
    const axisTicks = [0, 0.25, 0.5, 0.75, 1];
    const axisSvg = [
      // 横坐标主线
      `<line x1="0" y1="${chartH}" x2="${chartW}" y2="${chartH}" stroke="#dee2e6" stroke-width="1" />`,
      // 横坐标刻度
      ...axisTicks.map(t => `<text x="${t * chartW}" y="${chartH + 12}" font-size="11" fill="#6c757d" text-anchor="middle">${t}</text>`),
      // 纵坐标主线
      `<line x1="0" y1="0" x2="0" y2="${chartH}" stroke="#dee2e6" stroke-width="1" />`,
      // 纵坐标最大值和0
      `<text x="-4" y="10" font-size="11" fill="#6c757d" text-anchor="end">${maxBin}</text>`,
      `<text x="-4" y="${chartH}" font-size="11" fill="#6c757d" text-anchor="end">0</text>`
    ].join('');
    const chartSvg = `<svg width="100%" height="${chartH + 32}" viewBox="-8 0 320 ${chartH + 32}">
      <g transform="translate(${(320 - chartW + 8) / 2}, ${(chartH + 32 - chartH) / 2})">
        ${barsSvg}${avgLineSvg}${currLineSvg}${axisSvg}
      </g>
    </svg>`;
    // legend 英文精致版
    const legendHtml = `<div style="display:flex; align-items:center; gap:6px; font-size:11px; color:#6c757d; margin-top:6px; justify-content:center;">
      <span style="display:inline-flex;align-items:center; padding:2px 5px; background:#f8f9fa; border-radius:3px;"><span style="display:inline-block;width:8px;height:0;border-top:2px dashed #1976d2;margin-right:3px;"></span>Mean</span>
      <span style="display:inline-flex;align-items:center; padding:2px 5px; background:#f8f9fa; border-radius:3px;"><span style="display:inline-block;width:8px;height:0;border-top:2px solid #dc3545;margin-right:3px;"></span>Current</span>
    </div>`;
    // cellType label tag
    const cellTypeLabel = cell.cellType ? `<span style="display:inline-block; background:#e3f2fd; color:#1976d2; font-size:10px; border-radius:10px; padding:2px 8px; margin-left:6px; vertical-align:middle; font-weight:500; border:1px solid #bbdefb;">${cell.cellType}</span>` : '';
    // 删除tab header，直接展示内容

    // 直接展示第一个tab的内容，不包装在tab中
    const cellDetailContent = `
      <div style="background:#f8f9fa; border-radius:6px; padding:12px; margin-bottom:12px; border:1px solid #e9ecef;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-weight:600; color:#495057; font-size:13px;">Stage</div>
          <div style="display:inline-flex; align-items:center;">
            <div style="width:10px; height:12px; background-color:${stageColor}; border-radius:2px; margin-right:6px; flex-shrink:0; border:${borderWidth} ${borderStyle} ${borderColor}; align-self:center;"></div>
            <span style="color:#222; font-weight:600; font-size:13px; line-height:12px; display:flex; align-items:center;">${stageLabel}</span>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:600; color:#495057; font-size:13px;">Code Lines</div>
          <div style="font-weight:700; color:#222; font-size:14px;">${codeLines.length}</div>
        </div>
      </div>
      
      <div style="margin-bottom:16px;">
        <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 3v18h18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18 17V9" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M13 17V5" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 17v-3" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Stage Position Distribution
        </div>
        <div style="background:#fff; border-radius:6px; padding:8px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="width:100%; max-width:320px; margin:0 auto;">${chartSvg}</div>
          <div style="margin-top:6px;">${legendHtml}</div>
        </div>
      </div>
      
      <div style="margin-bottom:12px;">
        <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 3v18h18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 9l3 3 3-3" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Code Line Count Distribution
        </div>
        <div style="background:#fff; border-radius:6px; padding:8px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="width:100%; max-width:320px; margin:0 auto;">${this._renderCodeLineDistChart(cell, allNotebooks, stageColor)}</div>
        </div>
      </div>
    `;
    this.node.innerHTML = `<div style="padding:16px 12px 12px 12px; width:100%; font-size:14px; color:#222; box-sizing:border-box;">
      <div style="font-size:15px; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:8px; flex-wrap; padding-bottom:8px; border-bottom:1px solid #e9ecef;" id="detail-sidebar-title">
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="dsb-back-btn" style="cursor: pointer; display: flex; align-items: center; gap: 3px; padding:3px; border-radius:3px; transition:background-color 0.2s;" title="Back to notebook overview">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 10H5M5 10L10 15M5 10L10 5" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span style="font-weight:600; color:#333;">Notebook ${nbIdx ? + nbIdx : ''}</span>
        </div>
        ${cellIdx ? `<span style='color:#6c757d; font-size:12px; font-weight:500;'>/ Cell ${cellIdx}</span>` : ''}
        ${cellTypeLabel}
        ${cell._notebookDetail?.url ? `
        <a href="${cell._notebookDetail.url}" target="_blank" class="kaggle-link" style="display:inline-flex; align-items:center; text-decoration:none; margin-left:8px; vertical-align:baseline; height:23.4px; line-height:23.4px;" title="View on Kaggle">
          <svg width="24" height="24" viewBox="0 0 163 63.2" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M26.92 47c-.05.18-.24.27-.56.27h-6.17a1.24 1.24 0 0 1-1-.48L9 33.78l-2.83 2.71v10.06a.61.61 0 0 1-.69.69H.69a.61.61 0 0 1-.69-.69V.69A.61.61 0 0 1 .69 0h4.79a.61.61 0 0 1 .69.69v28.24l12.21-12.35a1.44 1.44 0 0 1 1-.49h6.39a.54.54 0 0 1 .55.35.59.59 0 0 1-.07.63L13.32 29.55l13.46 16.72a.65.65 0 0 1 .14.73ZM51.93 47.24h-4.79c-.51 0-.76-.23-.76-.69v-1a12.77 12.77 0 0 1-7.84 2.29A11.28 11.28 0 0 1 31 45.16a9 9 0 0 1-3.12-7.07q0-6.81 8.46-9.23a61.55 61.55 0 0 1 10.06-1.67A5.47 5.47 0 0 0 40.48 21a14 14 0 0 0-7.91 2.77c-.41.24-.71.19-.9-.13l-2.5-3.54c-.23-.28-.16-.6.21-1a19.32 19.32 0 0 1 11.1-3.68A13.29 13.29 0 0 1 48 17.55q4.59 3.06 4.58 9.78v19.22a.61.61 0 0 1-.65.69Zm-5.55-14.5q-6.8.7-9.3 1.81Q33.69 36 34 38.71a3.49 3.49 0 0 0 1.53 2.46 5.87 5.87 0 0 0 3 1.08 9.49 9.49 0 0 0 7.77-2.57ZM81 59.28q-3.81 3.92-10.74 3.92a15.41 15.41 0 0 1-7.63-2c-.51-.33-1.11-.76-1.81-1.29s-1.5-1.19-2.43-2a.72.72 0 0 1-.07-1l3.26-3.26a.76.76 0 0 1 .56-.21.68.68 0 0 1 .49.21c2.58 2.58 5.11 3.88 7.56 3.88q8.39 0 8.39-8.74v-3.63a13.1 13.1 0 0 1-8.67 2.71 12.48 12.48 0 0 1-10.55-5.07A18.16 18.16 0 0 1 56 31.63a18 18 0 0 1 3.2-10.82 12.19 12.19 0 0 1 10.61-5.34 14 14 0 0 1 8.74 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .7.7v31q.03 7.57-3.73 11.49ZM78.58 26q-1.74-4.44-8-4.44-8.11 0-8.11 10.12 0 5.63 2.7 8.19a7.05 7.05 0 0 0 5.21 2q6.51 0 8.25-4.44ZM113.59 59.28q-3.78 3.91-10.72 3.92a15.44 15.44 0 0 1-7.63-2q-.76-.49-1.8-1.29c-.7-.53-1.51-1.19-2.43-2a.7.7 0 0 1-.07-1l3.26-3.26a.74.74 0 0 1 .55-.21.67.67 0 0 1 .49.21c2.59 2.58 5.11 3.88 7.56 3.88q8.4 0 8.4-8.74v-3.63a13.14 13.14 0 0 1-8.68 2.71A12.46 12.46 0 0 1 92 42.8a18.09 18.09 0 0 1-3.33-11.17 18 18 0 0 1 3.19-10.82 12.21 12.21 0 0 1 10.61-5.34 14 14 0 0 1 8.75 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .69.7v31q-.02 7.57-3.8 11.49ZM111.2 26q-1.74-4.44-8-4.44-8.2-.05-8.2 10.07 0 5.63 2.71 8.19a7 7 0 0 0 5.2 2q6.53 0 8.26-4.44ZM128 47.24h-4.78a.62.62 0 0 1-.7-.69V.69a.62.62 0 0 1 .7-.69H128a.61.61 0 0 1 .7.69v45.86a.61.61 0 0 1-.7.69ZM162.91 33.16a.62.62 0 0 1-.7.69h-22.54a8.87 8.87 0 0 0 2.91 5.69 10.63 10.63 0 0 0 7.15 2.46 11.64 11.64 0 0 0 6.86-2.15c.42-.28.77-.28 1 0l3.26 3.33c.37.37.37.69 0 1a18.76 18.76 0 0 1-11.58 3.75 16 16 0 0 1-11.8-4.72 16.2 16.2 0 0 1-4.57-11.86 16 16 0 0 1 4.51-11.52 14.36 14.36 0 0 1 10.82-4.3A14.07 14.07 0 0 1 158.88 20 15 15 0 0 1 163 31.63ZM153.82 23a8.18 8.18 0 0 0-5.69-2.15 8.06 8.06 0 0 0-5.48 2.08 9.24 9.24 0 0 0-3 5.41h16.71a7 7 0 0 0-2.54-5.34Z" fill="#20beff"/>
          </svg>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left:2px;">
            <path d="M7 17L17 7M17 7H7M17 7V17" stroke="#20beff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
        ` : ''}
      </div>
      ${cellDetailContent}
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
      
      /* Kaggle链接悬停效果 */
      .kaggle-link:hover {
        opacity: 0.8;
      }
    </style>`;
    // 事件绑定逻辑
    setTimeout(() => {
      // 绑定 notebook 返回事件
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

        // 添加返回按钮悬停效果
        backBtn.addEventListener('mouseenter', () => {
          (backBtn as HTMLElement).style.backgroundColor = '#f8f9fa';
        });
        backBtn.addEventListener('mouseleave', () => {
          (backBtn as HTMLElement).style.backgroundColor = 'transparent';
        });
      }
    }, 0);
    // 绑定图表 tooltip 事件
    setTimeout(() => {
      // 创建或获取tooltip元素
      let tooltipDiv = document.getElementById('galaxy-tooltip');
      if (!tooltipDiv) {
        tooltipDiv = document.createElement('div');
        tooltipDiv.id = 'galaxy-tooltip';
        tooltipDiv.style.position = 'fixed';
        tooltipDiv.style.display = 'none';
        tooltipDiv.style.pointerEvents = 'none';
        tooltipDiv.style.background = 'rgba(33, 37, 41, 0.9)';
        tooltipDiv.style.color = '#fff';
        tooltipDiv.style.padding = '8px 12px';
        tooltipDiv.style.borderRadius = '6px';
        tooltipDiv.style.fontSize = '12px';
        tooltipDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        tooltipDiv.style.zIndex = '9999';
        tooltipDiv.style.whiteSpace = 'pre-line';
        document.body.appendChild(tooltipDiv);
      }

      // 为所有带有data-tooltip属性的元素绑定事件
      const tooltipElements = this.node.querySelectorAll('[data-tooltip]');
      tooltipElements.forEach((element) => {
        element.addEventListener('mouseenter', (e) => {
          const tooltipText = element.getAttribute('data-tooltip') ?? '';
          tooltipDiv!.textContent = tooltipText;
          tooltipDiv!.style.display = 'block';
        });
        element.addEventListener('mousemove', (e) => {
          tooltipDiv!.style.left = (e as MouseEvent).clientX + 12 + 'px';
          tooltipDiv!.style.top = (e as MouseEvent).clientY + 12 + 'px';
        });
        element.addEventListener('mouseleave', () => {
          tooltipDiv!.style.display = 'none';
        });
      });
    }, 0);


  }

  setFilter(selection: any, skipEventDispatch: boolean = false) {
    this.filter = selection;
    this._currentSelection = selection; // 更新当前选中状态

    // 设置全局筛选状态，供NotebookDetailWidget使用（按tab隔离）
    const tabId = this.getTabId();
    const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
    const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
    
    if (selection) {
      if (selection.type === 'stage') {
        (window as any)[stageSelectionKey] = selection.stage;
        (window as any)[flowSelectionKey] = null;
        // 保持旧的全局变量兼容性
        (window as any)._galaxyFlowSelection = { type: 'stage', stage: selection.stage };
      } else if (selection.type === 'flow') {
        (window as any)[flowSelectionKey] = { from: selection.from, to: selection.to };
        (window as any)[stageSelectionKey] = null;
        // 保持旧的全局变量兼容性
        (window as any)._galaxyFlowSelection = { type: 'flow', from: selection.from, to: selection.to };
      }
    } else {
      (window as any)[stageSelectionKey] = null;
      (window as any)[flowSelectionKey] = null;
      // 保持旧的全局变量兼容性
      (window as any)._galaxyFlowSelection = null;
    }

    // 保持标题不变，始终显示competition名称或Notebook Overview
    this._currentTitle = this.competitionInfo ? this.competitionInfo.name : 'Notebook Overview';

    this.saveDetailFilterState();

    // 只有在不跳过事件派发时才触发事件
    if (!skipEventDispatch) {
      // 触发筛选状态变化事件，通知NotebookDetailWidget重新渲染
      window.dispatchEvent(new CustomEvent('galaxy-flow-selection-changed', { detail: selection }));

      // 触发MatrixWidget和flowchart的事件通知
      if (selection) {
        if (selection.type === 'stage') {
          // 通知MatrixWidget和flowchart选中stage
          window.dispatchEvent(new CustomEvent('galaxy-stage-selected', { detail: { stage: selection.stage, tabId } }));
        } else if (selection.type === 'flow') {
          // 通知MatrixWidget和flowchart选中flow
          window.dispatchEvent(new CustomEvent('galaxy-flow-selected', { detail: { from: selection.from, to: selection.to, tabId } }));
        }
      } else {
        // 清除选中状态
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

    // 设置标题为competition名称
    if (this.competitionInfo) {
      this._currentTitle = this.competitionInfo.name;
    } else {
      this._currentTitle = 'Notebook Overview';
    }
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

      // 生成选中项的显示信息
      let selectedItemInfo = '';
      if (this.filter) {
        if (this.filter.type === 'stage') {
          const stageColor = this.colorMap.get(this.filter.stage) || '#1976d2';
          const stageLabel = LABEL_MAP[this.filter.stage] ?? this.filter.stage;
          selectedItemInfo = `
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:14px; font-weight:600; color:#222;">Selected Stage:</span>
                <span style="color:${stageColor}; border:none; border-radius:16px; padding:3px 12px; font-size:13px; font-weight:600; display:inline-block;">${stageLabel}</span>
              </div>
            </div>
          `;
        } else if (this.filter.type === 'flow') {
          const fromColor = this.colorMap.get(this.filter.from) || '#1976d2';
          const toColor = this.colorMap.get(this.filter.to) || '#42a5f5';
          const fromLabel = LABEL_MAP[this.filter.from] ?? this.filter.from;
          const toLabel = LABEL_MAP[this.filter.to] ?? this.filter.to;
          selectedItemInfo = `
            <div style="background:#f8f9fa; border-radius:6px; padding:12px; margin-bottom:16px; border:1px solid #e9ecef;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span style="font-size:14px; font-weight:600; color:#222;">Selected Transition:</span>
                <span style="background: linear-gradient(90deg, ${fromColor}, ${toColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent; font-weight:600; font-size:13px;">${fromLabel} → ${toLabel}</span>
              </div>
            </div>
          `;
        }
      }

      // 在有filter时也生成notebook list
      const sortedAllData = [...this._allData].sort((a, b) => {
        const aOrderIndex = this.notebookOrder.indexOf(a.globalIndex - 1);
        const bOrderIndex = this.notebookOrder.indexOf(b.globalIndex - 1);
        return aOrderIndex - bOrderIndex;
      });

      const notebookListHtml = sortedAllData.map((nb) => {
        const kernelId = nb.kernelVersionId?.toString();
        const simRow = kernelId ? this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId) : null;
        const clusterId = simRow ? simRow.cluster_id : '-';

        return `<tr class="overview-notebook-item" data-notebook-index="${nb.globalIndex}" style="cursor:pointer; transition:background-color 0.15s;">
          <td style="padding:6px 8px; border-bottom:1px solid #e9ecef; text-align:center; color:#6c757d; font-size:11px; width:40px;">${nb.globalIndex}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e9ecef; text-align:center; color:#6c757d; font-size:11px; width:70px;">${clusterId}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e9ecef; font-weight:500; color:#495057; font-size:12px;">${nb.notebook_name ?? nb.kernelVersionId}</td>
        </tr>`;
      }).join('');

      this.node.innerHTML = `
      <div style="padding:20px 16px 16px 16px; font-size:14px; line-height:1.7; color:#222; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
        <div style="font-size:18px; font-weight:600; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #e9ecef; flex-shrink:0;" id="detail-sidebar-title">
          <span style="color: #222;">${this.competitionInfo ? this.competitionInfo.name : 'Notebook Overview'}</span>
        </div>
        
        ${selectedItemInfo}
        
        <div style="background:#f8f9fa; border-radius:8px; padding:16px; margin-bottom:16px; border:1px solid #e9ecef; flex-shrink:0;">
          <div style="display:flex; flex-direction:row; gap:16px;">
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:12px; color:#6c757d; margin-bottom:4px;">Total Occurrences</div>
              <div style="font-size:15px; font-weight:600; color:#495057;">${totalOccurrences}</div>
            </div>
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:12px; color:#6c757d; margin-bottom:4px;">Containing Notebooks</div>
              <div style="font-size:15px; font-weight:600; color:#495057;">${containingNotebooks}</div>
            </div>
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:12px; color:#6c757d; margin-bottom:4px;">Avg per Notebook</div>
              <div style="font-size:15px; font-weight:600; color:#495057;">${avgPerNotebook.toFixed(1)}</div>
            </div>
          </div>
        </div>
        
        <div style="flex:1; min-height:0; display:flex; flex-direction:column;">
          <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 12H15M9 16H15M9 8H15M5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3Z" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Notebook List
          </div>
          ${this.generateNotebookListHTML(notebookListHtml, false)}
        </div>
      </div>`;
      return;
    }

    // 没有filter时：显示原来的统计信息
    // 统计真实cell数并保留全局globalIndex（排除被隐藏的stage）
    const cellCountsWithIndex = filteredData.map(nb => {
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
    
    // Calculate average votes per notebook
    let totalVotes = 0;
    let notebooksWithVotes = 0;
    filteredData.forEach(nb => {
      const voteCount = this.getVoteCount(nb);
      if (voteCount !== null) {
        totalVotes += voteCount;
        notebooksWithVotes++;
      }
    });
    const avgVoteCount = notebooksWithVotes > 0 ? (totalVotes / notebooksWithVotes) : 0;
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
    // 渲染函数，显示为block图标和黑色文本
    const renderStageText = () => {
      // 检查是否所有stage都只出现一次
      const allStageFreqs = Object.values(stageFreq);
      const allStagesOnlyOnce = allStageFreqs.length > 0 && allStageFreqs.every(freq => freq === 1);

      if (allStagesOnlyOnce && mostFreqStages.length > 3) {
        return `<span style="color:#6c757d; font-size:13px; font-style:italic;">All stages appear only once (${mostFreqStages.length} unique stages)</span>`;
      }

      return mostFreqStages.map(stage => {
        const stageColor = this.colorMap.get(stage) || '#0066cc';
        const group = STAGE_GROUP_MAP[stage];
        let borderStyle = 'none';
        let borderWidth = '0px';
        let borderColor = 'transparent';

        if (group === 'Data-oriented') {
          borderStyle = 'solid';
          borderWidth = '1.5px';
          borderColor = '#666666';
        } else if (group === 'Model-oriented') {
          borderStyle = 'dashed';
          borderWidth = '1.5px';
          borderColor = '#666666';
        }

        return `<div style="display:inline-flex; align-items:center; margin-right:8px; margin-bottom:4px;">
          <div style="width:10px; height:12px; background-color:${stageColor}; border-radius:2px; margin-right:6px; flex-shrink:0; border:${borderWidth} ${borderStyle} ${borderColor}; align-self:center;"></div>
          <span style="color:#222; font-weight:600; font-size:13px; line-height:12px; display:flex; align-items:center;">${LABEL_MAP[stage] ?? stage}</span>
        </div>`;
      }).join('');
    };
    const renderFlowText = () => {
      if (mostFreqFlows.length === 0) {
        return `<span style='color:#6c757d; font-size:13px; font-style:italic;'>None</span>`;
      }

      // 检查是否所有transition都只出现一次
      const allFlowFreqs = Object.values(stageFlowFreq);
      const allFlowsOnlyOnce = allFlowFreqs.length > 0 && allFlowFreqs.every(freq => freq === 1);

      if (allFlowsOnlyOnce && mostFreqFlows.length > 3) {
        return `<span style="color:#6c757d; font-size:13px; font-style:italic;">All transitions appear only once (${mostFreqFlows.length} unique transitions)</span>`;
      }

      return mostFreqFlows.map(flow => {
        const [from, to] = flow.split(/->|→/);
        const fromColor = this.colorMap.get(from) || '#1976d2';
        const toColor = this.colorMap.get(to) || '#42a5f5';

        // 获取stage的group信息用于边框样式
        const fromGroup = STAGE_GROUP_MAP[from];
        const toGroup = STAGE_GROUP_MAP[to];

        let fromBorderStyle = 'none';
        let fromBorderWidth = '0px';
        let fromBorderColor = 'transparent';
        let toBorderStyle = 'none';
        let toBorderWidth = '0px';
        let toBorderColor = 'transparent';

        if (fromGroup === 'Data-oriented') {
          fromBorderStyle = 'solid';
          fromBorderWidth = '1.5px';
          fromBorderColor = '#666666';
        } else if (fromGroup === 'Model-oriented') {
          fromBorderStyle = 'dashed';
          fromBorderWidth = '1.5px';
          fromBorderColor = '#666666';
        }

        if (toGroup === 'Data-oriented') {
          toBorderStyle = 'solid';
          toBorderWidth = '1.5px';
          toBorderColor = '#666666';
        } else if (toGroup === 'Model-oriented') {
          toBorderStyle = 'dashed';
          toBorderWidth = '1.5px';
          toBorderColor = '#666666';
        }

        return `<div style="display:inline-flex; align-items:center; margin-right:8px; margin-bottom:4px;">
          <div style="width:10px; height:12px; background-color:${fromColor}; border-radius:2px; margin-right:6px; flex-shrink:0; border:${fromBorderWidth} ${fromBorderStyle} ${fromBorderColor}; align-self:center;"></div>
          <span style="color:#222; font-weight:600; font-size:13px; line-height:12px; display:flex; align-items:center;">${LABEL_MAP[from] ?? from}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin:0 4px;">
            <path d="M5 12H19M19 12L14 7M19 12L14 17" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div style="width:10px; height:12px; background-color:${toColor}; border-radius:2px; margin-right:6px; flex-shrink:0; border:${toBorderWidth} ${toBorderStyle} ${toBorderColor}; align-self:center;"></div>
          <span style="color:#222; font-weight:600; font-size:13px; line-height:12px; display:flex; align-items:center;">${LABEL_MAP[to] ?? to}</span>
        </div>`;
      }).join('');
    };


    // stage 频率柱状图
    const stageFreqArr = Object.entries(stageFreq).sort((a, b) => b[1] - a[1]);
    const maxStageCount = Math.max(...stageFreqArr.map(([_, c]) => c), 1);
    const barW2 = 24, barH2 = 60, gap2 = 6;
    const svgW2 = stageFreqArr.length * (barW2 + gap2);
    const svgH2 = barH2 + 32;

    // 自适应缩放：如果图表宽度超过容器，则缩小bar宽度和间距
    let actualBarW = barW2;
    let actualGap = gap2;
    let actualSvgW = svgW2;

    if (svgW2 > 280) { // 留20px边距
      const scale = 280 / svgW2;
      actualBarW = Math.max(barW2 * scale, 8); // 最小8px宽度
      actualGap = Math.max(gap2 * scale, 2); // 最小2px间距
      actualSvgW = stageFreqArr.length * (actualBarW + actualGap);
    }

    const stageBarChart = `<svg width="100%" height="${svgH2}" viewBox="0 0 320 ${svgH2}" style="overflow:visible;">
      <g transform="translate(${(320 - actualSvgW) / 2}, ${(svgH2 - barH2) / 2})">
        ${stageFreqArr.map(([stage, count], i) => `
          <rect x="${i * (actualBarW + actualGap)}" y="${barH2 - (count / maxStageCount) * barH2}" width="${actualBarW}" height="${(count / maxStageCount) * barH2}" fill="${this.colorMap.get(stage) || '#3182bd'}" rx="4" ry="4"
            style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.1));"
            onmousemove="(function(evt){var t=document.getElementById('galaxy-tooltip');if(!t){t=document.createElement('div');t.id='galaxy-tooltip';t.style.position='fixed';t.style.display='none';t.style.pointerEvents='none';t.style.background='rgba(0,0,0,0.75)';t.style.color='#fff';t.style.padding='6px 10px';t.style.borderRadius='4px';t.style.fontSize='12px';t.style.zIndex='9999';document.body.appendChild(t);}t.innerHTML='${LABEL_MAP[stage] ?? stage}: ${count}';t.style.display='block';t.style.left=evt.clientX+12+'px';t.style.top=evt.clientY+12+'px';}) (event)"
            onmouseleave="(function(){var t=document.getElementById('galaxy-tooltip');if(t)t.style.display='none';})()"
          >
          </rect>
          <text x="${i * (actualBarW + actualGap) + actualBarW / 2}" y="${barH2 - (count / maxStageCount) * barH2 - 6}" font-size="10" font-weight="600" text-anchor="middle" fill="#495057">${count}</text>
        `).join('')}
        <text x="-6" y="${barH2 + 4}" font-size="9" text-anchor="end" fill="#6c757d">0</text>
        <text x="-6" y="10" font-size="9" text-anchor="end" fill="#6c757d">${maxStageCount}</text>
      </g>
    </svg>`;

    // Notebook kernelVersionId 列表
    let notebookListHtml = '';

    // 根据notebookOrder重新排序所有notebook（包括有filter时）
    const sortedAllData = [...this._allData].sort((a, b) => {
      // 根据notebookOrder中的位置排序
      const aOrderIndex = this.notebookOrder.indexOf(a.globalIndex - 1);
      const bOrderIndex = this.notebookOrder.indexOf(b.globalIndex - 1);
      return aOrderIndex - bOrderIndex;
    });

    notebookListHtml = sortedAllData.map((nb) => {
      // 获取cluster_id
      const kernelId = nb.kernelVersionId?.toString();
      const simRow = kernelId ? this.similarityGroups.find((row: any) => row.kernelVersionId === kernelId) : null;
      const clusterId = simRow ? simRow.cluster_id : '-';

      return `<tr class="overview-notebook-item" data-notebook-index="${nb.globalIndex}" style="cursor:pointer; transition:background-color 0.15s;">
        <td style="padding:6px 8px; border-bottom:1px solid #e9ecef; text-align:center; color:#6c757d; font-size:11px; width:40px;">${nb.globalIndex}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e9ecef; text-align:center; color:#6c757d; font-size:11px; width:70px;">${clusterId}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #e9ecef; font-weight:500; color:#495057; font-size:12px;">${nb.notebook_name ?? nb.kernelVersionId}</td>
      </tr>`;
    }).join('');


    // 渲染
    this.node.innerHTML = `
      <div style="padding:16px 12px 12px 12px; font-size:13px; line-height:1.4; color:#222; height:100%; display:flex; flex-direction:column; box-sizing:border-box;">
        <div style="margin-bottom:12px; flex-shrink:0;" id="detail-sidebar-title">
          <div style="font-size:18px; font-weight:700; margin-bottom:6px; line-height:1.3; color:#222; padding-bottom:8px; border-bottom:1px solid #e9ecef;">
            <span style="color: #222;">${this.competitionInfo ? this.competitionInfo.name : 'Notebook Overview'}</span>${this.competitionInfo ? `
            <a href="${this.competitionInfo.url}" target="_blank" class="kaggle-link" style="display:inline-flex; align-items:center; text-decoration:none; margin-left:8px; vertical-align:baseline; height:23.4px; line-height:23.4px;" title="View on Kaggle">
              <svg width="24" height="24" viewBox="0 0 163 63.2" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M26.92 47c-.05.18-.24.27-.56.27h-6.17a1.24 1.24 0 0 1-1-.48L9 33.78l-2.83 2.71v10.06a.61.61 0 0 1-.69.69H.69a.61.61 0 0 1-.69-.69V.69A.61.61 0 0 1 .69 0h4.79a.61.61 0 0 1 .69.69v28.24l12.21-12.35a1.44 1.44 0 0 1 1-.49h6.39a.54.54 0 0 1 .55.35.59.59 0 0 1-.07.63L13.32 29.55l13.46 16.72a.65.65 0 0 1 .14.73ZM51.93 47.24h-4.79c-.51 0-.76-.23-.76-.69v-1a12.77 12.77 0 0 1-7.84 2.29A11.28 11.28 0 0 1 31 45.16a9 9 0 0 1-3.12-7.07q0-6.81 8.46-9.23a61.55 61.55 0 0 1 10.06-1.67A5.47 5.47 0 0 0 40.48 21a14 14 0 0 0-7.91 2.77c-.41.24-.71.19-.9-.13l-2.5-3.54c-.23-.28-.16-.6.21-1a19.32 19.32 0 0 1 11.1-3.68A13.29 13.29 0 0 1 48 17.55q4.59 3.06 4.58 9.78v19.22a.61.61 0 0 1-.65.69Zm-5.55-14.5q-6.8.7-9.3 1.81Q33.69 36 34 38.71a3.49 3.49 0 0 0 1.53 2.46 5.87 5.87 0 0 0 3 1.08 9.49 9.49 0 0 0 7.77-2.57ZM81 59.28q-3.81 3.92-10.74 3.92a15.41 15.41 0 0 1-7.63-2c-.51-.33-1.11-.76-1.81-1.29s-1.5-1.19-2.43-2a.72.72 0 0 1-.07-1l3.26-3.26a.76.76 0 0 1 .56-.21.68.68 0 0 1 .49.21c2.58 2.58 5.11 3.88 7.56 3.88q8.39 0 8.39-8.74v-3.63a13.1 13.1 0 0 1-8.67 2.71 12.48 12.48 0 0 1-10.55-5.07A18.16 18.16 0 0 1 56 31.63a18 18 0 0 1 3.2-10.82 12.19 12.19 0 0 1 10.61-5.34 13.93 13.93 0 0 1 8.74 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .7.7v31q.03 7.57-3.73 11.49ZM78.58 26q-1.74-4.44-8-4.44-8.11 0-8.11 10.12 0 5.63 2.7 8.19a7.05 7.05 0 0 0 5.21 2q6.51 0 8.25-4.44ZM113.59 59.28q-3.78 3.91-10.72 3.92a15.44 15.44 0 0 1-7.63-2q-.76-.49-1.8-1.29c-.7-.53-1.51-1.19-2.43-2a.7.7 0 0 1-.07-1l3.26-3.26a.74.74 0 0 1 .55-.21.67.67 0 0 1 .49.21c2.59 2.58 5.11 3.88 7.56 3.88q8.4 0 8.4-8.74v-3.63a13.14 13.14 0 0 1-8.68 2.71A12.46 12.46 0 0 1 92 42.8a18.09 18.09 0 0 1-3.33-11.17 18 18 0 0 1 3.19-10.82 12.21 12.21 0 0 1 10.61-5.34 14 14 0 0 1 8.75 2.71v-1.39a.62.62 0 0 1 .69-.7h4.79a.62.62 0 0 1 .69.7v31q-.02 7.57-3.8 11.49ZM111.2 26q-1.74-4.44-8-4.44-8.2-.05-8.2 10.07 0 5.63 2.71 8.19a7 7 0 0 0 5.2 2q6.53 0 8.26-4.44ZM128 47.24h-4.78a.62.62 0 0 1-.7-.69V.69a.62.62 0 0 1 .7-.69H128a.61.61 0 0 1 .7.69v45.86a.61.61 0 0 1-.7.69ZM162.91 33.16a.62.62 0 0 1-.7.69h-22.54a8.87 8.87 0 0 0 2.91 5.69 10.63 10.63 0 0 0 7.15 2.46 11.64 11.64 0 0 0 6.86-2.15c.42-.28.77-.28 1 0l3.26 3.33c.37.37.37.69 0 1a18.76 18.76 0 0 1-11.58 3.75 16 16 0 0 1-11.8-4.72 16.2 16.2 0 0 1-4.57-11.86 16 16 0 0 1 4.51-11.52 14.36 14.36 0 0 1 10.82-4.3A14.07 14.07 0 0 1 158.88 20 15 15 0 0 1 163 31.63ZM153.82 23a8.18 8.18 0 0 0-5.69-2.15 8.06 8.06 0 0 0-5.48 2.08 9.24 9.24 0 0 0-3 5.41h16.71a7 7 0 0 0-2.54-5.34Z" fill="#20beff"/>
              </svg>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left:2px;">
                <path d="M7 17L17 7M17 7H7M17 7V17" stroke="#20beff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </a>
            ` : ''}
          </div>
        </div>
        
        <div style="background:#f8f9fa; border-radius:6px; padding:12px; margin-bottom:12px; border:1px solid #e9ecef; flex-shrink:0;">
          <div style="display:flex; flex-direction:row; gap:12px;">
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Total Notebooks</div>
              <div style="font-size:14px; font-weight:600; color:#495057;">${notebookCount}</div>
            </div>
            <!--<div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Total Cells</div>
              <div style="font-size:14px; font-weight:600; color:#495057;">${totalCellCount}</div>
            </div>-->
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Avg Cells</div>
              <div style="font-size:14px; font-weight:600; color:#495057;">${avgCellCount.toFixed(2)}</div>
            </div>
            <div style="flex:1; display:flex; flex-direction:column; justify-content:flex-end;">
              <div style="font-size:11px; color:#6c757d; margin-bottom:2px;">Avg Vote</div>
              <div style="font-size:14px; font-weight:600; color:#495057;">${avgVoteCount.toFixed(1)}</div>
            </div>
          </div>
        </div>
        
        <div style="margin-bottom:16px; flex-shrink:0;">
          <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 11H15M9 15H15M9 7H15M5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3Z" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Workflow Analysis
          </div>
          <div style="background:#fff; border-radius:6px; padding:12px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="margin-bottom:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; color:#495057;">
                <span style="font-weight:500; font-size:13px;">Top Stage(s)</span>
                <span style="color:#1976d2; font-size:12px; font-weight:600;">${stageCountText}</span>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;" id="dsb-stage-links">${renderStageText()}</div>
            </div>
            <div style="margin-bottom:0px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; color:#495057;">
                <span style="font-weight:500; font-size:13px;">Top Transition(s)</span>
                <span style="color:#1976d2; font-size:12px; font-weight:600;">${flowCountText}</span>
              </div>
              <div style="display:flex; flex-direction:column; gap:3px;" id="dsb-flow-links">${renderFlowText()}</div>
            </div>
          </div>
        </div>
        
        <div style="margin-bottom:16px; flex-shrink:0;">
          <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 3v18h18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M18 17V9" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M13 17V5" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 17v-3" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Stage Frequency Distribution
          </div>
          <div style="background:#fff; border-radius:6px; padding:8px; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="width:100%; max-width:320px; margin:0 auto;">${stageBarChart}</div>
          </div>
        </div>
        
        <div style="flex:1; min-height:0; display:flex; flex-direction:column;">
          <div style="font-size:14px; font-weight:600; margin-bottom:8px; color:#222; display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 12H15M9 16H15M9 8H15M5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3Z" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Notebook List
          </div>
          ${this.generateNotebookListHTML(notebookListHtml, false)}
        </div>
      </div>
      <style>
        .kaggle-link:hover {
          opacity: 0.8;
        }
        
        /* 固定表头样式 */
        .notebook-list-wrapper {
          position: relative;
        }
        
        .notebook-list-container table {
          table-layout: fixed;
          width: 100%;
          min-width: 400px;
        }
        
        .notebook-list-container th,
        .notebook-list-container td {
          box-sizing: border-box;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        /* 表头文字样式优化 */
        .notebook-list-container th {
          font-size: 12px;
          line-height: 1.2;
          word-break: keep-all;
        }
        
        /* 确保表头和内容列宽一致 - overview模式 */
        .notebook-list-wrapper:not(.filtered-mode) .notebook-list-container th:nth-child(1),
        .notebook-list-wrapper:not(.filtered-mode) .notebook-list-container td:nth-child(1) {
          width: 40px;
        }
        
        .notebook-list-wrapper:not(.filtered-mode) .notebook-list-container th:nth-child(2),
        .notebook-list-wrapper:not(.filtered-mode) .notebook-list-container td:nth-child(2) {
          width: 70px;
        }
        
        .notebook-list-wrapper:not(.filtered-mode) .notebook-list-container th:nth-child(3),
        .notebook-list-wrapper:not(.filtered-mode) .notebook-list-container td:nth-child(3) {
          width: calc(100% - 110px);
        }
        
        /* filtered notebooks的列宽 - 使用更可靠的选择器 */
        .notebook-list-wrapper.filtered-mode .notebook-list-container th:nth-child(1),
        .notebook-list-wrapper.filtered-mode .notebook-list-container td:nth-child(1) {
          width: 50px;
        }
        
        .notebook-list-wrapper.filtered-mode .notebook-list-container th:nth-child(2),
        .notebook-list-wrapper.filtered-mode .notebook-list-container td:nth-child(2) {
          width: 80px;
        }
        
        .notebook-list-wrapper.filtered-mode .notebook-list-container th:nth-child(3),
        .notebook-list-wrapper.filtered-mode .notebook-list-container td:nth-child(3) {
          width: calc(100% - 210px);
        }
        
        .notebook-list-wrapper.filtered-mode .notebook-list-container th:nth-child(4),
        .notebook-list-wrapper.filtered-mode .notebook-list-container td:nth-child(4) {
          width: 100px;
        }
      </style>
    `;
    // 绑定 notebook 行点击事件和悬停效果
    setTimeout(() => {
      const notebookItems = this.node.querySelectorAll('.overview-notebook-item');
      notebookItems.forEach((item) => {
        const globalIdx = parseInt((item as HTMLElement).getAttribute('data-notebook-index') || '0', 10);

        item.addEventListener('click', (e) => {
          e.stopPropagation(); // 阻止事件冒泡
          if (this._allData && this._allData[globalIdx - 1]) { // globalIndex从1开始，所以需要减1
            this.setNotebookDetail(this._allData[globalIdx - 1], false); // 恢复事件派发，让主程序打开tab
          }
        });

        // 添加悬停效果
        item.addEventListener('mouseenter', () => {
          (item as HTMLElement).style.backgroundColor = '#e3f2fd';
        });
        item.addEventListener('mouseleave', () => {
          (item as HTMLElement).style.backgroundColor = '';
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
        tooltipDiv.style.background = 'rgba(33, 37, 41, 0.9)';
        tooltipDiv.style.color = '#fff';
        tooltipDiv.style.padding = '8px 12px';
        tooltipDiv.style.borderRadius = '6px';
        tooltipDiv.style.fontSize = '12px';
        tooltipDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
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

  // 渲染代码行数分布直方图
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
    if (codeLineCounts.length === 0) return '<div style="color:#6c757d; font-size:13px; text-align:center; padding:20px; font-style:italic;">No code cells in this stage.</div>';

    // 计算直方图的区间
    const minLines = Math.min(...codeLineCounts);
    const maxLines = Math.max(...codeLineCounts);
    const binCount = Math.min(15, Math.max(5, Math.ceil(Math.sqrt(codeLineCounts.length)))); // 自适应bin数量
    const binWidth = (maxLines - minLines) / binCount;

    // 统计每个区间的频率
    const bins: number[] = Array(binCount).fill(0);
    const binRanges: { start: number; end: number }[] = [];

    for (let i = 0; i < binCount; i++) {
      const start = minLines + i * binWidth;
      const end = minLines + (i + 1) * binWidth;
      binRanges.push({ start, end });

      codeLineCounts.forEach(count => {
        if (count >= start && count < end) {
          bins[i]++;
        }
      });
    }

    // 处理最后一个区间包含最大值的情况
    bins[binCount - 1] += codeLineCounts.filter(count => count === maxLines).length;

    const maxFreq = Math.max(...bins);
    const minBarHeight = 3; // 最小柱状图高度，确保小值也能看见

    // 当前 cell 的代码行数
    const currLines = (cell.source ?? cell.code ?? '').split(/\r?\n/).length;

    // SVG 参数
    const chartW = 280, chartH = 100;
    const barW = chartW / binCount;
    const gap = 1; // 柱状图之间的间距

    // 生成直方图
    let barsSvg = '';
    bins.forEach((freq, i) => {
      const barHeight = Math.max(minBarHeight, (freq / maxFreq) * (chartH - 28));
      const x = i * barW;
      const y = chartH - barHeight;

      barsSvg += `<rect x="${x + gap / 2}" y="${y}" width="${barW - gap}" height="${barHeight}" 
        fill="${stageColor || '#1976d2'}" rx="2" ry="2" 
        style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.1));"
        data-tooltip="Lines: ${binRanges[i].start.toFixed(0)}-${binRanges[i].end.toFixed(0)}\nCount: ${freq} cells" />`;

      // 移除柱状图顶部的数值标签
    });

    // 添加当前cell位置的竖线
    let currentLineSvg = '';
    const currentBinIndex = binRanges.findIndex(range =>
      currLines >= range.start && currLines < range.end
    );

    if (currentBinIndex !== -1) {
      const currentX = currentBinIndex * barW + barW / 2;
      currentLineSvg = `<line x1="${currentX}" y1="0" x2="${currentX}" y2="${chartH}" stroke="#dc3545" stroke-width="2.5" />`;
    }

    // 坐标轴
    const axisSvg = [
      // 横坐标主线
      `<line x1="0" y1="${chartH}" x2="${chartW}" y2="${chartH}" stroke="#dee2e6" stroke-width="1" />`,
      // 纵坐标主线
      `<line x1="0" y1="0" x2="0" y2="${chartH}" stroke="#dee2e6" stroke-width="1" />`,
      // 纵坐标标签
      `<text x="-4" y="10" font-size="11" fill="#6c757d" text-anchor="end">${maxFreq}</text>`,
      `<text x="-4" y="${chartH}" font-size="11" fill="#6c757d" text-anchor="end">0</text>`
    ].join('');

    // 横坐标标签（显示区间范围）
    const labelStep = Math.max(1, Math.ceil(binCount / 6));
    const labelsSvg = binRanges.map((range, i) => {
      if (i % labelStep === 0 || i === binCount - 1) {
        const x = i * barW + barW / 2;
        const label = `${range.start.toFixed(0)}-${range.end.toFixed(0)}`;
        return `<text x="${x}" y="${chartH + 12}" font-size="9" fill="#6c757d" text-anchor="middle">${label}</text>`;
      }
      return '';
    }).join('');

    const chartSvg = `<svg width="100%" height="${chartH + 44}" viewBox="-8 0 320 ${chartH + 44}">
      <g transform="translate(${(320 - chartW + 8) / 2}, ${(chartH + 44 - chartH) / 2})">
        ${barsSvg}
        ${currentLineSvg}
        ${axisSvg}
        ${labelsSvg}
      </g>
    </svg>`;

    // Legend
    const legendHtml = `<div style="display:flex; align-items:center; gap:6px; font-size:11px; color:#6c757d; margin-top:6px; justify-content:center;">
      <span style="display:inline-flex;align-items:center; padding:2px 5px; background:#f8f9fa; border-radius:3px;">
        <span style="display:inline-block;width:10px;height:0;border-top:2px solid #dc3545;margin-right:3px;"></span>Current: ${currLines} lines
      </span>
    </div>`;

    return chartSvg + legendHtml;
  }

  private getVoteCount(nb: any): number | null {
    if (!this.voteData || this.voteData.length === 0) {
      return null;
    }
    const kernelId = nb.kernelVersionId?.toString();
    if (!kernelId) {
      return null;
    }
    const voteRow = this.voteData.find((row: any) => row.kernelVersionId?.toString() === kernelId);
    return voteRow && voteRow.TotalVotes !== undefined ? parseFloat(voteRow.TotalVotes) || 0 : null;
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
    const flowSelectionKey = `_galaxyFlowSelection_${tabId}`;
    const stageSelectionKey = `_galaxyStageSelection_${tabId}`;
    const savedState = (window as any)[stateKey];

    if (savedState) {
      this.filter = savedState.filter;
      this.currentNotebook = savedState.currentNotebook;
      this._currentTitle = savedState.currentTitle;
      this._currentSelection = savedState.currentSelection;

      // 恢复按tab隔离的全局变量
      if (this.filter) {
        if (this.filter.type === 'stage') {
          (window as any)[stageSelectionKey] = this.filter.stage;
          (window as any)[flowSelectionKey] = null;
          // 保持旧的全局变量兼容性
          (window as any)._galaxyFlowSelection = { type: 'stage', stage: this.filter.stage };
        } else if (this.filter.type === 'flow') {
          (window as any)[flowSelectionKey] = { from: this.filter.from, to: this.filter.to };
          (window as any)[stageSelectionKey] = null;
          // 保持旧的全局变量兼容性
          (window as any)._galaxyFlowSelection = { type: 'flow', from: this.filter.from, to: this.filter.to };
        }
      } else {
        (window as any)[stageSelectionKey] = null;
        (window as any)[flowSelectionKey] = null;
        // 保持旧的全局变量兼容性
        (window as any)._galaxyFlowSelection = null;
      }

      // 恢复状态后重新渲染
      if (this.currentNotebook) {
        // 在notebook detail模式下，保持选中状态（不清除）
        this.setNotebookDetail(this.currentNotebook, true); // 跳过事件派发，避免循环
      } else if (this.filter) {
        this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow, this.notebookOrder);
      } else {
        this.setDefault();
      }
    } else {
      // 如果没有保存的状态，使用默认状态
      this.filter = null;
      this._currentSelection = null;
      this.currentNotebook = null;
      this._currentTitle = this.competitionInfo ? this.competitionInfo.name : 'Notebook Overview';
      
      // 清除按tab隔离的全局变量
      (window as any)[stageSelectionKey] = null;
      (window as any)[flowSelectionKey] = null;
      // 保持旧的全局变量兼容性
      (window as any)._galaxyFlowSelection = null;
      
      this.setDefault();
    }
  }

  // 高亮notebook列表中的指定notebook
  private highlightNotebookInList(notebookIndex: number, highlight: boolean) {
    // 处理overview notebooks
    const overviewNotebookItems = this.node.querySelectorAll('.overview-notebook-item');
    overviewNotebookItems.forEach((item) => {
      const globalIdx = parseInt((item as HTMLElement).getAttribute('data-notebook-index') || '0', 10);
      if (globalIdx === notebookIndex) {
        (item as HTMLElement).style.backgroundColor = highlight ? '#e3f2fd' : '';

        // 如果是高亮，滚动到该notebook位置
        if (highlight) {
          const tableContainer = this.node.querySelector('.notebook-list-container');
          if (tableContainer) {
            // 计算item相对于滚动容器的位置
            const itemTop = (item as HTMLElement).offsetTop;
            const containerHeight = tableContainer.clientHeight;
            const itemHeight = (item as HTMLElement).clientHeight;

            // 计算目标滚动位置，使item居中显示
            const targetScrollTop = itemTop - (containerHeight / 2) + (itemHeight / 2);

            tableContainer.scrollTo({
              top: targetScrollTop,
              behavior: 'smooth'
            });
          }
        }
      }
    });

    // 处理filtered notebooks
    const filteredNotebookItems = this.node.querySelectorAll('.filtered-notebook-item');
    filteredNotebookItems.forEach((item) => {
      const displayIndex = parseInt((item as HTMLElement).getAttribute('data-notebook-index') || '0', 10);
      // 对于filtered notebooks，我们需要通过displayIndex找到对应的notebook
      // 这里需要根据当前的filteredData来确定
      if (this.filter && this._allData) {
        // 获取当前filteredData中对应displayIndex的notebook
        const filteredData = this.getFilteredData();
        if (filteredData && filteredData[displayIndex]) {
          const nb = filteredData[displayIndex];
          if (nb.globalIndex === notebookIndex) {
            (item as HTMLElement).style.backgroundColor = highlight ? '#e3f2fd' : '';

            // 如果是高亮，滚动到该notebook位置
            if (highlight) {
              const tableContainer = this.node.querySelector('.notebook-list-container');
              if (tableContainer) {
                // 计算item相对于滚动容器的位置
                const itemTop = (item as HTMLElement).offsetTop;
                const containerHeight = tableContainer.clientHeight;
                const itemHeight = (item as HTMLElement).clientHeight;

                // 计算目标滚动位置，使item居中显示
                const targetScrollTop = itemTop - (containerHeight / 2) + (itemHeight / 2);

                tableContainer.scrollTo({
                  top: targetScrollTop,
                  behavior: 'smooth'
                });
              }
            }
          }
        }
      }
    });
  }

  // 生成notebook list HTML结构的辅助方法
  private generateNotebookListHTML(
    notebookListHtml: string,
    isFiltered: boolean = false,
    maxHeight: string = 'auto',
    containerMaxHeight: string = 'auto'
  ): string {
    const fontSize = isFiltered ? '13px' : '12px';
    const padding = isFiltered ? '8px 12px' : '6px 8px';
    const borderRadius = isFiltered ? '8px' : '6px';

    const headerColumns = isFiltered
      ? `
        <th style="padding:${padding}; text-align:center; font-weight:600; color:#495057; width:50px;">#</th>
        <th style="padding:${padding}; text-align:center; font-weight:600; color:#495057; width:80px;">Cluster</th>
        <th style="padding:${padding}; text-align:left; font-weight:600; color:#495057;">Notebook</th>
        <th style="padding:${padding}; text-align:right; font-weight:600; color:#495057;">Occurrences</th>
      `      : `
        <th style="padding:${padding}; text-align:center; font-weight:600; color:#495057; width:40px;">#</th>
        <th style="padding:${padding}; text-align:center; font-weight:600; color:#495057; width:70px;">Cluster</th>
        <th style="padding:${padding}; text-align:left; font-weight:600; color:#495057;">Notebook</th>
      `;

    return `
      <div class="notebook-list-wrapper${isFiltered ? ' filtered-mode' : ''}" style="background:#fff; border-radius:${borderRadius}; border:1px solid #e9ecef; box-shadow:0 1px 3px rgba(0,0,0,0.05); flex:1; min-height:0; display:flex; flex-direction:column;">
        <div class="notebook-list-container" style="overflow:auto; flex:1; min-height:0;">
          <table style="width:100%; border-collapse:collapse; font-size:${fontSize}; min-width:400px;">
            <thead style="position:sticky; top:0; background:#f8f9fa; border-bottom:1px solid #e9ecef; z-index:10;">
              <tr>
                ${headerColumns}
              </tr>
            </thead>
            <tbody ${isFiltered ? 'id="filtered-notebooks-tbody"' : ''}>
              ${notebookListHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 获取当前filtered data的辅助方法
  private getFilteredData(): any[] {
    if (!this._allData || !Array.isArray(this._allData) || this._allData.length === 0) {
      return [];
    }

    const hiddenStages = this._hiddenStages ?? new Set(['6', '1']);
    let filteredData = this._allData.map((nb) => {
      return {
        ...nb,
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

    return filteredData;
  }
} 