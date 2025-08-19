import posthog from 'posthog-js';
import { POSTHOG_CONFIG, isPostHogConfigured } from './config';

export interface NotebookTrackingData {
  kernelVersionId: string;
  notebookName?: string;
  openedAt: number;
  competitionId?: string;
  totalCells?: number;
  codeCells?: number;
  tabTitle?: string;
  tabId?: string;
}

export class PostHogAnalytics {
  private static instance: PostHogAnalytics;
  private openedNotebooks: Map<string, NotebookTrackingData> = new Map();
  private sessionStartTime: number;
  private isInitialized: boolean = false;
  private analysisCount: number = 0;
  private sessionEnded: boolean = false;
  private hiddenStartTime: number | null = null;

  private moveDebounceMap: Map<string, number> = new Map();
  private userIP: string = 'unknown_ip'; // 存储用户IP

  private constructor() {
    this.sessionStartTime = Date.now();
    this.initializePostHog();
    this.setupWindowCloseTracking();
  }

  // 获取用户IP地址用于生成用户标识
  private async getUserIP(): Promise<string> {
    try {
      // 使用一个简单可靠的IP服务
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

      const response = await fetch('https://api.ipify.org?format=json', {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.ip) {
          return data.ip;
        }
      }

      // 如果服务失败，返回fallback
      return 'unknown_ip';
    } catch (error) {
      return 'unknown_ip';
    }
  }

  // 基于IP生成用户友好的标识符
  private generateUserIdentifier(ip: string): string {
    if (ip === 'unknown_ip') {
      return `galaxy_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 生成更友好的标识符格式
    // 例如: 192.168.1.100 -> galaxy_user_192.168.1.100
    return `galaxy_user_${ip}`;
  }

  public static getInstance(): PostHogAnalytics {
    if (!PostHogAnalytics.instance) {
      PostHogAnalytics.instance = new PostHogAnalytics();
    }
    return PostHogAnalytics.instance;
  }

  private initializePostHog(): void {
    try {
      // Check if PostHog is properly configured
      if (!isPostHogConfigured()) {
        console.warn('PostHog Analytics: Not configured. Please set your API key in src/analytics/config.ts');
        return;
      }

      // Initialize PostHog with official configuration
      posthog.init(
        POSTHOG_CONFIG.API_KEY,
        {
          api_host: POSTHOG_CONFIG.API_HOST,
          defaults: '2025-05-24', // Official defaults parameter
          loaded: async (posthog) => {
            // Get user IP and generate identifier
            const userIP = await this.getUserIP();
            this.userIP = userIP; // 存储IP供后续使用
            const userIdentifier = this.generateUserIdentifier(userIP);

            // Identify user with IP-based identifier
            posthog.identify(userIdentifier, {
              user_ip: userIP,
              identifier_type: userIP === 'unknown_ip' ? 'fallback' : 'ip_based',
              session_start_time: new Date().toISOString(),
              user_agent: navigator.userAgent,
              platform: navigator.platform
            });

            this.isInitialized = true;
            this.trackSessionStart();
          },
          capture_pageview: false, // Disable automatic pageview tracking for JupyterLab extension
          capture_pageleave: false, // We'll handle this manually
          persistence: 'localStorage',
          autocapture: false, // Disable automatic event capture as specified in official config
          on_request_error: (error) => {
            console.error('PostHog API Error:', error);
          },
          // Session Recording Configuration
          disable_session_recording: !POSTHOG_CONFIG.ENABLE_SESSION_RECORDING,

          // Additional settings for better performance  
          disable_web_experiments: true,
        }
      );
    } catch (error) {
      console.error('Failed to initialize PostHog:', error);
    }
  }

  private trackSessionStart(): void {
    if (!this.isInitialized) return;

    posthog.capture(POSTHOG_CONFIG.EVENTS.SESSION_STARTED, {
      session_id: `session_${this.sessionStartTime}`,
      screen_resolution: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      extension_version: POSTHOG_CONFIG.EXTENSION_VERSION,
      user_ip: this.userIP,
      user_location: this.getUserLocationInfo(),
      browser_language: navigator.language,
      browser_languages: navigator.languages,
      connection_type: this.getConnectionType()
    });
  }

  // 获取用户位置信息（基于IP的粗略位置）
  private getUserLocationInfo(): string {
    if (this.userIP === 'unknown_ip') {
      return 'unknown';
    }

    // 简单的IP地址类型判断
    if (this.userIP.startsWith('192.168.') || this.userIP.startsWith('10.') || this.userIP.startsWith('172.')) {
      return 'local_network';
    } else if (this.userIP.includes(':')) {
      return 'ipv6_network';
    } else {
      return 'public_network';
    }
  }

  // 获取连接类型信息
  private getConnectionType(): string {
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      return connection.effectiveType || connection.type || 'unknown';
    }
    return 'unknown';
  }

  public trackNotebookOpened(notebookData: {
    kernelVersionId: string;
    notebookName?: string;
    competitionId?: string;
    totalCells?: number;
    codeCells?: number;
    tabTitle?: string;
    tabId?: string;
  }): void {
    if (!this.isInitialized) {
      return;
    }

    const trackingData: NotebookTrackingData = {
      ...notebookData,
      openedAt: Date.now()
    };

    this.openedNotebooks.set(notebookData.kernelVersionId, trackingData);

    posthog.capture(POSTHOG_CONFIG.EVENTS.NOTEBOOK_OPENED, {
      // 核心数据
      kernelVersionId: notebookData.kernelVersionId,
      notebookName: notebookData.notebookName,
      competitionId: notebookData.competitionId,
      totalCells: notebookData.totalCells,
      codeCells: notebookData.codeCells,
      tabTitle: notebookData.tabTitle || notebookData.notebookName || 'Unknown Tab',

      // 会话信息
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`,
      notebooks_opened_count: this.openedNotebooks.size
    });

    // Notebook opened tracked
  }

  public trackNotebookClosed(kernelVersionId: string, additionalData?: { tabTitle?: string; tabId?: string }): void {
    if (!this.isInitialized) {
      return;
    }

    const notebookData = this.openedNotebooks.get(kernelVersionId);
    if (notebookData) {
      const viewDuration = Date.now() - notebookData.openedAt;

      posthog.capture(POSTHOG_CONFIG.EVENTS.NOTEBOOK_CLOSED, {
        // 核心数据
        kernelVersionId,
        notebookName: notebookData.notebookName,
        competitionId: notebookData.competitionId,
        tabTitle: additionalData?.tabTitle || notebookData.notebookName || 'Unknown Tab',

        // 查看行为
        viewDuration,
        viewDurationMinutes: Math.round(viewDuration / 60000 * 100) / 100,
        viewDurationCategory: this.categorizeViewDuration(viewDuration),

        // 会话信息
        sessionTime: Date.now() - this.sessionStartTime,
        session_id: `session_${this.sessionStartTime}`
      });

      this.openedNotebooks.delete(kernelVersionId);
    } else {
      // Even if notebook wasn't tracked in openedNotebooks, still send the close event

      posthog.capture(POSTHOG_CONFIG.EVENTS.NOTEBOOK_CLOSED, {
        // 核心数据
        kernelVersionId,
        notebookName: 'Unknown',
        competitionId: undefined,
        tabTitle: additionalData?.tabTitle || 'Unknown Tab',
        tabId: additionalData?.tabId,

        // 查看行为 - 无法计算，因为没有打开时间
        viewDuration: 0,
        viewDurationMinutes: 0,
        viewDurationCategory: 'unknown',

        // 会话信息
        sessionTime: Date.now() - this.sessionStartTime,
        session_id: `session_${this.sessionStartTime}`,

        // 标记这是一个未跟踪的关闭事件
        untracked_close: true
      });
    }
  }

  public trackAnalysisStarted(analysisData: {
    competitionId?: string;
    totalNotebooks: number;
    jsonFilePath: string;
  }): void {
    if (!this.isInitialized) return;

    posthog.capture(POSTHOG_CONFIG.EVENTS.ANALYSIS_STARTED, {
      // 分析数据
      competitionId: analysisData.competitionId,
      totalNotebooks: analysisData.totalNotebooks,
      fileName: analysisData.jsonFilePath.split('/').pop(),

      // 会话信息  
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`,
      analysis_count: this.analysisCount++
    });
  }

  public trackMatrixInteraction(
    interactionType: 'cell_click' | 'sort_changed' | 'cluster_selected' | 'icon_click',
    additionalData?: any
  ): void {
    if (!this.isInitialized) return;

    // Map interaction types to specific event names
    let eventName: string;
    switch (interactionType) {
      case 'cell_click':
        eventName = POSTHOG_CONFIG.EVENTS.MATRIX_CELL_CLICKED;
        break;
      case 'sort_changed':
        eventName = POSTHOG_CONFIG.EVENTS.MATRIX_SORT_CHANGED;
        break;
      case 'cluster_selected':
        eventName = POSTHOG_CONFIG.EVENTS.MATRIX_CLUSTER_SELECTED;
        break;
      case 'icon_click':
        eventName = POSTHOG_CONFIG.EVENTS.MATRIX_ICON_CLICKED;
        break;
      default:
        eventName = POSTHOG_CONFIG.EVENTS.MATRIX_ICON_CLICKED; // fallback
    }

    posthog.capture(eventName, {
      // Interaction details
      interactionType,
      ...additionalData,

      // Session context
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`,
      notebooks_currently_open: this.openedNotebooks.size,

      // Timing
      timestamp: Date.now(),
      local_time: new Date().toLocaleString(),

      // User context
      window_focused: document.hasFocus(),
      tab_visible: !document.hidden,
      viewport_size: `${window.innerWidth}x${window.innerHeight}`,

      // Browser state
      current_url: window.location.href,
      online_status: navigator.onLine
    });
  }

  public trackFlowChartInteraction(
    interactionType: 'stage_selected' | 'flow_selected' | 'selection_cleared' | 'stage_move',
    additionalData?: any
  ): void {
    if (!this.isInitialized) return;



    if (interactionType === 'stage_move') {
      const stageId = additionalData?.stage || additionalData?.stageId || 'unknown';
      const debounceKey = `move_${stageId}`;
      const lastMoveTime = this.moveDebounceMap.get(debounceKey) || 0;
      const now = Date.now();

      // Debounce move events to max once per 500ms per stage
      if (now - lastMoveTime < 500) {
        return;
      }
      this.moveDebounceMap.set(debounceKey, now);
    }

    // Map interaction types to specific event names
    let eventName: string;
    switch (interactionType) {
      case 'stage_selected':
        eventName = POSTHOG_CONFIG.EVENTS.FLOWCHART_STAGE_SELECTED;
        break;
      case 'flow_selected':
        eventName = POSTHOG_CONFIG.EVENTS.FLOWCHART_FLOW_SELECTED;
        break;
      case 'selection_cleared':
        eventName = POSTHOG_CONFIG.EVENTS.FLOWCHART_SELECTION_CLEARED;
        break;
      case 'stage_move':
        eventName = POSTHOG_CONFIG.EVENTS.FLOWCHART_STAGE_MOVED;
        break;
      default:
        eventName = POSTHOG_CONFIG.EVENTS.FLOWCHART_STAGE_SELECTED; // fallback
    }

    posthog.capture(eventName, {
      // 交互类型和核心数据
      interactionType,
      ...additionalData,

      // 会话信息
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`
    });
  }

  private setupWindowCloseTracking(): void {
    // Track when user closes the window/tab (true session end)
    window.addEventListener('beforeunload', () => {
      this.trackSessionEnd('window_close');
    });

    // Track when the extension is being unloaded (true session end)
    window.addEventListener('unload', () => {
      this.trackSessionEnd('page_unload');
    });

    // Track visibility changes but handle differently
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // Start tracking how long the tab is hidden
        this.hiddenStartTime = Date.now();
        // Tab became hidden - could add tracking here if needed
      } else if (document.visibilityState === 'visible') {
        // Tab became visible again

        // If tab was hidden for more than 30 minutes, consider it a session end
        if (this.hiddenStartTime && (Date.now() - this.hiddenStartTime) > 30 * 60 * 1000) {
          this.trackSessionEnd('long_inactivity');
        }
        this.hiddenStartTime = null;
      }
    });

    // Also track session end after long periods of inactivity
    setInterval(() => {
      if (this.hiddenStartTime && (Date.now() - this.hiddenStartTime) > 30 * 60 * 1000) {
        if (!this.sessionEnded) {
          this.trackSessionEnd('inactivity_timeout');
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  private trackSessionEnd(reason: string = 'unknown'): void {
    if (!this.isInitialized || this.sessionEnded) return;

    this.sessionEnded = true; // Prevent multiple session end events

    const sessionDuration = Date.now() - this.sessionStartTime;
    const openedNotebooksArray = Array.from(this.openedNotebooks.values());

    // Calculate statistics
    const totalNotebooksOpened = openedNotebooksArray.length;
    const competitionIds = [...new Set(openedNotebooksArray.map(nb => nb.competitionId).filter(Boolean))];
    const avgViewTime = totalNotebooksOpened > 0
      ? openedNotebooksArray.reduce((sum, nb) => sum + (Date.now() - nb.openedAt), 0) / totalNotebooksOpened
      : 0;

    // Calculate detailed session statistics
    const sessionDurationMinutes = Math.round(sessionDuration / 60000 * 100) / 100;

    // Send final tracking event with key data
    posthog.capture(POSTHOG_CONFIG.EVENTS.SESSION_ENDED, {
      // 会话概览
      session_id: `session_${this.sessionStartTime}`,
      sessionDuration,
      sessionDurationMinutes,
      session_end_reason: reason,

      // 核心统计
      totalNotebooksOpened,
      uniqueCompetitions: competitionIds.length,
      competitionIds,
      avgNotebookViewTimeMinutes: Math.round(avgViewTime / 60000 * 100) / 100,
      totalAnalysesPerformed: this.analysisCount,

      // 用户行为
      most_viewed_competition: this.getMostViewedCompetition(openedNotebooksArray),
      engagement_score: this.calculateEngagementScore(sessionDuration, totalNotebooksOpened, avgViewTime),

      // 打开的notebook列表 (简化版)
      notebookList: openedNotebooksArray.map(nb => ({
        kernelVersionId: nb.kernelVersionId,
        notebookName: nb.notebookName,
        competitionId: nb.competitionId,
        viewDurationMinutes: Math.round((Date.now() - nb.openedAt) / 60000 * 100) / 100
      }))
    });

    // Ensure the event is sent immediately (if flush method is available)
    if (typeof (posthog as any).flush === 'function') {
      (posthog as any).flush();
    }

    // Session ended
  }

  private categorizeViewDuration(duration: number): string {
    const minutes = duration / 60000;
    if (minutes < 0.5) return 'very_short'; // < 30 seconds
    if (minutes < 2) return 'short'; // 30s - 2min
    if (minutes < 10) return 'medium'; // 2min - 10min
    if (minutes < 30) return 'long'; // 10min - 30min
    return 'very_long'; // > 30min
  }

  private getMostViewedCompetition(notebooks: NotebookTrackingData[]): string {
    const competitionCounts = new Map<string, number>();
    notebooks.forEach(nb => {
      if (nb.competitionId) {
        competitionCounts.set(nb.competitionId, (competitionCounts.get(nb.competitionId) || 0) + 1);
      }
    });

    let mostViewed = 'none';
    let maxCount = 0;
    competitionCounts.forEach((count, competition) => {
      if (count > maxCount) {
        maxCount = count;
        mostViewed = competition;
      }
    });

    return mostViewed;
  }



  private calculateEngagementScore(sessionDuration: number, notebooksOpened: number, avgViewTime: number): number {
    // Engagement score based on session duration, number of notebooks, and average view time
    // Scale: 0-100
    const sessionMinutes = sessionDuration / 60000;
    const avgViewMinutes = avgViewTime / 60000;

    let score = 0;

    // Session duration factor (0-30 points)
    if (sessionMinutes > 60) score += 30;
    else if (sessionMinutes > 30) score += 25;
    else if (sessionMinutes > 15) score += 20;
    else if (sessionMinutes > 5) score += 15;
    else score += 5;

    // Notebooks opened factor (0-40 points)
    if (notebooksOpened > 10) score += 40;
    else if (notebooksOpened > 5) score += 30;
    else if (notebooksOpened > 3) score += 20;
    else if (notebooksOpened > 1) score += 15;
    else if (notebooksOpened === 1) score += 10;

    // Average view time factor (0-30 points)
    if (avgViewMinutes > 30) score += 30;
    else if (avgViewMinutes > 15) score += 25;
    else if (avgViewMinutes > 5) score += 20;
    else if (avgViewMinutes > 2) score += 15;
    else if (avgViewMinutes > 1) score += 10;
    else score += 5;

    return Math.min(score, 100);
  }

  public trackTabSwitch(tabData: {
    fromTab?: string;
    toTab: string;
    tabType: 'matrix' | 'notebook_detail' | 'other';
    notebookName?: string;
    competitionId?: string;
  }): void {
    if (!this.isInitialized) return;

    posthog.capture(POSTHOG_CONFIG.EVENTS.TAB_SWITCH, {
      fromTab: tabData.fromTab || 'unknown',
      toTab: tabData.toTab,
      tabType: tabData.tabType,
      notebookName: tabData.notebookName,
      competitionId: tabData.competitionId,
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`
    });
  }



  public trackCellDetailOpened(cellData: {
    cellType: string;
    cellIndex: number;
    notebookIndex?: number;
    notebookId?: string;
    notebookName?: string;
    kernelVersionId?: string;
    stageLabel?: string;
    source: 'matrix' | 'notebook_detail';
    competitionId?: string;
  }): void {
    if (!this.isInitialized) return;

    posthog.capture(POSTHOG_CONFIG.EVENTS.CELL_DETAIL_OPENED, {
      // Cell information
      cellType: cellData.cellType,
      cellIndex: cellData.cellIndex,
      stageLabel: cellData.stageLabel,

      // Notebook information
      notebookIndex: cellData.notebookIndex,
      notebookId: cellData.notebookId,
      notebookName: cellData.notebookName,
      kernelVersionId: cellData.kernelVersionId,

      // Source context
      source: cellData.source,
      competitionId: cellData.competitionId,

      // Session information
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`,
      notebooks_currently_open: this.openedNotebooks.size,

      // Timing
      timestamp: Date.now(),
      local_time: new Date().toLocaleString(),

      // User context
      window_focused: document.hasFocus(),
      tab_visible: !document.hidden,
      interaction_context: 'cell_exploration'
    });
  }

  public trackStageMove(moveData: {
    stage: string;
    stageLabel?: string;
    oldPosition?: { x: number; y: number };
    newPosition: { x: number; y: number };
    moveDistance?: number;
    moveDuration?: number;
    stageId?: string;
    flowchartContext?: 'overview' | 'notebook_detail';
  }): void {
    const distance = moveData.moveDistance || (
      moveData.oldPosition ?
        Math.sqrt(
          Math.pow(moveData.newPosition.x - moveData.oldPosition.x, 2) +
          Math.pow(moveData.newPosition.y - moveData.oldPosition.y, 2)
        ) : null
    );

    this.trackFlowChartInteraction('stage_move', {
      stage: moveData.stage,
      stageLabel: moveData.stageLabel,
      stageId: moveData.stageId,
      oldPosition: moveData.oldPosition,
      newPosition: moveData.newPosition,
      moveDistance: distance,
      moveDuration: moveData.moveDuration,
      flowchartContext: moveData.flowchartContext || 'overview',
      interaction_context: 'flowchart_customization'
    });
  }

  // Specialized tracking methods for split screen interactions
  public trackSplitScreenActivated(splitData: {
    totalNotebooks: number;
    notebookIds: string[];
    notebookNames?: string[];
    competitionId?: string;
    triggerAction: 'new_notebook_opened' | 'manual_split' | 'comparison_mode';
  }): void {
    if (!this.isInitialized) return;

    posthog.capture(POSTHOG_CONFIG.EVENTS.SPLIT_SCREEN_ACTIVATED, {
      totalNotebooks: splitData.totalNotebooks,
      notebookIds: splitData.notebookIds,
      notebookNames: splitData.notebookNames,
      competitionId: splitData.competitionId,
      triggerAction: splitData.triggerAction,
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`,
      interaction_context: 'multi_notebook_analysis'
    });
  }

  public trackSplitScreenDeactivated(splitData: {
    previousNotebookCount: number;
    remainingNotebooks: number;
    sessionDuration: number;
    deactivationReason: 'notebook_closed' | 'tab_switched' | 'manual_close';
  }): void {
    if (!this.isInitialized) return;

    posthog.capture(POSTHOG_CONFIG.EVENTS.SPLIT_SCREEN_DEACTIVATED, {
      previousNotebookCount: splitData.previousNotebookCount,
      remainingNotebooks: splitData.remainingNotebooks,
      splitSessionDuration: splitData.sessionDuration,
      splitSessionDurationMinutes: Math.round(splitData.sessionDuration / 60000 * 100) / 100,
      deactivationReason: splitData.deactivationReason,
      sessionTime: Date.now() - this.sessionStartTime,
      session_id: `session_${this.sessionStartTime}`,
      interaction_context: 'multi_notebook_analysis'
    });
  }
}

// Export singleton instance
export const analytics = PostHogAnalytics.getInstance(); 