import { Widget } from '@lumino/widgets';
import { LABEL_MAP } from './labelMap';

function highlightPython(code: string): string {
  const keywords = [
    'import', 'from', 'as', 'def', 'class', 'return', 'for', 'if', 'else', 'elif', 'with', 'try', 'except', 'while', 'print', 'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None'
  ];
  let html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (const kw of keywords) {
    html = html.replace(new RegExp('(?<=^|\\W)(' + kw + ')(?=\\W|$)', 'g'), '<span class="nbd-kw">$1</span>');
  }
  html = html.replace(/('[^']*'|"[^"]*")/g, '<span class="nbd-str">$1</span>');
  html = html.replace(/(#.*)/g, '<span class="nbd-cmt">$1</span>');
  return html;
}

// 新增：去除高亮 span 的工具函数
function removeHighlightSpans(html: string): string {
  return html.replace(/<span class="nbd-\w+">([^<]*)<\/span>/g, '$1');
}

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
    // 确保 nb 有 index 字段
    if (nb && nb.index === undefined) {
      nb.index = 0;
    }
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
    // cell卡片渲染函数（NotebookDetailWidget风格）
    const renderStageCellCards = (nb: any, stage: string) => {
      const cells = (nb.cells ?? [])
        .map((c: any, i: number) => ({ ...c, cellIndex: i }))
        .filter((c: any) => c["1st-level label"] === stage && c.cellIndex !== cell.cellIndex);
      if (!cells.length) return '<div style="color:#aaa; font-size:13px; margin-bottom:12px;">No cell in this stage.</div>';
      return `<div style="display:flex; flex-direction:column; gap:14px; margin-bottom:12px;">${cells.map((c: any) => {
        const content = c.source ?? c.code ?? '';
        const cellIdx = c.cellIndex !== undefined ? c.cellIndex + 1 : '';
        const nbIdx = c.notebookIndex !== undefined ? c.notebookIndex : (nb.index !== undefined ? nb.index : 0);
        if (c.cellType === 'code') {
          // 简单高亮
          const codeLines = content.split(/\r?\n/);
          return `<div style="display:flex; flex-direction:row; align-items:stretch;">
            <div style="position:relative; min-width:36px; margin-right:8px; height:100%; display:flex; flex-direction:column; align-items:flex-end;">
              <div style="color:#888; font-size:15px; text-align:right; user-select:none; line-height:1.6; margin-left:8px;">[${cellIdx}]</div>
              <span class="nbd-jump-icon" data-nb-idx="${nbIdx}" data-cell-idx="${c.cellIndex}" style="cursor:pointer; margin-top:2px; display:inline-flex; align-items:center; justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7" stroke="#1976d2" stroke-width="2"/><path d="M10 7v6M7 10h6" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/></svg>
              </span>
            </div>
            <div class="nbd-cell" style="flex:1 1 0; min-width:0; display:flex; border-radius:6px; box-shadow:0 1px 4px #0001; background:#fff;">
              <div style="width:6px; border-radius:6px 0 0 6px; background:${stageColor}; margin-right:0;"></div>
              <div style="flex:1; padding:14px 18px 10px 14px; min-width:0;">
                <div class="nbd-code-area" style="background:#f7f7fa; border-radius:4px; padding:8px 0 0 0; font-size:13px; word-break:break-word; min-width:0; white-space:pre-wrap;">
                  <table style="border-spacing:0;"><tbody>
                    ${codeLines.map((line, i) => `<tr><td style=\"text-align:right; color:#bbb; font-size:12px; padding:0 10px 0 8px; user-select:none; white-space:nowrap; vertical-align:top;\">${i + 1}</td><td style=\"padding:0; font-family:var(--jp-code-font-family,monospace); text-align:left; vertical-align:top;\"><code class=\"nbd-code-line\" data-idx=\"${i}\">${removeHighlightSpans(highlightPython(line))}</code></td></tr>`).join('')}
                  </tbody></table>
                </div>
              </div>
            </div>
          </div>`;
        } else if (c.cellType === 'markdown') {
          // markdown渲染（只允许 simpleMarkdown，不插入用户 HTML）
          const simpleMarkdown = (md) => {
            let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
            html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
            html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
            html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
            html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
            html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
            html = html.replace(/\n/g, '<br>');
            return html;
          };
          return `<div style="display:flex; flex-direction:row; align-items:stretch; width:100%; min-width:0;">
            <div style="position:relative; min-width:36px; margin-right:8px; height:100%; display:flex; flex-direction:column; align-items:flex-end;">
              <div style="color:#888; font-size:15px; text-align:right; user-select:none; line-height:1.6; margin-left:8px;">[${cellIdx}]</div>
              <span class="nbd-jump-icon" data-nb-idx="${nbIdx}" data-cell-idx="${c.cellIndex}" style="cursor:pointer; margin-top:2px; display:inline-flex; align-items:center; justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7" stroke="#1976d2" stroke-width="2"/><path d="M10 7v6M7 10h6" stroke="#1976d2" stroke-width="2" stroke-linecap="round"/></svg>
              </span>
            </div>
            <div class="nbd-cell" style="flex:1 1 0; min-width:0; display:flex; border-radius:6px; box-shadow:0 1px 4px #0001; background:#fff; width:100%;">
              <div style="width:6px; border-radius:6px 0 0 6px; background:${stageColor}; margin-right:0;"></div>
              <div style="flex:1; padding:14px 18px 10px 14px; min-width:0; width:100%;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;"></div>
                <div class="nbd-md-area" style="all: initial; display: block; width: 100%; min-width: 0; word-break: break-all; white-space: pre-wrap; box-sizing: border-box; font-size:14px; color:#222; font-family:inherit; background:#fff; border-radius:4px; padding:10px 12px 10px 12px;">
                  ${simpleMarkdown(content)}
                </div>
              </div>
            </div>
          </div>`;
        }
        return '';
      }).join('')}</div>`;
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
      <div style="font-size:17px; font-weight:600; margin-bottom:12px; color:#1976d2; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span class="dsb-nb-link" style="color:#3182bd; cursor:pointer; text-decoration:underline;">Notebook${nbIdx ? + nbIdx : ''}</span>
        ${cellIdx ? `<span style='color:#888; font-size:14px;'>/ Cell ${cellIdx}</span>` : ''}
        ${cellTypeLabel}
      </div>
      ${tabHeader}
      ${tabContent}
    </div>`;
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
      // 新增：为跳转icon绑定事件
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
                // 当前 notebook，直接 jump
                window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
                  detail: { notebookIndex: nbIdx, cellIndex: cellIdx }
                }));
                // 右侧 detail 区域也要显示 cell 信息
                const targetCell = allNotebooksArr[nbIdx].cells[cellIdx];
                if (targetCell) {
                  window.dispatchEvent(new CustomEvent('galaxy-cell-detail', {
                    detail: { cell: { ...targetCell, notebookIndex: nbIdx, cellIndex: cellIdx, _notebookDetail: allNotebooksArr[nbIdx] } }
                  }));
                }
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
        });
      }
      // 初始绑定
      bindJumpIconEvents(cellListDiv as HTMLElement);
    }, 0);
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
  }

  setFilter(selection: any) {
    this.filter = selection;
    this.setSummary(this._allData, this._mostFreqStage, this._mostFreqFlow);
  }

  setSummary(data: any[], mostFreqStage?: string, mostFreqFlow?: string, notebookOrder?: number[]) {
    this._allData = data.map((nb, i) => ({ ...nb, index: nb.index !== undefined ? nb.index : i }));
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
      // kernelVersionId 可点击
      return `<tr><td style="color:#888;">${origIdx + 1}</td><td><a href="#" class="dsb-nb-kernel-link" data-idx="${origIdx}" style="color:#1976d2; text-decoration:underline; cursor:pointer; font-weight:600; font-size:14px; padding:2px 8px; border-radius:4px; transition:background 0.15s;">${nb.kernelVersionId ?? ''}</a></td></tr>`;
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
          <tr><td style="font-weight:500;">Most Common Stage</td><td style="text-align:right;">
            ${mostFreqStageLabel ? `<button style="background:${mostFreqStage ? this.colorMap.get(mostFreqStage) || '#1976d2' : '#1976d2'}; color:#fff; border:none; border-radius:16px; padding:3px 18px; font-size:15px; font-weight:700; cursor:pointer;">${mostFreqStageLabel}</button>` : ''}
          </td></tr>
          <tr><td style="font-weight:500;">Most Common Stage Transition</td><td style="text-align:right;">
            ${mostFreqStageFlowLabel ? `<button style="background:#e3eaf3; color:#1976d2; border:none; border-radius:16px; padding:3px 18px; font-size:15px; font-weight:700; cursor:pointer;">${mostFreqStageFlowLabel}</button>` : ''}
          </td></tr>
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
    // 绑定 kernelVersionId 跳转事件
    setTimeout(() => {
      const links = this.node.querySelectorAll('.dsb-nb-kernel-link');
      links.forEach(link => {
        link.addEventListener('mouseenter', () => {
          (link as HTMLElement).style.background = '#e3eaf3';
        });
        link.addEventListener('mouseleave', () => {
          (link as HTMLElement).style.background = '';
        });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const idx = parseInt((link as HTMLElement).getAttribute('data-idx') || '0', 10);
          if (this._allData && this._allData[idx]) {
            window.dispatchEvent(new CustomEvent('galaxy-notebook-selected', {
              detail: { notebook: { ...this._allData[idx], index: idx } }
            }));
            this.setNotebookDetail(this._allData[idx]);
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
  }

  // 新增：渲染代码行数分布柱状图
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
    const cdf: {x: number, y: number}[] = xTicks.map(x => {
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
} 