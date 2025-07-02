import { Widget } from '@lumino/widgets';
import { LABEL_MAP } from './labelMap';
import { colorMap } from './colorMap';

function highlightPython(code: string): string {
  // 简单高亮，支持常见关键字
  const keywords = [
    'import', 'from', 'as', 'def', 'class', 'return', 'for', 'if', 'else', 'elif', 'with', 'try', 'except', 'while', 'print', 'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None'
  ];
  let html = code
    .replace(/(&)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  for (const kw of keywords) {
    html = html.replace(new RegExp('(?<=^|\W)(' + kw + ')(?=\W|$)', 'g'), '<span class="nbd-kw">$1</span>');
  }
  // 字符串
  html = html.replace(/('[^']*'|"[^"]*")/g, '<span class="nbd-str">$1</span>');
  // 注释
  html = html.replace(/(#.*)/g, '<span class="nbd-cmt">$1</span>');
  return html;
}

function simpleMarkdown(md: string): string {
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

export class NotebookDetailWidget extends Widget {
  private notebook: any;
  private selectedCellIdx: number | null = null;
  private ignoreNextScroll: boolean = false;
  constructor(notebook: any) {
    super();
    this.notebook = notebook;
    this.id = 'notebook-detail-widget';
    this.title.label = 'Notebook Detail';
    this.title.closable = true;
    this.addClass('notebook-detail-widget');
    this.render();
  }

  private render() {
    const nb = this.notebook;
    const nbIdx = (nb.path && /\d+/.test(nb.path)) ? nb.path.match(/\d+/)![0] : '';
    this.node.innerHTML = `
      <div style="padding:24px; max-width:900px; margin:0 auto; height:100%; box-sizing:border-box; display:flex; flex-direction:column;">
        <div style="display:flex; align-items:center; font-size:15px; font-weight:500; margin-bottom:18px; margin-top:8px;">
          <span class="nbd-breadcrumb" style="color:#3182bd; cursor:pointer; text-decoration:underline;">Overview</span>
          <span style="margin:0 8px; color:#888;">/</span>
          <span style="color:#222;">notebook ${nbIdx || ''}</span>
        </div>
        <div style="flex:1 1 auto; min-height:0; display:flex; flex-direction:row; align-items:flex-start; gap:0;">
          <!-- Mini map -->
          <div style="width:20px; margin-right:14px; display:flex; flex-direction:column; justify-content:center; align-self:center;">
            ${(() => {
              const cells = nb.cells ?? [];
              const minimapHeight = cells.length * 4;
              const rects = cells.map((cell: any, i: number) => {
                const stage = String(cell["1st-level label"] ?? 'None');
                const color = colorMap.get(stage) || '#ccc';
                const isSelected = this.selectedCellIdx === i;
                if (cell.cellType === 'markdown') {
                  return `<rect x="0" y="${i * 4}" width="20" height="4" fill="transparent" stroke="${isSelected ? '#000' : '#ccc'}" stroke-width="${isSelected ? 2 : 1}" data-stage="${stage}" data-idx="${i}" style="cursor:pointer;" />`;
                } else {
                  return `<rect x="0" y="${i * 4}" width="20" height="4" fill="${color}" stroke="${isSelected ? '#000' : 'none'}" stroke-width="${isSelected ? 2 : 0}" data-stage="${stage}" data-idx="${i}" style="cursor:pointer;" />`;
                }
              }).join('');
              return `<svg width="20" height="${minimapHeight}" style="display:block; margin:0 auto;">${rects}</svg>`;
            })()}
          </div>
          <!-- Cell 列表 -->
          <div style="flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:18px; overflow-y:auto; height:100%;" id="nbd-cell-list-scroll">
            ${(nb.cells ?? []).map((cell: any, i: number) => {
              const stage = String(cell["1st-level label"] ?? 'None');
              const stageColor = colorMap.get(stage) || '#ccc';
              const content = cell.source ?? cell.code ?? '';
              const isSelected = this.selectedCellIdx === i;
              if (cell.cellType === 'code') {
                const codeLines = content.split(/\r?\n/);
                return `
                  <div style="display:flex; flex-direction:row; align-items:stretch;">
                    <div style="position:relative; min-width:36px; margin-right:8px; height:100%;">
                      ${isSelected ? `<div style="position:absolute;left:0;top:0;width:3px;height:100%;background:#1976d2;border-radius:2px;"></div>` : ''}
                      <div style="color:#888; font-size:15px; text-align:right; user-select:none; line-height:1.6; margin-left:8px; height:100%; display:flex; align-items:center;">[${i+1}]</div>
                    </div>
                    <div class="nbd-cell" style="flex:1; display:flex; border-radius:6px; box-shadow:0 1px 4px #0001; background:#fff;">
                      <div style="width:6px; border-radius:6px 0 0 6px; background:${stageColor}; margin-right:0;"></div>
                      <div style="flex:1; padding:14px 18px 10px 14px;">
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;"></div>
                        <div class="nbd-code-area" style="background:#f7f7fa; border-radius:4px; padding:8px 0 0 0; font-size:13px; overflow-x:auto;">
                          <table style="border-spacing:0;"><tbody>
                            ${codeLines.map((line, idx) => `
                              <tr>
                                <td style="text-align:right; color:#bbb; font-size:12px; padding:0 10px 0 8px; user-select:none;">${idx+1}</td>
                                <td style="padding:0; font-family:var(--jp-code-font-family,monospace); text-align:left;"><code style="background:none; padding:0; display:block;">${highlightPython(line)}</code></td>
                              </tr>
                            `).join('')}
                          </tbody></table>
                        </div>
                      </div>
                    </div>
                  </div>
                `;
              } else if (cell.cellType === 'markdown') {
                const isHtml = /^\s*<.+?>/.test(content.trim());
                return `
                  <div style="display:flex; flex-direction:row; align-items:stretch;">
                    <div style="position:relative; min-width:36px; margin-right:8px; height:100%;">
                      ${isSelected ? `<div style="position:absolute;left:0;top:0;width:3px;height:100%;background:#1976d2;border-radius:2px;"></div>` : ''}
                      <div style="color:#888; font-size:15px; text-align:right; user-select:none; line-height:1.6; margin-left:8px; height:100%; display:flex; align-items:center;">[${i+1}]</div>
                    </div>
                    <div class="nbd-cell" style="flex:1; display:flex; border-radius:6px; box-shadow:0 1px 4px #0001; background:#fff;">
                      <div style="width:6px; border-radius:6px 0 0 6px; background:#ccc; margin-right:0;"></div>
                      <div style="flex:1; padding:14px 18px 10px 14px;">
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;"></div>
                        <div class="nbd-md-area" style="background:#fff; border-radius:4px; padding:10px 12px 10px 12px; font-size:14px; color:#222; overflow-x:auto; word-break:break-word;">
                          ${isHtml ? content : simpleMarkdown(content)}
                        </div>
                      </div>
                    </div>
                  </div>
                `;
              } else {
                // 其它类型直接显示内容
                return `
                  <div style="display:flex; flex-direction:row; align-items:stretch;">
                    <div style="position:relative; min-width:36px; margin-right:8px; height:100%;">
                      ${isSelected ? `<div style="position:absolute;left:0;top:0;width:3px;height:100%;background:#1976d2;border-radius:2px;"></div>` : ''}
                      <div style="color:#888; font-size:15px; text-align:right; user-select:none; line-height:1.6; margin-left:8px; height:100%; display:flex; align-items:center;">[${i+1}]</div>
                    </div>
                    <div class="nbd-cell" style="flex:1; display:flex; border-radius:6px; box-shadow:0 1px 4px #0001; background:#fff;">
                      <div style="width:6px; border-radius:6px 0 0 6px; background:${stageColor}; margin-right:0;"></div>
                      <div style="flex:1; padding:14px 18px 10px 14px;">
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                          <span style="color:#888; font-size:13px;">[${i+1}]</span>
                          <span class="nbd-tag" style="background:#eee; color:#888;">${cell.cellType}</span>
                          <span class="nbd-tag" style="background:${stageColor}22; color:${stageColor};">${LABEL_MAP[stage] ?? stage}</span>
                        </div>
                        <div class="nbd-md-area" style="background:#fcfcf7; border-radius:4px; padding:10px 12px 10px 12px; font-size:14px; color:#222; overflow-x:auto;">
                          ${content}
                        </div>
                      </div>
                    </div>
                  </div>
                `;
              }
            }).join('')}
          </div>
        </div>
      </div>
      <style>
        .nbd-tag { display:inline-block; border-radius:3px; padding:1px 7px; font-size:12px; margin-right:2px; }
        .nbd-breadcrumb:hover { text-decoration:underline; color:#1976d2; }
        .nbd-kw { color:#1976d2; font-weight:bold; }
        .nbd-str { color:#c41a16; }
        .nbd-cmt { color:#888; font-style:italic; }
      </style>
    `;
    // Mini map 色条动态着色
    setTimeout(() => {
      const minimapSvg = this.node.querySelector('svg');
      if (!minimapSvg) return;
      // minimap 点击跳转和高亮 + hover 高亮
      minimapSvg.querySelectorAll('rect').forEach((r, i) => {
        r.addEventListener('click', () => {
          this.selectedCellIdx = i;
          this.ignoreNextScroll = true;
          this.render();
          setTimeout(() => {
            const cellList = this.node.querySelector('#nbd-cell-list-scroll');
            if (!cellList) return;
            const cellDivs = cellList.querySelectorAll('.nbd-cell');
            const target = cellDivs[i]?.parentElement as HTMLElement;
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            //   target.style.transition = 'box-shadow 0.3s, border 0.3s';
            //   target.style.boxShadow = '0 0 0 3px #1976d2aa';
              setTimeout(() => {
                target.style.boxShadow = '';
              }, 600);
            }
          }, 0);
        });
        r.addEventListener('mouseenter', () => {
          r.setAttribute('stroke', '#000');
          r.setAttribute('stroke-width', '1');
        });
        r.addEventListener('mouseleave', () => {
          // 还原为选中或默认
          if (this.selectedCellIdx === i) {
            r.setAttribute('stroke', '#000');
            r.setAttribute('stroke-width', '1');
          } else {
            const cells = this.notebook.cells ?? [];
            if (cells[i]?.cellType === 'markdown') {
              r.setAttribute('stroke', '#ccc');
              r.setAttribute('stroke-width', '1');
            } else {
              r.setAttribute('stroke', 'none');
              r.setAttribute('stroke-width', '0');
            }
          }
        });
      });
      // cell 列表滚动时自动高亮可视 cell，防抖
      const cellList = this.node.querySelector('#nbd-cell-list-scroll');
      let scrollTimeout: any = null;
      if (cellList) {
        cellList.addEventListener('scroll', () => {
          if (this.ignoreNextScroll) {
            this.ignoreNextScroll = false;
            return;
          }
          if (scrollTimeout) clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            const cellDivs = cellList.querySelectorAll('.nbd-cell');
            let minDist = Infinity, minIdx = 0;
            const listRect = cellList.getBoundingClientRect();
            cellDivs.forEach((div, i) => {
              const rect = div.getBoundingClientRect();
              const dist = Math.abs(rect.top + rect.height / 2 - (listRect.top + listRect.height / 2));
              if (dist < minDist) {
                minDist = dist;
                minIdx = i;
              }
            });
            if (this.selectedCellIdx !== minIdx) {
              this.selectedCellIdx = minIdx;
              // 只更新 minimap rect 的高亮
              const minimapSvg = this.node.querySelector('svg');
              if (minimapSvg) {
                minimapSvg.querySelectorAll('rect').forEach((r, i) => {
                  if (i === minIdx) {
                    r.setAttribute('stroke', '#000');
                    r.setAttribute('stroke-width', '1');
                  } else {
                    const cells = this.notebook.cells ?? [];
                    if (cells[i]?.cellType === 'markdown') {
                      r.setAttribute('stroke', '#ccc');
                      r.setAttribute('stroke-width', '1');
                    } else {
                      r.setAttribute('stroke', 'none');
                      r.setAttribute('stroke-width', '0');
                    }
                  }
                });
              }
              // 只更新 cell 列表左侧蓝线
              cellDivs.forEach((div, i) => {
                const bar = div.parentElement?.querySelector('div[style*="background:#1976d2"]');
                if (bar) bar.remove();
                if (i === minIdx) {
                  const blueBar = document.createElement('div');
                  blueBar.style.position = 'absolute';
                  blueBar.style.left = '0';
                  blueBar.style.top = '0';
                  blueBar.style.transform = 'none';
                  blueBar.style.width = '3px';
                  blueBar.style.height = '100%';
                  blueBar.style.background = '#1976d2';
                  blueBar.style.borderRadius = '2px';
                  div.parentElement?.insertBefore(blueBar, div.parentElement.firstChild);
                }
              });
            }
          }, 100);
        });
      }
    }, 0);
    // 顶部 Overview 点击返回
    const overview = this.node.querySelector('.nbd-breadcrumb') as HTMLSpanElement;
    if (overview) {
      overview.onclick = () => {
        window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-back'));
      };
    }
  }
} 