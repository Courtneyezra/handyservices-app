// Store for passing video blobs and analysis between pages
// Using sessionStorage for video analysis to persist across page navigation
let videoBlob: Blob | null = null;

const VIDEO_ANALYSIS_KEY = 'video_analysis_data';
const JOB_STATE_KEY = 'job_conversation_state';
const CHAT_HISTORY_KEY = 'chat_history';
const DRAFT_LEAD_ID_KEY = 'draft_lead_id';
const VIDEO_URL_KEY = 'video_storage_url';
const INTAKE_DATA_KEY = 'intake_data';

export interface IntakeData {
  intakeId: string;
  jobDescription: string;
  address: string;
}

export const setIntakeData = (data: IntakeData) => {
  try {
    sessionStorage.setItem(INTAKE_DATA_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to store intake data:', error);
  }
};

export const getIntakeData = (): IntakeData | null => {
  try {
    const stored = sessionStorage.getItem(INTAKE_DATA_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to retrieve intake data:', error);
    return null;
  }
};

export const clearIntakeData = () => {
  try {
    sessionStorage.removeItem(INTAKE_DATA_KEY);
  } catch (error) {
    console.error('Failed to clear intake data:', error);
  }
};

export interface JobState {
  summary: string;
  tasks: string[];
  materials: string[];
  complexity: 'simple' | 'moderate' | 'complex';
  urgency: 'flexible' | 'next_week' | 'next_day' | 'same_day';
  additionalNotes: string[];
  estimatedRange: { low: number; high: number };
  totalEstimatedHours?: number;
  readyForQuote?: boolean;
  customerName?: string;
  postcode?: string;
  mobile?: string;
}

export const createDefaultJobState = (analysis?: any): JobState => ({
  summary: analysis?.summary || '',
  tasks: analysis?.tasks || [],
  materials: [],
  complexity: 'moderate',
  urgency: 'flexible',
  additionalNotes: [],
  estimatedRange: analysis?.estimatedRange || { low: 79, high: 159 },
  totalEstimatedHours: analysis?.totalEstimatedHours || 2,
  readyForQuote: false
});

export interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
}

export const setVideoBlob = (blob: Blob) => {
  videoBlob = blob;
};

export const getVideoBlob = (): Blob | null => {
  return videoBlob;
};

export const clearVideoBlob = () => {
  videoBlob = null;
};

export const setVideoAnalysis = (analysis: any) => {
  try {
    sessionStorage.setItem(VIDEO_ANALYSIS_KEY, JSON.stringify(analysis));
  } catch (error) {
    console.error('Failed to store video analysis:', error);
  }
};

export const getVideoAnalysis = (): any | null => {
  try {
    const stored = sessionStorage.getItem(VIDEO_ANALYSIS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to retrieve video analysis:', error);
    return null;
  }
};

export const clearVideoAnalysis = () => {
  try {
    sessionStorage.removeItem(VIDEO_ANALYSIS_KEY);
  } catch (error) {
    console.error('Failed to clear video analysis:', error);
  }
};

export const setJobState = (state: JobState) => {
  try {
    sessionStorage.setItem(JOB_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to store job state:', error);
  }
};

export const getJobState = (): JobState | null => {
  try {
    const stored = sessionStorage.getItem(JOB_STATE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to retrieve job state:', error);
    return null;
  }
};

export const clearJobState = () => {
  try {
    sessionStorage.removeItem(JOB_STATE_KEY);
  } catch (error) {
    console.error('Failed to clear job state:', error);
  }
};

export const setChatHistory = (messages: ChatMessage[]) => {
  try {
    sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages));
  } catch (error) {
    console.error('Failed to store chat history:', error);
  }
};

export const getChatHistory = (): ChatMessage[] => {
  try {
    const stored = sessionStorage.getItem(CHAT_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to retrieve chat history:', error);
    return [];
  }
};

export const clearChatHistory = () => {
  try {
    sessionStorage.removeItem(CHAT_HISTORY_KEY);
  } catch (error) {
    console.error('Failed to clear chat history:', error);
  }
};

export const setDraftLeadId = (id: number) => {
  try {
    sessionStorage.setItem(DRAFT_LEAD_ID_KEY, id.toString());
  } catch (error) {
    console.error('Failed to store draft lead ID:', error);
  }
};

export const getDraftLeadId = (): number | null => {
  try {
    const stored = sessionStorage.getItem(DRAFT_LEAD_ID_KEY);
    return stored ? parseInt(stored, 10) : null;
  } catch (error) {
    console.error('Failed to retrieve draft lead ID:', error);
    return null;
  }
};

export const clearDraftLeadId = () => {
  try {
    sessionStorage.removeItem(DRAFT_LEAD_ID_KEY);
  } catch (error) {
    console.error('Failed to clear draft lead ID:', error);
  }
};

export const setVideoUrl = (url: string) => {
  try {
    sessionStorage.setItem(VIDEO_URL_KEY, url);
  } catch (error) {
    console.error('Failed to store video URL:', error);
  }
};

export const getVideoUrl = (): string | null => {
  try {
    return sessionStorage.getItem(VIDEO_URL_KEY);
  } catch (error) {
    console.error('Failed to retrieve video URL:', error);
    return null;
  }
};

export const clearVideoUrl = () => {
  try {
    sessionStorage.removeItem(VIDEO_URL_KEY);
  } catch (error) {
    console.error('Failed to clear video URL:', error);
  }
};

export const clearAllVideoData = () => {
  clearVideoBlob();
  clearVideoAnalysis();
  clearJobState();
  clearChatHistory();
  clearDraftLeadId();
  clearVideoUrl();
};
