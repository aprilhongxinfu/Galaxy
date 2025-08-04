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



// 从JSON文件名中提取competition编号
function extractCompetitionId(jsonPath: string): string | null {
  const match = jsonPath.match(/(\d+)_(predicted|reassigned)\.json$/);
  return match ? match[1] : null;
}

// 加载TOC数据
async function loadTocData(competitionId: string): Promise<any[]> {
  try {
    const tocPath = `src/data/toc_data/${competitionId}_toc.json`;
    console.log('TOC path:', tocPath);
    
    // 尝试不同的路径格式
    const alternativePaths = [
      tocPath,
      `./src/data/toc_data/${competitionId}_toc.json`,
      `/src/data/toc_data/${competitionId}_toc.json`,
      `data/toc_data/${competitionId}_toc.json`
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
        console.log('File loaded successfully, content length:', (model.content as string).length);
        
        const tocData = JSON.parse(model.content as string);
        console.log(`TOC data loaded successfully for competition ${competitionId}, entries: ${tocData.length}`);
        console.log('First few TOC entries:', tocData.slice(0, 3));
        return tocData;
      } catch (fileError) {
        console.log(`Failed to load from ${path}:`, (fileError as Error).message);
        continue;
      }
    }
    
    console.error('All paths failed for TOC loading');
    console.log('Trying to list available files...');
    
    // 尝试列出可用的文件
    try {
      const listing = await contentsManager.get('src/data/toc_data/', { type: 'directory' });
      console.log('Available files in toc_data:', listing.content);
    } catch (listError) {
      console.error('Error listing directory:', listError);
    }
    
    return [];
  } catch (error) {
    console.warn(`Failed to load TOC data for competition ${competitionId}:`, error);
    return [];
  }
}

// 将TOC数据合并到notebook数据中
function mergeTocData(notebooks: any[], tocData: any[]): any[] {
  const tocMap = new Map();
  tocData.forEach(item => {
    tocMap.set(item.kernelVersionId, item.toc);
  });
  
  console.log('TOC data sample:', tocData.slice(0, 3));
  console.log('Notebooks sample:', notebooks.slice(0, 3).map(nb => ({
    kernelVersionId: nb.kernelVersionId,
    index: nb.index,
    globalIndex: nb.globalIndex,
    notebook_name: nb.notebook_name
  })));
  
  return notebooks.map(notebook => {
    const toc = tocMap.get(notebook.kernelVersionId);
    if (toc) {
      console.log(`Found TOC for notebook ${notebook.kernelVersionId}:`, toc.length, 'items');
      return { ...notebook, toc };
    } else {
      console.log(`No TOC found for notebook ${notebook.kernelVersionId}`);
    }
    return notebook;
  });
}

// 创建KernelVersionId到Title的映射
async function createKernelTitleMap(competitionId: string): Promise<Map<string, string>> {
  try {
    // 动态加载CSV文件
    const csvPath = `src/data/kernel_data/competition_${competitionId}.csv`;
    const contentsManager = app?.serviceManager?.contents;
    
    if (!contentsManager) {
      console.warn('Contents manager not available');
      return new Map();
    }

    console.log(`Attempting to load CSV from: ${csvPath}`);
    const model = await contentsManager.get(csvPath, { type: 'file', format: 'text', content: true });
    console.log(`CSV loaded successfully, content length: ${(model.content as string).length}`);
    
    const csvData = csvParse(model.content as string);
    console.log(`CSV parsed, rows: ${csvData.length}, sample row:`, csvData[0]);
    
    const titleMap = new Map<string, string>();
    csvData.forEach((row: any) => {
      const kernelVersionId = row.KernelVersionId?.toString();
      const title = row.Title;
      if (kernelVersionId && title) {
        titleMap.set(kernelVersionId, title);
      }
    });

    console.log(`Created title map for competition ${competitionId} with ${titleMap.size} entries`);
    console.log(`Sample entries:`, Array.from(titleMap.entries()).slice(0, 3));
    return titleMap;
  } catch (error) {
    console.warn(`Failed to load kernel data for competition ${competitionId}:`, error);
    return new Map();
  }
}

// 递归替换对象中的KernelVersionId为Title
function replaceKernelVersionIdWithTitle(obj: any, titleMap: Map<string, string>): any {
  if (Array.isArray(obj)) {
    return obj.map(item => replaceKernelVersionIdWithTitle(item, titleMap));
  } else if (obj && typeof obj === 'object') {
    const newObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'kernelVersionId' && typeof value === 'string') {
        const title = titleMap.get(value);
        if (title) {
          newObj.notebook_name = title; // 替换为notebook_name字段
          newObj.kernelVersionId = value; // 保留kernelVersionId用于相似性分组匹配
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
        let savedCompetitionId: string | null = null;

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
    console.log('[tab switch] widget.id:', tabId, widget);
    if (tabId.startsWith('notebook-detail-widget-') && widget.notebook) {
      // notebook detail tab
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
      console.log('[tab switch] notebook detail:', nb);
      return;
    }
    if (tabId === 'matrix-widget') {
      // overview tab
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
      console.log('[tab switch] matrix overview');
      return;
    }
    // 其它 tab 不更新 sidebar，但也不关闭sidebar
    console.log('[tab switch] no flowchart action for tab:', tabId);
  }

  // ====== closeSidebarsIfNoMainWidgets 也放到 activate 内部，能访问 handleTabSwitch ======
  function closeSidebarsIfNoMainWidgets(app: JupyterFrontEnd) {
    const mainWidgets = Array.from(app.shell.widgets('main'));
    const hasMatrix = mainWidgets.some(w => w.id === 'matrix-widget');
    const hasDetail = mainWidgets.some(w => w.id && w.id.startsWith('notebook-detail-widget-'));
    
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
          selectedItems[0].path.endsWith('.json') && selectedItems[0].path.includes('18599')
        ) {
          // 直接用 Contents API 读取 JSON 文件内容
          const contentsManager = app.serviceManager.contents;
          const model = await contentsManager.get(selectedItems[0].path, { type: 'file', format: 'text', content: true });
          result1 = JSON.parse(model.content as string);
          console.log('Loaded JSON:', result1);
          
          // 提取competition ID并创建title映射
          console.log('Extracting competition ID from path:', selectedItems[0].path);
          const competitionId = extractCompetitionId(selectedItems[0].path);
          console.log('Extracted competition ID:', competitionId);
          if (competitionId) {
            const titleMap = await createKernelTitleMap(competitionId);
            result1 = replaceKernelVersionIdWithTitle(result1, titleMap);
            console.log('Applied title mapping for competition:', competitionId);
            savedCompetitionId = competitionId;
            console.log('Set savedCompetitionId to:', savedCompetitionId);
            
            // 加载并合并TOC数据
            const tocData = await loadTocData(competitionId);
            result1 = mergeTocData(result1, tocData);
            console.log('Applied TOC data for competition:', competitionId);
          } else {
            console.log('No competition ID extracted from path');
          }
          
          // 读取 CSV 文件
          try {
            const csvModel = await contentsManager.get('test-notebooks/enhanced_clustering_results.csv', { type: 'file', format: 'text', content: true });
            similarityGroups = csvParse(csvModel.content as string);
            console.log('Loaded CSV:', similarityGroups);
          } catch (e) {
            alert('无法读取 enhanced_clustering_results.csv');
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
          
          // 提取competition ID并创建title映射
          console.log('Extracting competition ID from path (second case):', selectedItems[0].path);
          const competitionId = extractCompetitionId(selectedItems[0].path);
          console.log('Extracted competition ID (second case):', competitionId);
          if (competitionId) {
            const titleMap = await createKernelTitleMap(competitionId);
            result1 = replaceKernelVersionIdWithTitle(result1, titleMap);
            console.log('Applied title mapping for competition (second case):', competitionId);
            savedCompetitionId = competitionId;
            console.log('Set savedCompetitionId to (second case):', savedCompetitionId);
            
            // 加载并合并TOC数据
            const tocData = await loadTocData(competitionId);
            result1 = mergeTocData(result1, tocData);
            console.log('Applied TOC data for competition (second case):', competitionId);
          } else {
            console.log('No competition ID extracted from path (second case)');
          }
          
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
          
          // 对于后端API返回的数据，尝试从selectedPaths中提取competition ID
          if (selectedPaths.length > 0) {
            const path = selectedPaths[0];
            let competitionId: string | null = null;
            
            // 从路径中提取competition ID
            if (path.includes('18599')) {
              competitionId = '18599';
            } else if (path.includes('35332')) {
              competitionId = '35332';
            } else if (path.includes('50160')) {
              competitionId = '50160';
            }
            
            if (competitionId) {
              const titleMap = await createKernelTitleMap(competitionId);
              result1 = replaceKernelVersionIdWithTitle(result1, titleMap);
              console.log('Applied title mapping for competition:', competitionId);
              savedCompetitionId = competitionId;
              
              // 加载并合并TOC数据
              const tocData = await loadTocData(competitionId);
              result1 = mergeTocData(result1, tocData);
              console.log('Applied TOC data for competition:', competitionId);
            }
          }
          
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
        
        // 创建kernelTitleMap用于MatrixWidget
        let kernelTitleMap = new Map<string, string>();
        
        // 重新获取competitionId
        let competitionIdForMatrix: string | null = null;
        if (selectedItems.length === 1 && selectedItems[0].type === 'file' && selectedItems[0].path.endsWith('.json')) {
          competitionIdForMatrix = extractCompetitionId(selectedItems[0].path);
        }
        
        if (competitionIdForMatrix) {
          console.log('Creating kernelTitleMap for MatrixWidget with competitionId:', competitionIdForMatrix);
          kernelTitleMap = await createKernelTitleMap(competitionIdForMatrix);
          console.log('Created kernelTitleMap for MatrixWidget:', {
            competitionId: competitionIdForMatrix,
            mapSize: kernelTitleMap.size,
            sampleEntries: Array.from(kernelTitleMap.entries()).slice(0, 3)
          });
        } else {
          console.log('No competitionId found for MatrixWidget');
        }
        
        matrixWidget = new MatrixWidget(result1, colorScale, similarityGroups, kernelTitleMap);
        app.shell.add(matrixWidget, 'main');
        app.shell.activateById(matrixWidget.id);
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
          console.log('TOC item clicked:', cellId);
          
          // 解析cellId，格式为 "kernelVersionId_cellIndex"
          const [kernelVersionId, cellIndexStr] = cellId.split('_');
          const cellIndex = parseInt(cellIndexStr);
          
          // 找到对应的notebook
          const notebook = result1.find((nb: any) => nb.kernelVersionId === kernelVersionId);
          if (notebook) {
            // 确保notebook有index属性，如果没有则使用数组索引
            const notebookIndex = notebook.index !== undefined ? notebook.index : result1.indexOf(notebook);
            console.log('Found notebook for TOC jump:', {
              kernelVersionId,
              notebookIndex,
              cellIndex,
              hasIndex: notebook.index !== undefined
            });
            
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
            detailSidebar.setFilter(null);
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