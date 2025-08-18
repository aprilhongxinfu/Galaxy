// PostHog Analytics Configuration
// To set up PostHog analytics:
// 1. Sign up for a PostHog account at https://app.posthog.com
// 2. Create a new project
// 3. Copy your project API key from the project settings
// 4. Replace 'phc_your_api_key_here' below with your actual API key
// 5. Optionally, if you're using PostHog Cloud EU, change the API_HOST

export const POSTHOG_CONFIG = {
  // Official PostHog API key provided
  API_KEY: 'phc_hJUew4Alg33sYVoYGrrozeElhzN20av1ngd5Jz6SQ3o',
  
  // Using EU PostHog server as specified in official config
  API_HOST: 'https://eu.i.posthog.com',
  
  // Extension information
  EXTENSION_NAME: 'galaxy',
  EXTENSION_VERSION: '1.0.5',
  
  // Session Recording Configuration
  ENABLE_SESSION_RECORDING: true, // Set to false to disable recording
  
  // Event names used for tracking
  EVENTS: {
    // Session-level events
    SESSION_STARTED: 'galaxy_session_started',
    SESSION_ENDED: 'galaxy_session_ended',
    
    // Main application events
    ANALYSIS_STARTED: 'galaxy_main_analysis_started',
    TAB_SWITCH: 'galaxy_main_tab_switched',
    
    // Notebook management events
    NOTEBOOK_OPENED: 'galaxy_notebook_opened',
    NOTEBOOK_CLOSED: 'galaxy_notebook_closed',
    
    // Matrix widget specific interactions
    MATRIX_CELL_CLICKED: 'galaxy_matrix_cell_clicked',
    MATRIX_SORT_CHANGED: 'galaxy_matrix_sort_changed', 
    MATRIX_CLUSTER_SELECTED: 'galaxy_matrix_cluster_selected',
    MATRIX_ICON_CLICKED: 'galaxy_matrix_icon_clicked',

    
    // Flowchart widget specific interactions  
    FLOWCHART_STAGE_SELECTED: 'galaxy_flowchart_stage_selected',
    FLOWCHART_STAGE_MOVED: 'galaxy_flowchart_stage_moved',
    FLOWCHART_FLOW_SELECTED: 'galaxy_flowchart_flow_selected',
    FLOWCHART_SELECTION_CLEARED: 'galaxy_flowchart_selection_cleared',
    
    // Cell detail interactions
    CELL_DETAIL_OPENED: 'galaxy_cell_detail_opened',
    
    // Split screen / multi-notebook interactions
    SPLIT_SCREEN_ACTIVATED: 'galaxy_split_screen_activated',
    SPLIT_SCREEN_DEACTIVATED: 'galaxy_split_screen_deactivated',

    NOTEBOOK_COMPARISON_VIEWED: 'galaxy_notebook_comparison_viewed'
  }
};

// Check if the API key has been set
export const isPostHogConfigured = (): boolean => {
  return POSTHOG_CONFIG.API_KEY !== 'phc_your_api_key_here' && 
         POSTHOG_CONFIG.API_KEY.length > 0 &&
         POSTHOG_CONFIG.API_KEY.startsWith('phc_') &&
         POSTHOG_CONFIG.API_KEY.length > 20; // PostHog keys are typically much longer
}; 