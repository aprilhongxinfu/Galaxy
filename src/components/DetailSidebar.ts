import { Widget } from '@lumino/widgets';
import { LABEL_MAP } from './labelMap';

export class DetailSidebar extends Widget {
  private colorMap: Map<string, string>;
  // private notebookOrder: number[];
  private filter: any = null;
  private _allData: any[] = [];
  private _mostFreqStage: string | undefined;
  private _mostFreqFlow: string | undefined;
  constructor(colorMap: Map<string, string>, notebookOrder: number[]) {
    super();
    this.colorMap = colorMap;
    this.id = 'galaxy-detail-sidebar';
    this.title.label = 'Details';
    this.title.closable = true;
    this.addClass('galaxy-detail-sidebar');
    this.setDefault();
    this.node.style.overflowY = 'auto';
    // 移除事件监听到 onAfterAttach
  }

  onAfterAttach() {
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
    this.node.innerHTML = `<div style="padding:16px; color:#888;">请选择一个 notebook 或 cell 查看详情。</div>`;
  }

  setNotebookDetail(nb: any) {
    const cells = nb.cells ?? [];
    const total = cells.length;
    const codeCount = cells.filter((c: any) => c.cellType === 'code').length;
    const mdCount = cells.filter((c: any) => c.cellType === 'markdown').length;

    // 统计最常见stage和flow（与flowchart一致）
    const stageFreq: Record<string, number> = {};
    const transitions: Record<string, number> = {};
    for (let i = 0; i < cells.length; i++) {
      const stage = String(cells[i]["1st-level label"] ?? 'None');
      if (stage !== 'None') {
        stageFreq[stage] = (stageFreq[stage] || 0) + 1;
      }
      if (i < cells.length - 1) {
        const from = String(cells[i]["1st-level label"] ?? 'None');
        const to = String(cells[i + 1]["1st-level label"] ?? 'None');
        if (from !== 'None' && to !== 'None' && from !== to) {
          const key = `${from}->${to}`;
          transitions[key] = (transitions[key] || 0) + 1;
        }
      }
    }
    const mostFreqStage = Object.entries(stageFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const mostFreqFlow = Object.entries(transitions).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const mostFreqStageLabel = mostFreqStage ? (LABEL_MAP[mostFreqStage] ?? mostFreqStage) : '';
    let mostFreqStageFlowLabel = '';
    if (mostFreqFlow) {
      const [from, to] = mostFreqFlow.split('->');
      mostFreqStageFlowLabel = `${LABEL_MAP[from] ?? from} → ${LABEL_MAP[to] ?? to}`;
    }

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

    // 插入内容
    this.node.innerHTML = `
      <div style="padding:28px 18px 18px 18px; font-size:15px; color:#222; max-width:420px; margin:0 auto;">
        <div style="font-size:20px; font-weight:700; margin-bottom:18px; line-height:1.2; word-break:break-all;">${nb.kernelVersionId ?? ''}</div>
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
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="font-weight:500;">Most Common Stage</td><td style="text-align:right;">${mostFreqStageLabel}</td></tr>
          <tr><td style="font-weight:500;">Most Common Stage Transition</td><td style="text-align:right;">${mostFreqStageFlowLabel}</td></tr>
        </table>
        <div style="margin:18px 0 8px 0; font-weight:600; font-size:15px;">Stage Frequency Distribution</div>
        <div style="height:16px;"></div>
        <div style="margin: 8px 0 12px 0; width:100%; max-width:600px; margin-left:auto; margin-right:auto;">${barChart}</div>
      </div>
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
    }, 0);
  }

  setCellDetail(cell: any) {
    // Show cell details in English, including stage name
    const code = cell.source ?? cell.code ?? '';
    const codeLines = code.split(/\r?\n/);
    const stage = cell["1st-level label"] ?? '';
    const stageLabel = stage ? (LABEL_MAP[stage] ?? stage) : '';
    // 尝试获取 notebook index 和 cell index
    const nbIdx = cell.notebookIndex !== undefined ? cell.notebookIndex + 1 : '';
    const cellIdx = cell.cellIndex !== undefined ? cell.cellIndex + 1 : '';
    this.node.innerHTML = `<div style="padding:16px;">
      <div style="font-size:16px; font-weight:600; margin-bottom:10px;">
        <span class="dsb-nb-link" style="color:#3182bd; cursor:pointer; text-decoration:underline;">Notebook${nbIdx ? + nbIdx : ''}</span>
        ${cellIdx ? ` / Cell ${cellIdx}` : ''}
      </div>
      <div><b>cellId:</b> ${cell.cellId ?? ''}</div>
      <div><b>cellType:</b> ${cell.cellType ?? ''}</div>
      <div><b>Stage:</b> ${stageLabel}</div>
      <div><b>Code lines:</b> ${codeLines.length}</div>
      <!-- You can add more cell info here -->
    </div>`;
    // 绑定 notebook 返回事件
    setTimeout(() => {
      const nbLink = this.node.querySelector('.dsb-nb-link');
      if (nbLink) {
        nbLink.addEventListener('click', () => {
          if (cell._notebookDetail) {
            this.setNotebookDetail(cell._notebookDetail);
          } else if ((window as any).galaxyCurrentNotebookDetail) {
            this.setNotebookDetail((window as any).galaxyCurrentNotebookDetail);
          }
          window.dispatchEvent(new CustomEvent('galaxy-clear-cell-selection'));
        });
      }
    }, 0);
  }

  setFilter(selection: any) {
    this.filter = selection;
    this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow);
  }

  setSummary(data: any[], mostFreqStage?: string, mostFreqFlow?: string, notebookOrder?: number[]) {
    this._allData = data;
    this._mostFreqStage = mostFreqStage;
    this._mostFreqFlow = mostFreqFlow;
    let filteredData = data;
    if (this.filter) {
      if (this.filter.type === 'stage') {
        filteredData = data.filter(nb => nb.cells.some((cell: any) => String(cell["1st-level label"] ?? "None") === this.filter.stage));
      } else if (this.filter.type === 'flow') {
        filteredData = data.filter(nb => {
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
    const cellCounts = filteredData.map(nb => nb.cells?.length ?? 0);
    const totalCellCount = cellCounts.reduce((a, b) => a + b, 0);
    const avgCellCount = notebookCount ? (totalCellCount / notebookCount) : 0;
    // 最长/最短 notebook
    let longestIdx = 0, shortestIdx = 0;
    cellCounts.forEach((c, i) => {
      if (c > cellCounts[longestIdx]) longestIdx = i;
      if (c < cellCounts[shortestIdx]) shortestIdx = i;
    });
    const longestTitle = filteredData[longestIdx]?.path ?? '';
    const shortestTitle = filteredData[shortestIdx]?.path ?? '';
    const longestKernel = filteredData[longestIdx]?.kernelVersionId ? ` <span style='color:#888'>(kernelVersionId: ${filteredData[longestIdx].kernelVersionId})</span>` : '';
    const shortestKernel = filteredData[shortestIdx]?.kernelVersionId ? ` <span style='color:#888'>(kernelVersionId: ${filteredData[shortestIdx].kernelVersionId})</span>` : '';
    const longestIndex = `<span style='color:#888'>#${longestIdx + 1}</span>`;
    const shortestIndex = `<span style='color:#888'>#${shortestIdx + 1}</span>`;
    // 每 notebook 首 stage 种类数
    // const firstStages = data.map(nb => {
    //   const first = nb.cells?.find((cell: any) => cell["1st-level label"] != null);
    //   return first ? String(first["1st-level label"]) : 'None';
    // });
    // const uniqueFirstStages = Array.from(new Set(firstStages));
    // stage 频率
    const stageFreq: Record<string, number> = {};
    const stageFlowFreq: Record<string, number> = {};
    const firstStageFreq: Record<string, number> = {};
    filteredData.forEach(nb => {
      let prevStage: string | null = null;
      nb.cells?.forEach((cell: any, idx: number) => {
        const stage = String(cell["1st-level label"] ?? 'None');
        if (stage !== 'None') {
          stageFreq[stage] = (stageFreq[stage] || 0) + 1;
        }
        if (idx === 0 && stage !== 'None') {
          firstStageFreq[stage] = (firstStageFreq[stage] || 0) + 1;
        }
        if (
          prevStage !== null &&
          prevStage !== undefined &&
          prevStage !== 'None' &&
          stage !== 'None' &&
          !(prevStage === 'None' && stage === 'None') &&
          prevStage !== stage
        ) {
          const flow = prevStage + '→' + stage;
          stageFlowFreq[flow] = (stageFlowFreq[flow] || 0) + 1;
        }
        prevStage = stage;
      });
    });
    // 只用传入的 mostFreqStage/mostFreqFlow
    const mostFreqStageLabel = mostFreqStage ? (LABEL_MAP[mostFreqStage] ?? mostFreqStage) : '';
    let mostFreqStageFlowLabel = '';
    if (mostFreqFlow) {
      const [from, to] = mostFreqFlow.split('->');
      mostFreqStageFlowLabel = `${LABEL_MAP[from] ?? from} → ${LABEL_MAP[to] ?? to}`;
    }

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
            <title>${count} unique stages: ${n} notebooks</title>
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
            <title>${LABEL_MAP[stage] ?? stage}: ${count}</title>
          </rect>
          <text x="${i * (barW2 + gap2) + barW2 / 2}" y="${barH2 - (count / maxStageCount) * barH2 - 4}" font-size="11" text-anchor="middle" fill="#222">${count}</text>
        `).join('')}
        <text x="-6" y="${barH2 + 4}" font-size="10" text-anchor="end" fill="#888">0</text>
        <text x="-6" y="10" font-size="10" text-anchor="end" fill="#888">${maxStageCount}</text>
      </g>
    </svg>`;

    // Notebook kernelVersionId 列表
    const order = notebookOrder ?? filteredData.map((_, i) => i);
    const notebookListHtml = order.map(idx => {
      const nb = filteredData[idx];
      if (!nb) return '';
      const origIdx = this._allData.findIndex(item => item === nb);
      return `<tr><td style="color:#888;">${origIdx + 1}</td><td>${nb.kernelVersionId ?? ''}</td></tr>`;
    }).join('');

    // 渲染
    this.node.innerHTML = `
      <div style="padding:20px 18px 18px 18px; font-size:14px; line-height:1.7; color:#222;">
        <div style="font-size:18px; font-weight:600; margin-bottom:14px;">Notebook Overview</div>
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="font-weight:500;">Total Notebooks</td><td style="text-align:right;"><b>${notebookCount}</b></td></tr>
          <tr><td style="font-weight:500;">Total Cells</td><td style="text-align:right;"><b>${totalCellCount}</b></td></tr>
          <tr><td style="font-weight:500;">Average Cells per Notebook</td><td style="text-align:right;"><b>${avgCellCount.toFixed(2)}</b></td></tr>
        </table>
        <div style="margin:10px 0 0 0; font-weight:500;">Notebook with Most Cells</div>
        <div style="color:#555; font-size:13px; margin-bottom:4px;">${longestIndex} ${longestTitle}${longestKernel}</div>
        <div style="font-weight:500;">Notebook with Fewest Cells</div>
        <div style="color:#555; font-size:13px; margin-bottom:8px;">${shortestIndex} ${shortestTitle}${shortestKernel}</div>
        <div style="font-weight:500; margin-bottom:10px;">Number of Unique Stages Distribution</div>
        <div style="margin: 8px 0 12px 0; width:100%; max-width:600px; margin-left:auto; margin-right:auto;">${uniqueStageDistChart}</div>
        <hr style="margin:16px 0 10px 0; border:none; border-top:1px solid #eee;">
        <div style="font-size:16px; font-weight:600; margin-bottom:10px;">Stage Analysis</div>
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="font-weight:500;">Most Common Stage</td><td style="text-align:right;">${mostFreqStageLabel}</td></tr>
          <tr><td style="font-weight:500;">Most Common Stage Transition</td><td style="text-align:right;">${mostFreqStageFlowLabel}</td></tr>
        </table>
        <div style="font-weight:500; margin:10px 0 10px 0;">Stage Occurrence</div>
        <div style="margin: 8px 0 12px 0; width:100%; max-width:600px; margin-left:auto; margin-right:auto;">${stageBarChart}</div>
        <hr style="margin:16px 0 10px 0; border:none; border-top:1px solid #eee;">
        <div style="font-size:16px; font-weight:600; margin:24px 0 10px 0;">Notebook Kernel Version</div>
        <table style="width:100%; font-size:13px; color:#555;">
          <tr><th style="text-align:left; color:#888; font-weight:400;">#</th><th style="text-align:left; color:#888; font-weight:400;">kernelVersionId</th></tr>
          ${notebookListHtml}
        </table>
      </div>
    `;
  }
} 