import { Widget } from '@lumino/widgets';
import { colorMap } from './colorMap';

import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import 'highlight.js/styles/atom-one-light.css';
hljs.registerLanguage('python', python);

export interface Cell {
    row: number;
    col: number;
    content: string | null;
    stage: string | null;
    cellId: string | null;
}

export interface SankeyClickPayload {
    notebookCells: Cell[];
    stageCells: Cell[];
}

const stageColorMap = colorMap;

export class GalaxySidebar extends Widget {
    constructor(payload: SankeyClickPayload) {
        super();
        this.addClass('galaxy-sidebar');
        this.addClass('jp-Notebook');

        this.node.innerHTML = `
      <div style="padding: 10px; height: 100%; display: flex; flex-direction: column;">
        <div class="tab-buttons" style="margin-bottom: 10px;">
          <button id="tab-notebook" class="active">Notebook Cells</button>
          <button id="tab-stage">Stage Cells</button>
        </div>
        <div style="flex: 1; overflow-y: auto;">
          <div id="notebook-content"></div>
          <div id="stage-content" style="display: none;"></div>
        </div>
      </div>
    `;

        const notebookContainer = this.node.querySelector('#notebook-content')!;
        const stageContainer = this.node.querySelector('#stage-content')!;

        notebookContainer.innerHTML = this.renderNotebookView(payload.notebookCells);
        stageContainer.innerHTML = this.renderStageView(payload.stageCells);

        this.addTabSwitching();
    }

    updateContent(payload: SankeyClickPayload) {
        const notebookContainer = this.node.querySelector('#notebook-content');
        const stageContainer = this.node.querySelector('#stage-content');

        if (notebookContainer && stageContainer) {
            notebookContainer.innerHTML = this.renderNotebookView(payload.notebookCells);
            stageContainer.innerHTML = this.renderStageView(payload.stageCells);
        }
    }

    private renderNotebookView(cells: Cell[]): string {
        if (cells.length === 0) return '<p>No cells available.</p>';

        const byNotebook = new Map<number, Cell[]>();
        for (const cell of cells) {
            const col = cell.col;
            if (!byNotebook.has(col)) byNotebook.set(col, []);
            byNotebook.get(col)!.push(cell);
        }

        return Array.from(byNotebook.entries()).map(([col, notebookCells]) => {
            const notebookTitle = `<h2 style="margin: 16px 0 12px; font-size: 20px; border-bottom: 2px solid #aaa;">Notebook ${col + 1}</h2>`;

            const groupedByStage = new Map<string, Cell[]>();
            for (const cell of notebookCells) {
                const stage = cell.stage ?? 'Unknown';
                if (!groupedByStage.has(stage)) groupedByStage.set(stage, []);
                groupedByStage.get(stage)!.push(cell);
            }

            const stageSections = Array.from(groupedByStage.entries()).map(([stage, group]) => {
                const color = stageColorMap.get(stage) || '#999';
                const stageTitle = `<h3 style="margin-top: 12px; border-left: 4px solid ${color}; padding-left: 6px;">${stage}</h3>`;
                const cellsHtml = group.map(cell => this.renderCodeCell(cell, color)).join('');
                return stageTitle + cellsHtml;
            }).join('');

            return notebookTitle + stageSections;
        }).join('');
    }

    private renderStageView(cells: Cell[]): string {
        if (cells.length === 0) return '<p>No cells available.</p>';

        const byStage = new Map<string, Cell[]>();
        for (const cell of cells) {
            const stage = cell.stage ?? 'Unknown';
            if (!byStage.has(stage)) byStage.set(stage, []);
            byStage.get(stage)!.push(cell);
        }

        return Array.from(byStage.entries()).map(([stage, stageCells]) => {
            const color = stageColorMap.get(stage) || '#999';
            const stageTitle = `<h2 style="margin: 16px 0 12px; font-size: 20px; border-bottom: 2px solid ${color};">Stage: ${stage}</h2>`;

            const groupedByNotebook = new Map<number, Cell[]>();
            for (const cell of stageCells) {
                const col = cell.col;
                if (!groupedByNotebook.has(col)) groupedByNotebook.set(col, []);
                groupedByNotebook.get(col)!.push(cell);
            }

            const notebookSections = Array.from(groupedByNotebook.entries()).map(([col, group]) => {
                const notebookTitle = `<h4 style="margin-top: 8px; font-size: 16px; color: #444;">Notebook ${col + 1}</h4>`;
                const cellsHtml = group.map(cell => this.renderCodeCell(cell, color)).join('');
                return notebookTitle + cellsHtml;
            }).join('');

            return stageTitle + notebookSections;
        }).join('');
    }

    private renderCodeCell(cell: Cell, leftBorderColor = '#ccc'): string {
        const highlighted = hljs.highlight(cell.content || '', { language: 'python' }).value;
        return `
      <div class="jp-Cell jp-CodeCell" style="border-left: 4px solid ${leftBorderColor}; margin-bottom: 8px;">
        <div class="jp-Cell-inputWrapper">
          <div class="jp-InputPrompt">In&nbsp;[${cell.cellId ?? ''}]:</div>
          <div class="jp-CodeMirrorEditor">
            <pre class="jp-CodeMirrorEditor"><code class="jp-mod-preformatted jp-CodeMirrorEditor-code hljs language-python">${highlighted}</code></pre>
          </div>
        </div>
      </div>
    `;
    }

    private addTabSwitching() {
        const notebookTab = this.node.querySelector('#tab-notebook')!;
        const stageTab = this.node.querySelector('#tab-stage')!;
        const notebookContent: HTMLElement = this.node.querySelector('#notebook-content')!;
        const stageContent: HTMLElement = this.node.querySelector('#stage-content')!;

        notebookTab.addEventListener('click', () => {
            notebookTab.classList.add('active');
            stageTab.classList.remove('active');
            notebookContent.style.display = 'block';
            stageContent.style.display = 'none';
        });

        stageTab.addEventListener('click', () => {
            notebookTab.classList.remove('active');
            stageTab.classList.add('active');
            notebookContent.style.display = 'none';
            stageContent.style.display = 'block';
        });
    }
}