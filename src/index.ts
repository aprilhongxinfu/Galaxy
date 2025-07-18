import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette,
  ToolbarButton
} from '@jupyterlab/apputils';

import { IFileBrowserFactory, FileBrowser } from '@jupyterlab/filebrowser';
import { LeftSidebar } from './components/LeftSidebar';

import { PageConfig } from '@jupyterlab/coreutils';
import { runIcon } from '@jupyterlab/ui-components';
import { colorMap, initColorMap } from './components/colorMap';
import { MatrixWidget } from './components/MatrixWidget';
import { DetailSidebar } from './components/DetailSidebar';
import { NotebookDetailWidget } from './components/NotebookDetailWidget';
import { LabShell } from '@jupyterlab/application';
import { csvParse } from 'd3-dsv';

function getXsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(/\b_xsrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function activate(
  app: JupyterFrontEnd,
  palette: ICommandPalette,
  browserFactory: IFileBrowserFactory,
  restorer: ILayoutRestorer | null
) {
  console.log('✅ JupyterLab extension galaxy is here!');

  const command = 'galaxy:analyze';

  app.commands.addCommand(command, {
    label: 'Analyze Selected Notebooks',
    execute: async () => {
      const fileBrowserWidget = browserFactory.tracker.currentWidget;
      if (!fileBrowserWidget) {
        console.warn('⚠️ No active file browser');
        return;
      }

      const selectedItems = Array.from(fileBrowserWidget.selectedItems());

      try {
        // 关闭之前的插件窗口
        const oldLeft = app.shell.widgets('left');
        for (const w of oldLeft) {
          if (w.id === 'flow-chart-widget') w.close();
        }
        const oldMain = app.shell.widgets('main');
        for (const w of oldMain) {
          if (w.id === 'matrix-widget') w.close();
        }
        const oldRight = app.shell.widgets('right');
        for (const w of oldRight) {
          if (w.id === 'galaxy-detail-sidebar') w.close();
        }

        // 判断是否只选中了一个 .json 文件
        let result1: any = null;
        let similarityGroups: any[] = [];
        if (
          selectedItems.length === 1 &&
          selectedItems[0].type === 'file' &&
          selectedItems[0].path.endsWith('18599_predicted.json')
        ) {
          // 直接用 Contents API 读取 JSON 文件内容
          const contentsManager = app.serviceManager.contents;
          const model = await contentsManager.get(selectedItems[0].path, { type: 'file', format: 'text', content: true });
          result1 = JSON.parse(model.content as string);
          console.log('Loaded JSON:', result1);
          // 读取 CSV 文件
          try {
            const csvModel = await contentsManager.get('test-notebooks/enhanced_similarity_groups.csv', { type: 'file', format: 'text', content: true });
            similarityGroups = csvParse(csvModel.content as string);
            // 转换 similarity_score 为数字
            similarityGroups.forEach((d: any) => { d.similarity_score = +d.similarity_score; });
            console.log('Loaded CSV:', similarityGroups);
          } catch (e) {
            alert('无法读取 enhanced_similarity_groups.csv');
            similarityGroups = [];
          }
        } else if (
          selectedItems.length === 1 &&
          selectedItems[0].type === 'file' &&
          selectedItems[0].path.endsWith('.json')
        ) {
          // 直接用 Contents API 读取 JSON 文件内容
          const contentsManager = app.serviceManager.contents;
          const model = await contentsManager.get(selectedItems[0].path, { type: 'file', format: 'text', content: true });
          result1 = JSON.parse(model.content as string);
          console.log('Loaded JSON:', result1);
        } else {
          // 原有的后端 fetch 逻辑
          const selectedPaths = selectedItems
            .filter(item => item.type === 'notebook' || item.type === 'directory')
            .map(item => item.path);

          if (selectedPaths.length === 0) {
            console.warn('⚠️ No notebooks selected');
            return;
          }

          const xsrfToken = getXsrfTokenFromCookie();
          const url1 = PageConfig.getBaseUrl() + 'galaxy/analyzeNew';
          const res1 = await fetch(url1, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-XSRFToken': xsrfToken || ''
            },
            credentials: 'same-origin',
            body: JSON.stringify({ paths: selectedPaths })
          });

          if (!res1.ok) throw new Error(`❌ ${res1.statusText}`);
          result1 = await res1.json();
          console.log(result1);
        }

        // 统一颜色映射
        const allStages = new Set<string>();
        result1.forEach((nb: any) => {
          nb.cells.forEach((cell: any) => {
            const stage = String(cell["1st-level label"] ?? "None");
            allStages.add(stage);
          });
        });
        initColorMap(allStages);
        const flowChartWidget = new LeftSidebar(result1, colorMap);
        app.shell.add(flowChartWidget, 'left');
        if (typeof (app.shell as any).expandLeftArea === 'function') {
          (app.shell as any).expandLeftArea();
        }
        app.shell.activateById(flowChartWidget.id);
        console.log('LeftSidebar added, expanded, and activated');
        // 保存原始 sidebar 和数据，便于 notebook 详情切换回来
        let originalLeftSidebar = flowChartWidget;

        // 添加 MatrixWidget 到主区域
        const colorScale = (label: string) => colorMap.get(label) || '#ccc';
        const matrixWidget = new MatrixWidget(result1, colorScale, similarityGroups);
        app.shell.add(matrixWidget, 'main');
        matrixWidget.disposed.connect(() => {
          closeSidebarsIfNoMainWidgets(app);
        });
        const notebookOrder = matrixWidget.getNotebookOrder();
        const detailSidebar = new DetailSidebar(colorMap, notebookOrder);
        const { mostFreqStage, mostFreqFlow } = flowChartWidget.getMostFrequentStageAndFlow();
        detailSidebar.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget.getNotebookOrder());
        app.shell.add(detailSidebar, 'right');
        if (typeof (app.shell as any).expandRightArea === 'function') {
          (app.shell as any).expandRightArea();
        }
        app.shell.activateById(detailSidebar.id);
        console.log('DetailSidebar added, expanded, and activated');
        // 监听 notebook 排序变化，实时同步 sidebar
        window.addEventListener('galaxy-notebook-order-changed', (e: any) => {
          detailSidebar.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget.getNotebookOrder());
        });

        // 统一管理 flowchart/matrix/detail 的筛选联动
        let currentSelection: any = null;
        window.addEventListener('galaxy-stage-selected', (e: any) => {
          currentSelection = { type: 'stage', stage: e.detail.stage };
          matrixWidget.setFilter(currentSelection);
          detailSidebar.setFilter(currentSelection);
        });
        window.addEventListener('galaxy-flow-selected', (e: any) => {
          currentSelection = { type: 'flow', from: e.detail.from, to: e.detail.to };
          matrixWidget.setFilter(currentSelection);
          detailSidebar.setFilter(currentSelection);
        });
        window.addEventListener('galaxy-selection-cleared', () => {
          currentSelection = null;
          matrixWidget.setFilter(null);
          detailSidebar.setFilter(null);
        });

        // 监听 notebook 详情切换
        window.addEventListener('galaxy-notebook-selected', (e: any) => {
          // 关闭所有已存在的 notebook 详情 widget
          const mainWidgets = app.shell.widgets('main');
          for (const w of mainWidgets) {
            if (w.id === 'notebook-detail-widget') w.close();
          }

          // 新建并显示 notebook 详情
          const nb = e.detail.notebook;
          const nbDetailWidget = new NotebookDetailWidget(nb);
          app.shell.add(nbDetailWidget, 'main');
          app.shell.activateById(nbDetailWidget.id);
          // 关闭 sidebar 的联动
          nbDetailWidget.disposed.connect(() => {
            closeSidebarsIfNoMainWidgets(app);
          });

          // 新建只显示该 notebook 的 flowchart
          const singleLeftSidebar = new LeftSidebar([nb], colorMap);
          app.shell.add(singleLeftSidebar, 'left');
          setTimeout(() => {
            if (typeof (app.shell as any).expandLeftArea === 'function') {
              (app.shell as any).expandLeftArea();
            }
            app.shell.activateById(singleLeftSidebar.id);
            console.log('SingleLeftSidebar expanded and activated (setTimeout)');
          }, 0);

          // 右侧 sidebar 只显示该 notebook 信息
          detailSidebar.setNotebookDetail(nb);

          // 再关闭 matrix widget
          const oldMain = app.shell.widgets('main');
          for (const w of oldMain) {
            if (w.id === 'matrix-widget') w.close();
          }
          // 再关闭左侧 flow-chart-widget（如果有旧的）
          const oldLeft = app.shell.widgets('left');
          for (const w of oldLeft) {
            if (w.id === 'flow-chart-widget' && w !== singleLeftSidebar) w.close();
          }

          // 新增：如果有 jumpCellIndex，自动 jump 到 cell
          if (e.detail.jumpCellIndex !== undefined) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
                detail: { notebookIndex: nb.index, cellIndex: e.detail.jumpCellIndex }
              }));
            }, 0);
          }

          // 返回事件
          const handleBack = () => {
            // 关闭 notebook 详情
            const mainWidgets = app.shell.widgets('main');
            for (const w of mainWidgets) {
              if (w.id === 'notebook-detail-widget') w.close();
            }
            // 关闭当前 flow-chart-widget
            const leftWidgets = app.shell.widgets('left');
            for (const w of leftWidgets) {
              if (w.id === 'flow-chart-widget') w.close();
            }
            // 恢复原始 LeftSidebar
            app.shell.add(originalLeftSidebar, 'left');
            app.shell.activateById(originalLeftSidebar.id);
            // 重新显示 matrix widget
            app.shell.add(matrixWidget, 'main');
            app.shell.activateById(matrixWidget.id);
            // 恢复 summary 视图
            detailSidebar.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget.getNotebookOrder());
            window.removeEventListener('galaxy-notebook-detail-back', handleBack);
          };
          window.addEventListener('galaxy-notebook-detail-back', handleBack);
        });
      } catch (err) {
        alert('不是合法的 JSON 文件或分析失败');
        console.error('❌ Failed to analyze notebooks:', err);
      }
    }
  });

  palette.addItem({ command: command, category: 'Galaxy Tools' });

  if (restorer) {
    // 已无 tracker，直接不 restore
  }

  app.restored.then(() => {
    // 添加 "Analyze" 按钮到 FileBrowser 工具栏
    const fbWidget = browserFactory.tracker.currentWidget;
    if (fbWidget && fbWidget instanceof FileBrowser) {
      const analyzeButton = new ToolbarButton({
        icon: runIcon,
        tooltip: 'Analyze selected notebooks',
        onClick: () => {
          app.commands.execute(command);
        }
      });
      fbWidget.toolbar.insertItem(5, 'analyzeNotebooks', analyzeButton);
    }
  })


  if (app.shell instanceof LabShell) {
    app.shell.layoutModified.connect(() => {
      closeSidebarsIfNoMainWidgets(app);
    });
  }
}

// 辅助函数：只在主区域没有 matrix-widget 或 notebook-detail-widget 时关闭 sidebar
function closeSidebarsIfNoMainWidgets(app: JupyterFrontEnd) {
  const mainWidgets = Array.from(app.shell.widgets('main'));
  const mainIds = mainWidgets.map(w => w.id);
  const hasMain = mainWidgets.some(w =>
    w.id === 'matrix-widget' || w.id === 'notebook-detail-widget'
  );
  console.log('closeSidebarsIfNoMainWidgets called. mainWidgets:', mainIds, 'hasMain:', hasMain);
  if (mainWidgets.filter(w => w.id === 'matrix-widget' || w.id === 'notebook-detail-widget').length === 0) {
    // 关闭左侧 flowchart
    const oldLeft = app.shell.widgets('left');
    for (const w of oldLeft) {
      if (w.id === 'flow-chart-widget') w.close();
    }
    // 关闭右侧 detail sidebar
    const oldRight = app.shell.widgets('right');
    for (const w of oldRight) {
      if (w.id === 'galaxy-detail-sidebar') w.close();
    }
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'galaxy:plugin',
  description: 'Analyze selected notebooks and show Sankey diagram.',
  autoStart: true,
  requires: [ICommandPalette, IFileBrowserFactory],
  optional: [ILayoutRestorer],
  activate
};

export default plugin;