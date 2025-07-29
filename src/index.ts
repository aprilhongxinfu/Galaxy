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
import { colorMap as colorMapModule, initColorMap } from './components/colorMap';
import { MatrixWidget } from './components/MatrixWidget';
import { DetailSidebar } from './components/DetailSidebar';
import { NotebookDetailWidget } from './components/NotebookDetailWidget';
import { LabShell } from '@jupyterlab/application';
import { csvParse } from 'd3-dsv';

function getXsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(/\b_xsrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

let handleNotebookSelected: ((e: any) => void) | null = null;
let notebookSelectedListenerRegistered = false;
let app: JupyterFrontEnd;
let flowChartWidget: LeftSidebar | null = null;
let detailSidebar: DetailSidebar | null = null;
let result1: any = null;
let mostFreqStage: any = null;
let mostFreqFlow: any = null;
let matrixWidget: MatrixWidget | null = null;
let notebookCache = new Map<string, any>();
let notebookDetailIds = new Set<string>();
let colorMap: any = null;

function activate(
  appInstance: JupyterFrontEnd,
  palette: ICommandPalette,
  browserFactory: IFileBrowserFactory,
  restorer: ILayoutRestorer | null
) {
  console.log('✅ JupyterLab extension galaxy is now!');

  const command = 'galaxy:analyze';

  // 将 app 赋值给全局变量
  app = appInstance;

  let similarityGroups: any[] = [];
  let lastKnownDetailIds: Set<string> = new Set();

  // ====== handleTabSwitch 放回 activate 内部，直接访问最新 sidebar 变量 ======
  function handleTabSwitch(widget: any) {
    // 新增：如果 widget 为空或不是 galaxy 相关 tab，关闭 sidebar
    if (!widget || !(widget.id && (widget.id === 'matrix-widget' || widget.id.startsWith('notebook-detail-widget-')))) {
      closeSidebarsIfNoMainWidgets(app);
      return;
    }
    const tabId = widget.id || '';
    console.log('[tab switch] widget.id:', tabId, widget);
    if (tabId.startsWith('notebook-detail-widget-') && widget.notebook) {
      // notebook detail tab
      const nb = widget.notebook;
      // 保证左侧只保留 flowChartWidget
      const leftWidgets = Array.from(app.shell.widgets('left'));
      for (const w of leftWidgets) {
        if (w !== flowChartWidget && w.id === 'flow-chart-widget') w.close();
      }
      flowChartWidget?.setData([nb], colorMap);
      if (flowChartWidget) {
        app.shell.add(flowChartWidget, 'left');
        app.shell.activateById(flowChartWidget.id);
      }
      detailSidebar?.setNotebookDetail(nb);
      if (detailSidebar) {
        app.shell.add(detailSidebar, 'right');
        app.shell.activateById(detailSidebar.id);
      }
      console.log('[tab switch] notebook detail:', nb);
      return;
    }
    if (tabId === 'matrix-widget') {
      // overview tab
      // 保证左侧只保留 flowChartWidget
      const leftWidgets = Array.from(app.shell.widgets('left'));
      for (const w of leftWidgets) {
        if (w !== flowChartWidget && w.id === 'flow-chart-widget') w.close();
      }
      flowChartWidget?.setData(result1, colorMap);
      if (flowChartWidget) {
        app.shell.add(flowChartWidget, 'left');
        app.shell.activateById(flowChartWidget.id);
      }
      if (flowChartWidget && matrixWidget && result1 && detailSidebar) {
        const { mostFreqStage, mostFreqFlow } = flowChartWidget.getMostFrequentStageAndFlow();
        detailSidebar.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget?.getNotebookOrder?.());
        app.shell.add(detailSidebar, 'right');
        app.shell.activateById(detailSidebar.id);
      }
      console.log('[tab switch] matrix overview');
      return;
    }
    // 其它 tab 不更新 sidebar
    closeSidebarsIfNoMainWidgets(app);
    console.log('[tab switch] no flowchart action for tab:', tabId);
  }

  // ====== closeSidebarsIfNoMainWidgets 也放到 activate 内部，能访问 handleTabSwitch ======
  function closeSidebarsIfNoMainWidgets(app: JupyterFrontEnd) {
    const mainWidgets = Array.from(app.shell.widgets('main'));
    const hasMatrix = mainWidgets.some(w => w.id === 'matrix-widget');
    const hasDetail = mainWidgets.some(w => w.id && w.id.startsWith('notebook-detail-widget-'));
    if (!hasMatrix && !hasDetail) {
      // 没有 galaxy 相关 tab，关闭 sidebar
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

  // 恢复：获取主区域第一个 galaxy 相关 widget（优先 notebook-detail-widget，其次 matrix-widget）
  function getActiveGalaxyWidget() {
    const mainWidgets = Array.from(app.shell.widgets('main'));
    let widget = mainWidgets.find(w => w.id && w.id.startsWith('notebook-detail-widget-'));
    if (!widget) {
      widget = mainWidgets.find(w => w.id && w.id === 'matrix-widget');
    }
    return widget || null;
  }

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
          if (w.id === 'matrix-widget' || (w.id && w.id.startsWith('notebook-detail-widget-'))) w.close();
        }
        const oldRight = app.shell.widgets('right');
        for (const w of oldRight) {
          if (w.id === 'galaxy-detail-sidebar') w.close();
        }
        
        // 清理 notebook detail IDs 记录
        notebookDetailIds.clear();
        lastKnownDetailIds.clear();

        // 判断是否只选中了一个 .json 文件
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
            const csvModel = await contentsManager.get('test-notebooks/18599_emb_clustered.csv', { type: 'file', format: 'text', content: true });
            similarityGroups = csvParse(csvModel.content as string);
            // 转换 similarity 为数字
            similarityGroups.forEach((d: any) => { d.similarity = +d.similarity; });
            console.log('Loaded CSV:', similarityGroups);
          } catch (e) {
            alert('无法读取 18599_emb_clustered.csv');
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
          similarityGroups = [];
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
          similarityGroups = [];
        }

        // 统一颜色映射
        const allStages = new Set<string>();
        result1.forEach((nb: any) => {
          nb.cells.forEach((cell: any) => {
            if ((cell.cellType + '').toLowerCase() === 'code') {
              const stage = String(cell["1st-level label"] ?? "None");
              allStages.add(stage);
            }
          });
        });
        initColorMap(allStages);
        colorMap = colorMapModule; // 确保 colorMap 全局可用
        flowChartWidget = new LeftSidebar(result1, colorMap);
        app.shell.add(flowChartWidget, 'left');
        if (typeof (app.shell as any).expandLeftArea === 'function') {
          (app.shell as any).expandLeftArea();
        }
        app.shell.activateById(flowChartWidget.id);
        console.log('LeftSidebar added, expanded, and activated');
        // 保存原始 sidebar 和数据，便于 notebook 详情切换回来
        // let originalLeftSidebar = flowChartWidget;

        // 添加 MatrixWidget 到主区域
        const colorScale = (label: string) => colorMapModule.get(label) || '#fff';
        matrixWidget = new MatrixWidget(result1, colorScale, similarityGroups);
        app.shell.add(matrixWidget, 'main');
        matrixWidget.disposed.connect(() => {
          closeSidebarsIfNoMainWidgets(app);
        });
        const notebookOrder = matrixWidget.getNotebookOrder();
        const detailSidebarInstance = new DetailSidebar(colorMapModule, notebookOrder);
        detailSidebar = detailSidebarInstance;
        const { mostFreqStage: mfs, mostFreqFlow: mff } = flowChartWidget.getMostFrequentStageAndFlow();
        mostFreqStage = mfs;
        mostFreqFlow = mff;
        detailSidebar.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget.getNotebookOrder());
        app.shell.add(detailSidebar, 'right');
        if (typeof (app.shell as any).expandRightArea === 'function') {
          (app.shell as any).expandRightArea();
        }
        app.shell.activateById(detailSidebar.id);
        console.log('DetailSidebar added, expanded, and activated');
        // 监听 notebook 排序变化，实时同步 sidebar
        window.addEventListener('galaxy-notebook-order-changed', (e: any) => {
          detailSidebar?.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget?.getNotebookOrder?.());
        });

        // 统一管理 flowchart/matrix/detail 的筛选联动
        let currentSelection: any = null;
        window.addEventListener('galaxy-stage-selected', (e: any) => {
          currentSelection = { type: 'stage', stage: e.detail.stage };
          matrixWidget?.setFilter(currentSelection);
          detailSidebar?.setFilter(currentSelection);
        });
        window.addEventListener('galaxy-flow-selected', (e: any) => {
          currentSelection = { type: 'flow', from: e.detail.from, to: e.detail.to };
          matrixWidget?.setFilter(currentSelection);
          detailSidebar?.setFilter(currentSelection);
        });
        window.addEventListener('galaxy-selection-cleared', () => {
          currentSelection = null;
          matrixWidget?.setFilter(null);
          detailSidebar?.setFilter(null);
        });

        // 只注册一次 notebook 详情切换监听器
        if (!notebookSelectedListenerRegistered) {
          handleNotebookSelected = function (e: any) {
            // 新建并显示 notebook 详情，深拷贝 notebook 数据
            const nb = JSON.parse(JSON.stringify(e.detail.notebook));
            if (nb && nb.kernelVersionId) {
              notebookCache.set(String(nb.kernelVersionId), nb);
            }
            const nbDetailWidget = new NotebookDetailWidget(nb);
            nbDetailWidget.id = `notebook-detail-widget-${nb.kernelVersionId || nb.index || Date.now()}`;
            app.shell.add(nbDetailWidget, 'main');
            app.shell.activateById(nbDetailWidget.id);
            notebookDetailIds.add(nbDetailWidget.id);
            nbDetailWidget.disposed.connect(() => {
              console.log('[galaxy] notebook detail widget disposed:', nbDetailWidget.id);
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
            detailSidebar?.setNotebookDetail(nb);

            // 只关闭左侧 flow-chart-widget（overview），不关闭 matrix-widget
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
              app.shell.add(flowChartWidget!, 'left');
              app.shell.activateById(flowChartWidget!.id);
              // matrix-widget 保持不变
              // 恢复 summary 视图
              detailSidebar?.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget?.getNotebookOrder?.());
              window.removeEventListener('galaxy-notebook-detail-back', handleBack);
            };
            window.addEventListener('galaxy-notebook-detail-back', handleBack);
          };
          window.addEventListener('galaxy-notebook-selected', handleNotebookSelected!);
          notebookSelectedListenerRegistered = true;
        }
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

    // 检查 notebook detail tab 是否被关闭，并在每次关闭时恢复 overview sidebar
    function checkNotebookDetailWidgetStatus() {
      const mainWidgets = Array.from(app.shell.widgets('main'));
      const currentDetailIds = new Set(
        mainWidgets
          .filter(w => w.id?.startsWith('notebook-detail-widget-'))
          .map(w => w.id!)
      );

      // 检测是否发生变化
      const prevSize = lastKnownDetailIds.size;
      const currSize = currentDetailIds.size;
      const hasChange =
        prevSize !== currSize ||
        [...lastKnownDetailIds].some(id => !currentDetailIds.has(id)) ||
        [...currentDetailIds].some(id => !lastKnownDetailIds.has(id));

      if (!hasChange) {
        return; // 没变化，不处理
      }

      lastKnownDetailIds = currentDetailIds;

      // 检查是否有 detail tab 被关闭，如果有则恢复 overview sidebar
      for (const oldId of notebookDetailIds) {
        if (!currentDetailIds.has(oldId)) {
          console.log('[galaxy] Notebook detail widget no longer in main:', oldId);
          // 当 notebook detail widget 被关闭时，立即恢复 overview sidebar
          if (result1 && matrixWidget && detailSidebar) {
            console.log('✅ Detected detail tab closed. Restoring overview sidebar.');
            
            // 先清理现有的左侧 sidebar
            const leftWidgets = Array.from(app.shell.widgets('left'));
            for (const w of leftWidgets) {
              if (w.id === 'flow-chart-widget') w.close();
            }
            
            // 重新创建或恢复 flowChartWidget
            if (!flowChartWidget || flowChartWidget.isDisposed) {
              flowChartWidget = new LeftSidebar(result1, colorMap);
            } else {
              flowChartWidget.setData(result1, colorMap);
            }
            
            app.shell.add(flowChartWidget, 'left');
            app.shell.activateById(flowChartWidget.id);
            
            const { mostFreqStage, mostFreqFlow } = flowChartWidget.getMostFrequentStageAndFlow();
            detailSidebar.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget.getNotebookOrder());
            app.shell.add(detailSidebar, 'right');
            app.shell.activateById(detailSidebar.id);
          }
        }
      }

      // 更新记录
      notebookDetailIds.clear();
      for (const id of currentDetailIds) {
        notebookDetailIds.add(id);
      }
    }
    // 只在 layoutModified 里检测，不在 currentChanged/activeChanged 里检测
    app.shell.layoutModified.connect(() => {
      checkNotebookDetailWidgetStatus();
    });
    // 用 MutationObserver 动态绑定 tab click delegate，保证 MyBinder/JupyterLab 任何时机都能绑定
    function bindTabClickDelegates() {
      document.querySelectorAll('.lm-TabBar-content').forEach(tabBar => {
        if (!(tabBar as any).__galaxyClickBound) {
          tabBar.addEventListener('click', (e) => {
            let target = e.target as HTMLElement;
            while (target && !target.classList.contains('lm-TabBar-tab') && target !== tabBar) {
              target = target.parentElement as HTMLElement;
            }
            if (target && target.classList.contains('lm-TabBar-tab')) {
              const dataId = target.getAttribute('data-id');
              console.log('[tab click-delegate] data-id:', dataId);
              // 通过 data-id 找到 widget
              const allWidgets = [
                ...Array.from(app.shell.widgets('main')),
                ...Array.from(app.shell.widgets('left')),
                ...Array.from(app.shell.widgets('right'))
              ];
              const widget = allWidgets.find(w => w.id === dataId);
              if (widget) {
                handleTabSwitch(widget);
              }
            }
          });
          (tabBar as any).__galaxyClickBound = true;
        }
      });
    }
    const observer = new MutationObserver(bindTabClickDelegates);
    observer.observe(document.body, { childList: true, subtree: true });
    bindTabClickDelegates(); // 初始绑定

    // 监听 tab 关闭按钮，打印 notebook detail tab 被关闭的日志
    function bindTabCloseDelegates() {
      document.querySelectorAll('.lm-TabBar-content').forEach(tabBar => {
        if (!(tabBar as any).__galaxyCloseBound) {
          tabBar.addEventListener('mousedown', (e) => {
            console.log('[galaxy] mousedown event:', e.target, (e.target as HTMLElement)?.outerHTML);
          });
          tabBar.addEventListener('click', (e) => {
            console.log('[galaxy] click event:', e.target, (e.target as HTMLElement)?.outerHTML);
          });
          (tabBar as any).__galaxyCloseBound = true;
        }
      });
    }
    bindTabCloseDelegates();
    const closeObserver = new MutationObserver(bindTabCloseDelegates);
    closeObserver.observe(document.body, { childList: true, subtree: true });

    // 监听 main 区域 widget 的 disposed 事件，主要用于日志记录
    function monitorMainWidgetDisposed() {
      const mainWidgets = Array.from(app.shell.widgets('main'));
      for (const w of mainWidgets) {
        if (!(w as any).__galaxyDisposedBound) {
          w.disposed.connect(() => {
            if (w.id && w.id.startsWith('notebook-detail-widget-')) {
              console.log('[galaxy] notebook detail widget disposed:', w.id);
            } else {
              console.log('[galaxy] main widget disposed:', w.id);
              setTimeout(() => {
                const widget = getActiveGalaxyWidget();
                handleTabSwitch(widget);
              }, 0);
            }
          });
          (w as any).__galaxyDisposedBound = true;
        }
      }
    }
    // 初始绑定
    monitorMainWidgetDisposed();
    // 每次 tab 切换后重新绑定（因为新 widget 可能被添加）
    app.shell.currentChanged.connect(() => {
      setTimeout(() => {
        monitorMainWidgetDisposed();
      }, 0);
    });
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