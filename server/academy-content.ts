// Contractor Academy — module & quiz definitions (no CMS; hardcoded for MVP).
// Source scripts/quiz banks:
//   docs/CONTRACTOR_ACADEMY_AIRPLANE_INTRO_SCRIPT.md
//   docs/CONTRACTOR_ACADEMY_COMPLIANCE_QUIZ.md
//   docs/CONTRACTOR_ACADEMY_STANDARD_MODULE_SCRIPT.md
// Quiz grading happens server-side; correctIndex is never sent to the client.

export interface AcademyQuizOption {
    text: string;
}
export interface AcademyQuizQuestion {
    id: string;
    prompt: string;
    options: string[];
    correctIndex: number;
}
export interface AcademyModule {
    id: string;
    order: number;
    title: string;
    subtitle: string;
    /** null until the real video is produced; UI shows a placeholder. */
    videoUrl: string | null;
    /** Percent (0-100) needed to pass. */
    passThreshold: number;
    /** If set, a pass expires after N months (re-certification). */
    expiryMonths?: number;
    /** 'hard' blocks the dashboard until passed; 'soft' shows a dismissible banner. */
    gate: 'hard' | 'soft' | 'none';
    /** Must-pass to be considered "certs current" for the gate. */
    required: boolean;
    questions: AcademyQuizQuestion[];
}

export const ACADEMY_MODULES: AcademyModule[] = [
    {
        id: 'compliance',
        order: 1,
        title: 'Pre-Flight Briefing',
        subtitle: 'Insurance, safety & what to do when it goes wrong',
        videoUrl: null,
        passThreshold: 80,
        expiryMonths: 12,
        gate: 'soft', // flip to 'hard' once content is final
        required: true,
        questions: [
            {
                id: 'c1',
                prompt: "A customer asks you to do a quick extra task that isn't on the job sheet. What do you do?",
                options: [
                    "Fine, as long as the customer's happy.",
                    "Fine — it's covered because you're a Handy contractor.",
                    "Stop — work outside the agreed scope isn't covered by our insurance. Clear it with ops first.",
                    "Do it, then tell ops afterwards.",
                ],
                correctIndex: 2,
            },
            {
                id: 'c2',
                prompt: "A job needs a gas connection. You've done similar before but you're not Gas Safe registered.",
                options: [
                    "Do it carefully — you know how.",
                    "Stop. If it needs a qualification you don't hold, you don't touch it — flag to ops.",
                    "Do it and note it in the photos.",
                    "Ask the customer if they mind.",
                ],
                correctIndex: 1,
            },
            {
                id: 'c3',
                prompt: "Before working on a light fitting, the correct sequence is:",
                options: [
                    "Work fast so the power's off for less time.",
                    "Assess, isolate the power, verify it's dead with a tester, then work.",
                    "Isolate only if the customer asks.",
                    "Turn it off at the switch and start.",
                ],
                correctIndex: 1,
            },
            {
                id: 'c4',
                prompt: "You crack a customer's floor tile mid-job. They're not home. What do you do?",
                options: [
                    "Finish the job and hope they don't notice.",
                    "Try to fix it yourself and say nothing.",
                    "Stop, make the area safe, and report it to ops straight away with photos.",
                    "Leave a note and carry on.",
                ],
                correctIndex: 2,
            },
            {
                id: 'c5',
                prompt: "Halfway in, you realise the job is far bigger than what was quoted.",
                options: [
                    "Agree a new price with the customer on the spot.",
                    "Do as much as the quote covers and leave the rest.",
                    "Stop and tell ops before proceeding — ops sets price and scope.",
                    "Absorb it to keep the customer happy.",
                ],
                correctIndex: 2,
            },
            {
                id: 'c6',
                prompt: "You've finished but you're running late for the next job.",
                options: [
                    "Leave tools out — you'll be quick next time.",
                    "Clear trip hazards, tuck cables, remove anything sharp — especially around children/pets — then leave.",
                    "Only tidy if the customer is watching.",
                    "Cleaning up is the customer's responsibility.",
                ],
                correctIndex: 1,
            },
            {
                id: 'c7',
                prompt: "The customer's home has pale carpets and you need to move a chair to reach the work.",
                options: [
                    "Move whatever you need — you're working.",
                    "Boots off or covers on, and ask before moving their belongings.",
                    "Move the chair; ask about the carpets later.",
                    "Only use covers if it's raining outside.",
                ],
                correctIndex: 1,
            },
            {
                id: 'c8',
                prompt: "When are job photos required?",
                options: [
                    "Only if the customer requests them.",
                    "Only the 'after' shot.",
                    "Before, during (where relevant), and after — no photos, no proof, no payment.",
                    "Only on landlord jobs.",
                ],
                correctIndex: 2,
            },
            {
                id: 'c9',
                prompt: "You cut yourself and it's bleeding more than expected.",
                options: [
                    "Stop, make yourself and the area safe, get first aid, and tell ops immediately.",
                    "Wrap it and push through to finish.",
                    "Finish first, report at the end of the day.",
                    "Only report it if you need time off.",
                ],
                correctIndex: 0,
            },
            {
                id: 'c10',
                prompt: "Which single sentence captures the 'when it goes wrong' rule?",
                options: [
                    "Fix it quietly and move on.",
                    "Ask the customer what they'd prefer.",
                    "Stop, make it safe, and tell us straight away — never hide it, never guess.",
                    "Report it at your next login.",
                ],
                correctIndex: 2,
            },
        ],
    },
    {
        id: 'standard',
        order: 2,
        title: 'The Standard',
        subtitle: 'The five things that make a job "done right"',
        videoUrl: null,
        passThreshold: 80,
        gate: 'soft',
        required: false, // promotion evidence, not a hard gate
        questions: [
            {
                id: 's1',
                prompt: "A job is 95% done but one item on the sheet is unfinished. It's:",
                options: [
                    "Not done — every quoted item must be complete or agreed with ops.",
                    "Done enough if the customer seems happy.",
                    "Done — you can note the last item for 'next time'.",
                ],
                correctIndex: 0,
            },
            {
                id: 's2',
                prompt: "You find extra work mid-job. You:",
                options: [
                    "Agree a price with the customer and crack on.",
                    "Stop and clear the change with ops before proceeding.",
                    "Do it free to keep them happy.",
                ],
                correctIndex: 1,
            },
            {
                id: 's3',
                prompt: "'Clean handover' means:",
                options: [
                    "Sweep up if you have time.",
                    "Leave the area cleaner than you found it — debris gone, surfaces wiped.",
                    "The customer tidies; you do the trade work.",
                ],
                correctIndex: 1,
            },
            {
                id: 's4',
                prompt: "You'll miss the arrival window. The right move:",
                options: [
                    "Turn up late and apologise in person.",
                    "Tell the customer and ops before the slot.",
                    "Say nothing if it's only 20 minutes.",
                ],
                correctIndex: 1,
            },
            {
                id: 's5',
                prompt: "In the customer's home you should:",
                options: [
                    "Work however's fastest; it's just a job.",
                    "Manage boots, no swearing/smoking, mind children/pets/tenants.",
                    "Only mind your manners if the customer's watching.",
                ],
                correctIndex: 1,
            },
            {
                id: 's6',
                prompt: "A task needs a qualification you don't hold:",
                options: [
                    "Do it carefully — you've seen it done.",
                    "Flag it to ops; never bodge work outside your competence.",
                    "Do it and photograph it well.",
                ],
                correctIndex: 1,
            },
            {
                id: 's7',
                prompt: "The 'after' photo should be:",
                options: [
                    "Any angle that looks good.",
                    "The same angle as the 'before' — the comparison is the proof.",
                    "Optional if the finish is obviously good.",
                ],
                correctIndex: 1,
            },
            {
                id: 's8',
                prompt: "You spot a scratch you didn't cause. You:",
                options: [
                    "Ignore it — not your problem.",
                    "Buff it out quietly.",
                    "Photograph it before you start — it protects you and Handy.",
                ],
                correctIndex: 2,
            },
            {
                id: 's9',
                prompt: "Which does NOT require stopping to call ops first?",
                options: [
                    "Scope bigger than quoted.",
                    "Choosing which of your own tools to use.",
                    "Customer asks for something off the job sheet.",
                ],
                correctIndex: 1,
            },
            {
                id: 's10',
                prompt: "On your first three jobs:",
                options: [
                    "Payment is automatic like any other job.",
                    "A Handy lead reviews your photos before payment as a quality check.",
                    "You're already a Core contractor.",
                ],
                correctIndex: 1,
            },
        ],
    },
];

export function getModule(moduleId: string): AcademyModule | undefined {
    return ACADEMY_MODULES.find((m) => m.id === moduleId);
}

/** Strip correct answers for client delivery. */
export function publicModule(m: AcademyModule) {
    return {
        id: m.id,
        order: m.order,
        title: m.title,
        subtitle: m.subtitle,
        videoUrl: m.videoUrl,
        passThreshold: m.passThreshold,
        expiryMonths: m.expiryMonths ?? null,
        gate: m.gate,
        required: m.required,
        questions: m.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })),
    };
}

export interface GradeResult {
    total: number;
    correctCount: number;
    score: number; // percent
    passed: boolean;
    passThreshold: number;
}

/** Grade an answers array (index per question, in module question order). */
export function gradeQuiz(m: AcademyModule, answers: number[]): GradeResult {
    const total = m.questions.length;
    let correctCount = 0;
    m.questions.forEach((q, i) => {
        if (answers[i] === q.correctIndex) correctCount += 1;
    });
    const score = Math.round((correctCount / total) * 100);
    return {
        total,
        correctCount,
        score,
        passed: score >= m.passThreshold,
        passThreshold: m.passThreshold,
    };
}
