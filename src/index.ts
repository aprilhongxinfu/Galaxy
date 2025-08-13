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


import { runIcon } from '@jupyterlab/ui-components';
import { colorMap as colorMapModule, initColorMap } from './components/colorMap';
import { MatrixWidget } from './components/MatrixWidget';
import { DetailSidebar } from './components/DetailSidebar';
import { NotebookDetailWidget } from './components/NotebookDetailWidget';
import { LabShell } from '@jupyterlab/application';
import { csvParse } from 'd3-dsv';



// 从JSON文件名中提取competition编号
function extractCompetitionId(jsonPath: string): string | null {
  const match = jsonPath.match(/(\d+)_(predicted|reassigned)\.json$/);
  return match ? match[1] : null;
}

// 从JSON文件路径中提取基础目录
function extractBaseDir(jsonPath: string): string | null {
  // 移除文件名，获取目录路径
  const lastSlashIndex = jsonPath.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    return null; // 没有目录分隔符，说明是根目录
  }
  return jsonPath.substring(0, lastSlashIndex);
}

// 加载TOC数据
async function loadTocData(competitionId: string, baseDir: string): Promise<any[]> {
  try {
    if (!baseDir) {
      console.log('No base directory provided for TOC data loading');
      return [];
    }

    const tocPath = `${baseDir}/toc_data/${competitionId}_toc.json`;
    console.log('TOC path:', tocPath);

    // 尝试不同的路径格式
    const alternativePaths = [
      tocPath,
      `./${baseDir}/toc_data/${competitionId}_toc.json`,
      `/${baseDir}/toc_data/${competitionId}_toc.json`,
      `${baseDir}/toc_data/${competitionId}_toc.json`
    ];
    const contentsManager = app?.serviceManager?.contents;

    if (!contentsManager) {
      console.warn('Contents manager not available for TOC loading');
      return [];
    }

    console.log(`Loading TOC data from: ${tocPath}`);
    console.log('Available contents manager:', !!contentsManager);

    // 尝试多个路径格式
    for (const path of alternativePaths) {
      try {
        console.log(`Trying path: ${path}`);
        const model = await contentsManager.get(path, { type: 'file', format: 'text', content: true });
        // console.log('File loaded successfully, content length:', (model.content as string).length);

        const tocData = JSON.parse(model.content as string);
        // console.log(`TOC data loaded successfully for competition ${competitionId}, entries: ${tocData.length}`);
        // console.log('First few TOC entries:', tocData.slice(0, 3));
        return tocData;
      } catch (fileError) {
        console.log(`Failed to load from ${path}:`, (fileError as Error).message);
        continue;
      }
    }

    console.log('TOC data file not found for competition:', competitionId);
    return [];
  } catch (error) {
    console.log(`TOC data file not found for competition ${competitionId}: ${baseDir}/toc_data/${competitionId}_toc.json`);
    return [];
  }
}

// 将TOC数据合并到notebook数据中
function mergeTocData(notebooks: any[], tocData: any[]): any[] {
  const tocMap = new Map();
  tocData.forEach(item => {
    tocMap.set(item.kernelVersionId, item.toc);
  });

  // console.log('TOC data sample:', tocData.slice(0, 3));
  // console.log('Notebooks sample:', notebooks.slice(0, 3).map(nb => ({
  //   kernelVersionId: nb.kernelVersionId,
  //   index: nb.index,
  //   globalIndex: nb.globalIndex,
  //   notebook_name: nb.notebook_name
  // })));

  return notebooks.map(notebook => {
    const toc = tocMap.get(notebook.kernelVersionId);
    if (toc) {
      // console.log(`Found TOC for notebook ${notebook.kernelVersionId}:`, toc.length, 'items');
      return { ...notebook, toc };
    } else {
      console.log(`No TOC found for notebook ${notebook.kernelVersionId}`);
    }
    return notebook;
  });
}

// 创建KernelVersionId到Title的映射
async function createKernelTitleMap(competitionId: string, baseDir: string): Promise<Map<string, { title: string; creationDate: string; totalLines: number }>> {
  try {
    if (!baseDir) {
      console.log('No base directory provided for kernel data loading');
      return new Map();
    }

    // 动态加载CSV文件
    const csvPath = `${baseDir}/kernel_data/competition_${competitionId}.csv`;
    const contentsManager = app?.serviceManager?.contents;

    if (!contentsManager) {
      console.warn('Contents manager not available');
      return new Map();
    }

    console.log(`Attempting to load CSV from: ${csvPath}`);
    const model = await contentsManager.get(csvPath, { type: 'file', format: 'text', content: true });
    console.log(`CSV loaded successfully, content length: ${(model.content as string).length}`);

    const csvData = csvParse(model.content as string);
    // console.log(`CSV parsed, rows: ${csvData.length}, sample row:`, csvData[0]);

    const titleMap = new Map<string, { title: string; creationDate: string; totalLines: number }>();
    csvData.forEach((row: any) => {
      const kernelVersionId = row.KernelVersionId?.toString();
      const title = row.Title;
      const creationDate = row.CreationDate;
      const totalLines = parseFloat(row.TotalLines) || 0;
      if (kernelVersionId && title) {
        titleMap.set(kernelVersionId, { title, creationDate, totalLines });
      }
    });

    console.log(`Created title map for competition ${competitionId} with ${titleMap.size} entries`);
    // console.log(`Sample entries:`, Array.from(titleMap.entries()).slice(0, 3));
    return titleMap;
  } catch (error) {
    console.log(`Kernel data file not found for competition ${competitionId}: ${baseDir}/kernel_data/competition_${competitionId}.csv`);
    return new Map();
  }
}

// 递归替换对象中的KernelVersionId为Title，并添加CreationDate和TotalLines信息
function replaceKernelVersionIdWithTitle(obj: any, titleMap: Map<string, { title: string; creationDate: string; totalLines: number }>): any {
  if (Array.isArray(obj)) {
    return obj.map(item => replaceKernelVersionIdWithTitle(item, titleMap));
  } else if (obj && typeof obj === 'object') {
    const newObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'kernelVersionId' && typeof value === 'string') {
        const titleInfo = titleMap.get(value);
        if (titleInfo) {
          newObj.notebook_name = titleInfo.title; // 替换为notebook_name字段
          newObj.kernelVersionId = value; // 保留kernelVersionId用于相似性分组匹配
          newObj.creationDate = titleInfo.creationDate; // 添加创建日期
          newObj.totalLines = titleInfo.totalLines; // 添加总行数
        } else {
          newObj.kernelVersionId = value; // 保持原值如果找不到对应的title
        }
      } else {
        newObj[key] = replaceKernelVersionIdWithTitle(value, titleMap);
      }
    }
    return newObj;
  }
  return obj;
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

let notebookDetailIds = new Set<string>();
let colorMap: any = null;

// 添加滚动同步相关的全局变量
let scrollSyncEnabled = false;
let scrollSyncWidgets: Set<string> = new Set();
let scrollSyncHandlers: Map<string, (e: Event) => void> = new Map();
let scrollSyncUpdatePending = false; // 防止频繁更新
let lastScrollSyncState = { hasMultiple: false }; // 记录上次状态
let lockedWidgets: Set<string> = new Set(); // 记录被锁定的widget

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


  // ====== 检测主区域是否有分屏布局（包括任何类型的widget） ======
  function hasSplitLayout(): boolean {
    try {
      // 解决方案: 使用 app.shell 的内部 layout 判断是否分屏
      const layout = (app.shell as any).saveLayout();
      const mainArea = layout.mainArea;

      // 添加调试信息
      // console.log('Layout structure:', layout);
      // console.log('Main area:', mainArea);

      // 递归检查是否分屏
      function isSplitScreen(area: any): boolean {
        if (!area) return false;

        // console.log('Checking area:', area);

        // 检查是否有 dock.main 结构
        if (area.dock && area.dock.main) {
          // console.log('Found dock.main, checking:', area.dock.main);
          return isSplitScreen(area.dock.main);
        }

        if (area.type === 'split-area') {
          // 并行多个子区域（不是单个 tab-area）
          if (area.children && area.children.length > 1) {
            // console.log('Found split-area with multiple children:', area.children.length);
            return true;
          }
        }

        // 递归继续判断嵌套结构
        if (area.children) {
          return area.children.some((child: any) => isSplitScreen(child));
        }

        // 如果是 tab-area, 不代表分屏
        if (area.type === 'tab-area') {
          // console.log('Found tab-area:', area);
          return false;
        }

        return false;
      }

      const split = isSplitScreen(mainArea);
      // console.log('当前是否分屏:', split);

      return split;
    } catch (error) {
      console.error('检测分屏布局时出错:', error);

      // 降级到之前的DOM检测方法
      const mainWidgets = Array.from(app.shell.widgets('main'));
      const parents = new Set(mainWidgets.map(w => w.parent?.id));

      const mainArea = document.querySelector('.lm-MainArea-widget');
      let hasVisualSplit = false;

      if (mainArea) {
        const splitPanels = mainArea.querySelectorAll('.lm-SplitPanel');
        hasVisualSplit = splitPanels.length > 0;

        const tabBars = mainArea.querySelectorAll('.lm-TabBar');
        const hasMultipleTabBars = tabBars.length > 1;

        const activeTabs = mainArea.querySelectorAll('.lm-TabBar-tab.lm-mod-current');
        const hasMultipleActiveTabs = activeTabs.length > 1;

        const mainAreaChildren = mainArea.children;
        const hasMultipleChildren = mainAreaChildren.length > 1;

        console.log('[hasSplitLayout fallback]', {
          mainWidgetCount: mainWidgets.length,
          parentCount: parents.size,
          hasVisualSplit,
          hasMultipleTabBars,
          hasMultipleActiveTabs,
          hasMultipleChildren
        });

        if (hasVisualSplit || hasMultipleTabBars || hasMultipleActiveTabs || hasMultipleChildren || parents.size > 1) {
          return true;
        }
      }

      return false;
    }
  }

  // ====== 检测是否有多个notebook detail widget（排除matrix widget） ======
  function hasMultipleNotebookDetailWidgets(): boolean {
    const mainWidgets = Array.from(app.shell.widgets('main'));
    const notebookDetailWidgets = mainWidgets.filter(w =>
      w.id && w.id.startsWith('notebook-detail-widget-')
    );

    // 调试输出
    // console.log('[Widget Debug] All main widgets:', mainWidgets.map(w => w.id));
    // console.log('[Widget Debug] Notebook detail widgets:', notebookDetailWidgets.map(w => w.id));
    // console.log('[Widget Debug] Count:', notebookDetailWidgets.length);

    return notebookDetailWidgets.length > 1;
  }

  // ====== 检测是否需要滚动同步（有多个notebook detail widget在分屏中） ======
  function shouldEnableScrollSync(): boolean {
    const hasMultipleNotebookDetails = hasMultipleNotebookDetailWidgets();

    // 如果有多个notebook detail widget，就启用滚动同步
    // 不需要检测整体分屏，因为matrix的存在不影响notebook detail之间的同步
    return hasMultipleNotebookDetails;
  }

  // ====== 设置滚动同步 ======
  function setupScrollSync() {
    // 清除之前的滚动同步
    scrollSyncHandlers.forEach((handler, widgetId) => {
      const widgets = Array.from(app.shell.widgets('main'));
      const widget = widgets.find(w => w.id === widgetId);
      if (widget) {
        const cellList = widget.node.querySelector('#nbd-cell-list-scroll');
        if (cellList) {
          cellList.removeEventListener('scroll', handler);
        }
      }
    });
    scrollSyncHandlers.clear();

    // 检查是否需要启用滚动同步
    const shouldEnable = shouldEnableScrollSync();

    // 只在状态真正改变时才输出日志
    const currentState = { hasMultiple: hasMultipleNotebookDetailWidgets() };
    const stateChanged = currentState.hasMultiple !== lastScrollSyncState.hasMultiple;

    // 调试输出
    // console.log('[Scroll Sync Debug] Multiple notebook details:', currentState.hasMultiple, 'Should enable:', shouldEnable);
    if (stateChanged) {
      console.log('[Scroll Sync] Multiple notebook details:', currentState.hasMultiple, 'Should enable:', shouldEnable);
      lastScrollSyncState = currentState;
    }

    if (shouldEnable) {
      // 启用滚动同步
      scrollSyncEnabled = true;
      scrollSyncWidgets.clear();

      // 收集所有notebook detail widget
      const mainWidgets = Array.from(app.shell.widgets('main'));
      mainWidgets.forEach(widget => {
        if (widget.id && widget.id.startsWith('notebook-detail-widget-')) {
          scrollSyncWidgets.add(widget.id);
        }
      });

      // 只在状态真正改变时才输出日志
      if (stateChanged) {
        console.log('[Scroll Sync] Enabled for widgets:', Array.from(scrollSyncWidgets));
        console.log('[Scroll Sync] Widget count:', scrollSyncWidgets.size);
      }

      // 为每个widget的滚动容器绑定事件监听器
      scrollSyncWidgets.forEach(widgetId => {
        const widgets = Array.from(app.shell.widgets('main'));
        const widget = widgets.find(w => w.id === widgetId);
        if (widget) {
          const cellList = widget.node.querySelector('#nbd-cell-list-scroll');
          if (cellList) {
            // 移除之前的事件监听器（如果存在）
            const existingHandler = scrollSyncHandlers.get(widgetId);
            if (existingHandler) {
              cellList.removeEventListener('scroll', existingHandler);
            }

            // 创建滚动同步处理器
            const scrollHandler = (e: Event) => {
              if (!scrollSyncEnabled) return;

              const target = e.target as HTMLElement;
              const scrollTop = target.scrollTop;
              const scrollHeight = target.scrollHeight;
              const clientHeight = target.clientHeight;
              const sourceWidgetId = widgetId;

              // 如果源widget被锁定，不进行同步
              if (lockedWidgets.has(sourceWidgetId)) {
                return;
              }

              // 计算滚动百分比
              const maxScrollTop = scrollHeight - clientHeight;
              const scrollPercentage = maxScrollTop > 0 ? scrollTop / maxScrollTop : 0;

              // 只在调试模式下输出滚动日志
              // console.log('[Scroll Sync] Widget', sourceWidgetId, 'scrolled to:', scrollTop, 'percentage:', scrollPercentage);

              // 临时禁用滚动同步，避免循环触发
              scrollSyncEnabled = false;

              // 同步其他widget的滚动位置（跳过被锁定的widget）
              scrollSyncWidgets.forEach(otherWidgetId => {
                if (otherWidgetId !== sourceWidgetId && !lockedWidgets.has(otherWidgetId)) {
                  const otherWidgets = Array.from(app.shell.widgets('main'));
                  const otherWidget = otherWidgets.find(w => w.id === otherWidgetId);
                  if (otherWidget) {
                    const otherCellList = otherWidget.node.querySelector('#nbd-cell-list-scroll');
                    if (otherCellList) {
                      const otherScrollHeight = otherCellList.scrollHeight;
                      const otherClientHeight = otherCellList.clientHeight;
                      const otherMaxScrollTop = otherScrollHeight - otherClientHeight;

                      // 根据百分比计算目标滚动位置
                      const targetScrollTop = otherMaxScrollTop > 0 ? scrollPercentage * otherMaxScrollTop : 0;

                      // 只有当目标位置与当前位置不同时才设置
                      if (Math.abs(otherCellList.scrollTop - targetScrollTop) > 1) {
                        // console.log('[Scroll Sync] Syncing widget', otherWidgetId, 'to percentage:', scrollPercentage, 'position:', targetScrollTop);
                        otherCellList.scrollTop = targetScrollTop;
                      }
                    }
                  }
                }
              });

              // 恢复滚动同步
              scrollSyncEnabled = true;
            };

            // 绑定事件监听器
            cellList.addEventListener('scroll', scrollHandler);
            scrollSyncHandlers.set(widgetId, scrollHandler);

            // 添加调试信息
            if (stateChanged) {
              console.log('[Scroll Sync] Bound scroll handler for widget:', widgetId);
            }
          } else {
            console.warn('[Scroll Sync] No cell list found for widget:', widgetId);
          }
        } else {
          console.warn('[Scroll Sync] Widget not found:', widgetId);
        }
      });

    } else {
      // 禁用滚动同步
      scrollSyncEnabled = false;

      // 移除所有widget的滚动事件监听器
      const mainWidgets = Array.from(app.shell.widgets('main'));
      mainWidgets.forEach(widget => {
        if (widget.id && widget.id.startsWith('notebook-detail-widget-')) {
          const cellList = widget.node.querySelector('#nbd-cell-list-scroll');
          if (cellList) {
            const handler = scrollSyncHandlers.get(widget.id);
            if (handler) {
              cellList.removeEventListener('scroll', handler);
            }
          }
        }
      });

      scrollSyncWidgets.clear();
      scrollSyncHandlers.clear();
      // 只在状态真正改变时才输出日志
      if (stateChanged) {
        console.log('[Scroll Sync] Disabled');
      }
    }
  }

  // ====== 更新滚动同步状态 ======
  function updateScrollSync() {
    if (scrollSyncUpdatePending) return;
    scrollSyncUpdatePending = true;

    // 使用 requestAnimationFrame 确保在下一帧执行，避免频繁调用
    requestAnimationFrame(() => {
      setupScrollSync();
      scrollSyncUpdatePending = false;
    });
  }

  // ====== handleTabSwitch 放回 activate 内部，直接访问最新 sidebar 变量 ======
  function handleTabSwitch(widget: any) {
    // 新增：如果 widget 为空或不是 galaxy 相关 tab，检查是否需要关闭 sidebar
    if (!widget || !(widget.id && (widget.id === 'matrix-widget' || widget.id.startsWith('notebook-detail-widget-')))) {
      // 只有在没有galaxy分析数据时才关闭sidebar
      if (!result1 || result1.length === 0) {
        closeSidebarsIfNoMainWidgets(app);
      }
      return;
    }
    const tabId = widget.id || '';

    // 检查是否有分屏布局
    if (hasSplitLayout()) {
      // console.log('[tab switch] Split layout detected, collapsing sidebars');
      // 收缩左右sidebar而不是关闭
      if (typeof (app.shell as any).collapseLeft === 'function') {
        (app.shell as any).collapseLeft();
      }
      if (typeof (app.shell as any).collapseRight === 'function') {
        (app.shell as any).collapseRight();
      }
      // 在分屏布局下也需要更新滚动同步
      setTimeout(() => updateScrollSync(), 100);
      return;
    }

    if (tabId.startsWith('notebook-detail-widget-') && widget.notebook) {
      // notebook detail tab
      // 确保notebook detail widget可见并激活
      ensureWidgetVisibleAndActive(widget);

      const nb = widget.notebook;
      // 确保 colorMap 包含该 notebook 中的所有 stage
      const singleNotebookStages = new Set<string>();
      nb.cells.forEach((cell: any) => {
        if ((cell.cellType + '').toLowerCase() === 'code') {
          const stage = String(cell["1st-level label"] ?? "None");
          singleNotebookStages.add(stage);
        }
      });
      initColorMap(singleNotebookStages);
      // 保证左侧只保留 flowChartWidget
      const leftWidgets = Array.from(app.shell.widgets('left'));
      for (const w of leftWidgets) {
        if (w !== flowChartWidget && w.id === 'flow-chart-widget') w.close();
      }
      flowChartWidget?.setData([nb], colorMapModule);
      if (flowChartWidget) {
        app.shell.add(flowChartWidget, 'left');
        app.shell.activateById(flowChartWidget.id);
      }
      detailSidebar?.setNotebookDetail(nb, true); // 跳过事件派发，避免循环
      if (detailSidebar) {
        app.shell.add(detailSidebar, 'right');
        app.shell.activateById(detailSidebar.id);
      }
      return;
    }
    if (tabId === 'matrix-widget') {
      // overview tab
      // 确保matrix widget可见并激活
      ensureWidgetVisibleAndActive(matrixWidget);

      // 确保 colorMap 包含所有 stage
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
      // 保证左侧只保留 flowChartWidget
      const leftWidgets = Array.from(app.shell.widgets('left'));
      for (const w of leftWidgets) {
        if (w !== flowChartWidget && w.id === 'flow-chart-widget') w.close();
      }
      flowChartWidget?.setData(result1, colorMapModule);
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
      return;
    }
    // 其它 tab 不更新 sidebar，但也不关闭sidebar
    // console.log('[tab switch] no flowchart action for tab:', tabId);
  }

  // ====== closeSidebarsIfNoMainWidgets 也放到 activate 内部，能访问 handleTabSwitch ======
  function closeSidebarsIfNoMainWidgets(app: JupyterFrontEnd) {
    const mainWidgets = Array.from(app.shell.widgets('main'));
    const hasMatrix = mainWidgets.some(w => w.id === 'matrix-widget');
    const hasDetail = mainWidgets.some(w => w.id && w.id.startsWith('notebook-detail-widget-'));

    // 检查是否有分屏布局
    if (hasSplitLayout()) {
      // console.log('[closeSidebarsIfNoMainWidgets] Split layout detected, collapsing sidebars');
      // 收缩左右sidebar而不是关闭
      if (typeof (app.shell as any).collapseLeft === 'function') {
        (app.shell as any).collapseLeft();
      }
      if (typeof (app.shell as any).collapseRight === 'function') {
        (app.shell as any).collapseRight();
      }
      return;
    }

    // 只有当确实没有galaxy相关tab，且用户主动切换到其他应用时才关闭sidebar
    if (!hasMatrix && !hasDetail) {
      // 检查是否有其他galaxy相关的widget（比如正在分析中）
      const hasGalaxyAnalysis = result1 && result1.length > 0;

      if (!hasGalaxyAnalysis) {
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
  }

  // 辅助函数：确保widget可见并激活
  function ensureWidgetVisibleAndActive(widget: any) {
    if (!widget) return false;

    // 如果widget不可见，尝试激活它
    if (!widget.isVisible) {
      app.shell.activateById(widget.id);
    }

    return widget.isVisible;
  }

  // 恢复：获取主区域第一个 galaxy 相关 widget（优先 notebook-detail-widget，其次 matrix-widget）
  function getActiveGalaxyWidget() {
    const mainWidgets = Array.from(app.shell.widgets('main'));

    // 首先检查可见的galaxy widget
    const visibleGalaxyWidgets = mainWidgets.filter(w =>
      w.isVisible && (
        (w.id && w.id.startsWith('notebook-detail-widget-')) ||
        (w.id && w.id === 'matrix-widget')
      )
    );

    // 如果有可见的galaxy widget，优先使用第一个
    if (visibleGalaxyWidgets.length > 0) {
      return visibleGalaxyWidgets[0];
    }

    // 如果没有可见的，按原来的逻辑查找
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

        // 检查是否选中了JSON文件
        if (
          selectedItems.length === 1 &&
          selectedItems[0].type === 'file' &&
          selectedItems[0].path.endsWith('.json')
        ) {
          // 直接用 Contents API 读取 JSON 文件内容
          const contentsManager = app.serviceManager.contents;
          const model = await contentsManager.get(selectedItems[0].path, { type: 'file', format: 'text', content: true });
          result1 = JSON.parse(model.content as string);
          // console.log('Loaded JSON:', result1);

          // 提取competition ID和基础目录
          console.log('Extracting competition ID from path:', selectedItems[0].path);
          const competitionId = extractCompetitionId(selectedItems[0].path);
          const baseDir = extractBaseDir(selectedItems[0].path);
          console.log('Extracted competition ID:', competitionId);
          console.log('Extracted base directory:', baseDir);
          
          if (competitionId && baseDir) {
            try {
              const titleMap = await createKernelTitleMap(competitionId, baseDir);
              result1 = replaceKernelVersionIdWithTitle(result1, titleMap);
              console.log('Applied title mapping for competition:', competitionId);
            } catch (e) {
              console.log(`无法加载kernel数据: competition_${competitionId}.csv`);
            }

                          // 加载并合并TOC数据（如果存在）
              if (baseDir) {
                try {
                  const tocData = await loadTocData(competitionId, baseDir);
                  result1 = mergeTocData(result1, tocData);
                  console.log('Applied TOC data for competition:', competitionId);
                } catch (e) {
                  console.log(`TOC数据不存在，跳过: ${competitionId}_toc.json`);
                }
              } else {
                console.log('No base directory available for TOC data loading');
              }
          } else {
            console.log('No competition ID extracted from path');
          }

          // 读取对应的 CSV 文件（如果存在）
          if (competitionId && baseDir) {
            try {
              const csvPath = `${baseDir}/cluster_data/${competitionId}_clustered.csv`;
              const csvModel = await contentsManager.get(csvPath, { type: 'file', format: 'text', content: true });
              similarityGroups = csvParse(csvModel.content as string);
              console.log(`成功加载聚类数据: ${competitionId}_clustered.csv`);
            } catch (e) {
              console.log(`聚类文件不存在，跳过: ${competitionId}_clustered.csv`);
              similarityGroups = [];
            }
          } else {
            similarityGroups = [];
          }

        } else {
          // 只支持JSON文件分析
          console.warn('⚠️ Please select a single JSON file for analysis');
          return;
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

        // 创建kernelTitleMap用于MatrixWidget
        let kernelTitleMap = new Map<string, { title: string; creationDate: string; totalLines: number }>();

        // 重新获取competitionId和基础目录
        let competitionIdForMatrix: string | null = null;
        let baseDirForMatrix: string | null = null;
        if (selectedItems.length === 1 && selectedItems[0].type === 'file' && selectedItems[0].path.endsWith('.json')) {
          competitionIdForMatrix = extractCompetitionId(selectedItems[0].path);
          baseDirForMatrix = extractBaseDir(selectedItems[0].path);
        }

        if (competitionIdForMatrix && baseDirForMatrix) {
          console.log('Creating kernelTitleMap for MatrixWidget with competitionId:', competitionIdForMatrix);
          kernelTitleMap = await createKernelTitleMap(competitionIdForMatrix, baseDirForMatrix);
          // console.log('Created kernelTitleMap for MatrixWidget:', {
          //   competitionId: competitionIdForMatrix,
          //   mapSize: kernelTitleMap.size,
          //   sampleEntries: Array.from(kernelTitleMap.entries()).slice(0, 3)
          // });
        } else {
          console.log('No competitionId or baseDir found for MatrixWidget');
        }

        matrixWidget = new MatrixWidget(result1, colorScale, similarityGroups, kernelTitleMap);
        app.shell.add(matrixWidget, 'main');
        app.shell.activateById(matrixWidget.id);
        matrixWidget.disposed.connect(() => {
          closeSidebarsIfNoMainWidgets(app);
        });
        const notebookOrder = matrixWidget.getNotebookOrder();
        const detailSidebarInstance = new DetailSidebar(colorMapModule, notebookOrder, undefined, similarityGroups);
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
          console.log('[index.ts] Global notebook order changed event:', e.detail?.notebookOrder);
          detailSidebar?.setSummary(result1, mostFreqStage, mostFreqFlow, e.detail?.notebookOrder);
        });

        // 统一管理 flowchart/matrix/detail 的筛选联动（按tab隔离）
        let currentSelection: any = null;
        window.addEventListener('galaxy-stage-selected', (e: any) => {
          const { stage, tabId } = e.detail;
          currentSelection = { type: 'stage', stage, tabId };
          matrixWidget?.setFilter(currentSelection);
          detailSidebar?.setFilter(currentSelection, true); // 跳过事件派发，避免循环
        });
        window.addEventListener('galaxy-flow-selected', (e: any) => {
          const { from, to, tabId } = e.detail;
          currentSelection = { type: 'flow', from, to, tabId };
          matrixWidget?.setFilter(currentSelection);
          detailSidebar?.setFilter(currentSelection, true); // 跳过事件派发，避免循环
        });
        window.addEventListener('galaxy-selection-cleared', (e: any) => {
          // const tabId = e.detail?.tabId;
          currentSelection = null;
          matrixWidget?.setFilter(null);
          detailSidebar?.setFilter(null, true); // 跳过事件派发，避免循环
        });

        // 监听TOC项目点击事件
        window.addEventListener('galaxy-toc-item-clicked', (e: any) => {
          const { cellId } = e.detail;

          // 解析cellId，格式为 "kernelVersionId_cellIndex"
          const [kernelVersionId, cellIndexStr] = cellId.split('_');
          const cellIndex = parseInt(cellIndexStr);

          // 找到对应的notebook
          const notebook = result1.find((nb: any) => nb.kernelVersionId === kernelVersionId);
          if (notebook) {
            // 确保notebook有index属性，如果没有则使用数组索引
            const notebookIndex = notebook.index !== undefined ? notebook.index : result1.indexOf(notebook);

            // 跳转到对应的cell
            window.dispatchEvent(new CustomEvent('galaxy-notebook-detail-jump', {
              detail: {
                notebookIndex: notebookIndex,
                cellIndex: cellIndex
              }
            }));
          } else {
            console.warn('Notebook not found for kernelVersionId:', kernelVersionId);
          }
        });

        // 只注册一次 notebook 详情切换监听器
        if (!notebookSelectedListenerRegistered) {
          handleNotebookSelected = function (e: any) {
            // 新建并显示 notebook 详情，深拷贝 notebook 数据
            const nb = JSON.parse(JSON.stringify(e.detail.notebook));
            const nbDetailWidget = new NotebookDetailWidget(nb);
            nbDetailWidget.id = `notebook-detail-widget-${nb.kernelVersionId || nb.index || Date.now()}`;
            app.shell.add(nbDetailWidget, 'main');
            app.shell.activateById(nbDetailWidget.id);
            notebookDetailIds.add(nbDetailWidget.id);
            nbDetailWidget.disposed.connect(() => {
              console.log('[galaxy] notebook detail widget disposed:', nbDetailWidget.id);
              // 清理滚动同步状态
              updateScrollSync();
            });

            // 延迟更新滚动同步状态，避免频繁调用
            setTimeout(() => updateScrollSync(), 100);

            // 检查是否有分屏布局
            if (hasSplitLayout()) {
              console.log('[handleNotebookSelected] Split layout detected, collapsing sidebars');
              // 收缩左右sidebar而不是关闭
              if (typeof (app.shell as any).collapseLeft === 'function') {
                (app.shell as any).collapseLeft();
              }
              if (typeof (app.shell as any).collapseRight === 'function') {
                (app.shell as any).collapseRight();
              }
              // 在分屏布局下也需要更新滚动同步
              setTimeout(() => updateScrollSync(), 100);
              return; // 不创建sidebar，直接返回
            }

            // 新建只显示该 notebook 的 flowchart
            // 确保 colorMap 包含该 notebook 中的所有 stage
            const singleNotebookStages = new Set<string>();
            nb.cells.forEach((cell: any) => {
              if ((cell.cellType + '').toLowerCase() === 'code') {
                const stage = String(cell["1st-level label"] ?? "None");
                singleNotebookStages.add(stage);
              }
            });
            // 重新初始化 colorMap 以包含该 notebook 的所有 stage
            initColorMap(singleNotebookStages);
            const singleLeftSidebar = new LeftSidebar([nb], colorMapModule);
            app.shell.add(singleLeftSidebar, 'left');
            setTimeout(() => {
              if (typeof (app.shell as any).expandLeftArea === 'function') {
                (app.shell as any).expandLeftArea();
              }
              app.shell.activateById(singleLeftSidebar.id);
              console.log('SingleLeftSidebar expanded and activated (setTimeout)');
            }, 0);

            // 右侧 sidebar 只显示该 notebook 信息，清除之前的filter状态
            detailSidebar?.setFilter(null);
            detailSidebar?.setNotebookDetail(nb, true); // 跳过事件派发，避免循环

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
              // 恢复原始 LeftSidebar，并确保 colorMap 包含所有 stage
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
              flowChartWidget?.setData(result1, colorMapModule);
              app.shell.add(flowChartWidget!, 'left');
              app.shell.activateById(flowChartWidget!.id);
              // matrix-widget 保持不变
              // 恢复 summary 视图，清除filter状态
              detailSidebar?.setFilter(null);
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
      // 移除频繁的滚动同步更新
      // updateScrollSync();
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

          // 打印当前layout信息
          try {
            console.log('[Detail Tab Closed] Current layout after closing detail tab:', oldId);

            // 检测关闭detail tab后切换到了哪个tab
            setTimeout(() => {
              // 获取当前激活的widget
              const currentWidget = app.shell.currentWidget;

              // 检查哪个widget是当前可见的
              const visibleWidgets = Array.from(app.shell.widgets('main')).filter(w => w.isVisible);

              // 检查DOM中的当前激活tab
              const activeTabElement = document.querySelector('.lm-TabBar-tab.lm-mod-current');
              const activeTabId = activeTabElement?.getAttribute('data-id');

              // 分析不一致的情况
              if (currentWidget && visibleWidgets.length > 0 && !visibleWidgets.includes(currentWidget)) {
                console.log('[Detail Tab Closed] ⚠️ Current widget is not in visible widgets list!');
              }

              if (activeTabId && currentWidget && activeTabId !== currentWidget.id) {
                console.log('[Detail Tab Closed] ⚠️ DOM active tab differs from shell.currentWidget!');
              }

            }, 100); // 延迟100ms确保切换完成

          } catch (error) {
            console.error('[Detail Tab Closed] Error getting layout info:', error);
          }

          // 当 notebook detail widget 被关闭时，立即恢复 overview sidebar
          if (result1 && matrixWidget && detailSidebar) {

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
            detailSidebar.setFilter(null);
            detailSidebar.setSummary(result1, mostFreqStage, mostFreqFlow, matrixWidget.getNotebookOrder());
            app.shell.add(detailSidebar, 'right');
            app.shell.activateById(detailSidebar.id);

            // 确保matrix widget可见并激活
            if (matrixWidget && !matrixWidget.isVisible) {
              app.shell.activateById(matrixWidget.id);
            }
          }

          // 更新滚动同步状态
          updateScrollSync();
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
      // 打印layout变化信息
      try {
        console.log('[Layout Modified] Layout structure changed');
      } catch (error) {
        console.error('[Layout Modified] Error getting layout info:', error);
      }

      checkNotebookDetailWidgetStatus();
      // 检查是否有分屏布局
      if (hasSplitLayout()) {
        console.log('[layoutModified] Split layout detected, collapsing sidebars');
        // 收缩左右sidebar而不是关闭
        if (typeof (app.shell as any).collapseLeft === 'function') {
          (app.shell as any).collapseLeft();
        }
        if (typeof (app.shell as any).collapseRight === 'function') {
          (app.shell as any).collapseRight();
        }
      }
      // 在布局变化时更新滚动同步状态
      setTimeout(() => updateScrollSync(), 100);
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
              // console.log('[tab click-delegate] data-id:', dataId);
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
            // console.log('[galaxy] mousedown event:', e.target, (e.target as HTMLElement)?.outerHTML);
          });
          tabBar.addEventListener('click', (e) => {
            // console.log('[galaxy] click event:', e.target, (e.target as HTMLElement)?.outerHTML);
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
            // 打印当前layout信息
            try {
              console.log('[Tab Closed] Current layout after closing tab:', w.id);

              // 检测关闭tab后切换到了哪个tab
              setTimeout(() => {
                // 获取当前激活的widget
                const currentWidget = app.shell.currentWidget;

                // 检查哪个widget是当前可见的
                const visibleWidgets = Array.from(app.shell.widgets('main')).filter(w => w.isVisible);

                // 检查DOM中的当前激活tab
                const activeTabElement = document.querySelector('.lm-TabBar-tab.lm-mod-current');
                const activeTabId = activeTabElement?.getAttribute('data-id');

                // 分析不一致的情况
                if (currentWidget && visibleWidgets.length > 0 && !visibleWidgets.includes(currentWidget)) {
                  console.log('[Tab Closed] ⚠️ Current widget is not in visible widgets list!');
                }

                if (activeTabId && currentWidget && activeTabId !== currentWidget.id) {
                  console.log('[Tab Closed] ⚠️ DOM active tab differs from shell.currentWidget!');
                }

              }, 100); // 延迟100ms确保切换完成

            } catch (error) {
              console.error('[Tab Closed] Error getting layout info:', error);
            }

            if (w.id && w.id.startsWith('notebook-detail-widget-')) {
              // 对于notebook detail widget的关闭，延迟处理以确保状态稳定
              setTimeout(() => {
                const widget = getActiveGalaxyWidget();
                if (widget) {
                  handleTabSwitch(widget);
                } else {
                  closeSidebarsIfNoMainWidgets(app);
                }
              }, 200); // 增加延迟时间，确保状态稳定
            } else {
              setTimeout(() => {
                const widget = getActiveGalaxyWidget();
                if (widget) {
                  handleTabSwitch(widget);
                }
              }, 100);
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

    // 监听滚动同步锁定状态变化
    window.addEventListener('galaxy-scroll-sync-update', (e: Event) => {
      const customEvent = e as CustomEvent;
      const { widgetId, locked } = customEvent.detail;
      if (locked) {
        lockedWidgets.add(widgetId);
        console.log('[Scroll Sync] Widget locked:', widgetId);
      } else {
        lockedWidgets.delete(widgetId);
        console.log('[Scroll Sync] Widget unlocked:', widgetId);
      }
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