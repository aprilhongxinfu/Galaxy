export const STAGE_GROUP_MAP: Record<string, string> = {
    '1': 'Data-oriented',  // Data_Extraction
    '2': 'Data-oriented',  // Data_Transform
    '3': 'Data-oriented',  // EDA
    '4': 'Data-oriented',  // Visualization
    '5': 'Data-oriented',  // Feature_Engineering

    '7': 'Model-oriented', // Model_Train
    '8': 'Model-oriented', // Model_Evaluation
    '6': 'Model-oriented', // Hyperparam_Tuning

    '0': 'Environment',    // Environment
    '9': 'Data export',    // Data_Export
    '10': 'Other',         // Commented
    '12': 'Other'          // Other
};