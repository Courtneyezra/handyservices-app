// Client helpers + types for the Contractor Academy.
export interface AcademyQuestion {
    id: string;
    prompt: string;
    options: string[];
}
export interface AcademyModuleProgress {
    status: 'not_started' | 'in_progress' | 'passed' | 'failed';
    score: number | null;
    bestScore: number | null;
    attempts: number;
    passedAt: string | null;
    expiresAt: string | null;
    current: boolean;
}
export interface AcademyModule {
    id: string;
    order: number;
    title: string;
    subtitle: string;
    videoUrl: string | null;
    passThreshold: number;
    expiryMonths: number | null;
    gate: 'hard' | 'soft' | 'none';
    required: boolean;
    questions: AcademyQuestion[];
    progress: AcademyModuleProgress;
}
export interface AcademyResponse {
    modules: AcademyModule[];
    certsCurrent: boolean;
    hardGateActive: boolean;
}
export interface QuizResult {
    total: number;
    correctCount: number;
    score: number;
    passed: boolean;
    passThreshold: number;
    moduleId: string;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('contractorToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchAcademy(): Promise<AcademyResponse> {
    const res = await fetch('/api/contractor/academy', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load academy');
    return res.json();
}

export async function submitQuiz(moduleId: string, answers: (number | null)[]): Promise<QuizResult> {
    const res = await fetch(`/api/contractor/academy/${moduleId}/submit-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ answers }),
    });
    if (!res.ok) throw new Error('Failed to submit quiz');
    return res.json();
}
