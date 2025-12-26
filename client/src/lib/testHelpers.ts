// Test helpers for development/QA
export const MOCK_VIDEO_ANALYSIS = {
    sessionId: 'mock-test-session-' + Date.now(),
    summary: 'Fix leaking kitchen tap and replace worn bathroom sealant',
    visionInsights: 'Detected water damage around tap area, old silicone sealant deteriorating',
    jobs: [
        {
            description: 'Fix leaking tap in kitchen sink',
            estimatedHours: 1.5,
            confidence: 'high'
        },
        {
            description: 'Replace sealant around bathtub',
            estimatedHours: 2,
            confidence: 'medium'
        },
        {
            description: 'Check under-sink pipes for corrosion',
            estimatedHours: 0.5,
            confidence: 'medium'
        }
    ],
    tasks: [],
    estimatedRange: { low: 89, high: 179 },
    totalEstimatedHours: 4,
    framesAnalyzed: 12,
    analysisMethod: 'vision-gpt4',
    videoUrl: 'https://placehold.co/800x450/1a2332/white?text=Test+Video',
    thumbnailUrl: 'https://placehold.co/800x450/1a2332/emerald?text=Kitchen+Tap+Repair'
};

export const isTestMode = () => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('test') === 'true' || params.get('mockFlow') === 'true';
};

export const getTestModeConfig = () => {
    if (!isTestMode()) return null;

    return {
        skipVideoUpload: true,
        autoFillForms: true,
        showDebugControls: true,
        mockAnalysis: MOCK_VIDEO_ANALYSIS
    };
};
