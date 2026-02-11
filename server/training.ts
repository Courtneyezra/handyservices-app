import { Router } from 'express';
import { db } from './db';
import { trainingModules, trainingProgress, partnerApplications } from '../shared/schema';
import { eq, asc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export const trainingRouter = Router();

// Get all active training modules
trainingRouter.get('/api/training/modules', async (req, res) => {
    try {
        const modules = await db.select()
            .from(trainingModules)
            .where(eq(trainingModules.isActive, true))
            .orderBy(asc(trainingModules.orderIndex));

        res.json(modules);
    } catch (error) {
        console.error('Failed to get modules:', error);
        res.status(500).json({ error: 'Failed to get modules' });
    }
});

// Get single module
trainingRouter.get('/api/training/modules/:slug', async (req, res) => {
    try {
        const modules = await db.select()
            .from(trainingModules)
            .where(and(
                eq(trainingModules.slug, req.params.slug),
                eq(trainingModules.isActive, true)
            ))
            .limit(1);

        if (modules.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        res.json(modules[0]);
    } catch (error) {
        console.error('Failed to get module:', error);
        res.status(500).json({ error: 'Failed to get module' });
    }
});

// Get progress for contractor
trainingRouter.get('/api/training/progress/:contractorId', async (req, res) => {
    try {
        const progress = await db.select()
            .from(trainingProgress)
            .where(eq(trainingProgress.contractorId, req.params.contractorId));

        const modules = await db.select()
            .from(trainingModules)
            .where(eq(trainingModules.isActive, true))
            .orderBy(asc(trainingModules.orderIndex));

        // Build report
        const report = modules.map(mod => {
            const prog = progress.find(p => p.moduleId === mod.id);
            return {
                moduleId: mod.id,
                slug: mod.slug,
                title: mod.title,
                orderIndex: mod.orderIndex,
                isRequired: mod.isRequired,
                status: prog
                    ? prog.passed ? 'completed' : prog.startedAt ? 'in_progress' : 'not_started'
                    : 'not_started',
                startedAt: prog?.startedAt || null,
                videoWatchedAt: prog?.videoWatchedAt || null,
                completedAt: prog?.completedAt || null,
                quizScore: prog?.quizScore || null,
                passed: prog?.passed || false,
                attempts: prog?.attempts || 0,
            };
        });

        const required = report.filter(r => r.isRequired);
        const completedRequired = required.filter(r => r.passed);

        res.json({
            modules: report,
            summary: {
                totalModules: modules.length,
                completedModules: report.filter(r => r.passed).length,
                requiredModules: required.length,
                completedRequired: completedRequired.length,
                allComplete: completedRequired.length === required.length,
            },
        });
    } catch (error) {
        console.error('Failed to get progress:', error);
        res.status(500).json({ error: 'Failed to get progress' });
    }
});

// Start module
trainingRouter.post('/api/training/progress/:contractorId/start/:moduleId', async (req, res) => {
    try {
        // Check if exists
        const existing = await db.select()
            .from(trainingProgress)
            .where(and(
                eq(trainingProgress.contractorId, req.params.contractorId),
                eq(trainingProgress.moduleId, req.params.moduleId)
            ))
            .limit(1);

        if (existing.length > 0) {
            return res.json(existing[0]);
        }

        const progress = {
            id: uuidv4(),
            contractorId: req.params.contractorId,
            moduleId: req.params.moduleId,
            startedAt: new Date(),
            passed: false,
            attempts: 0,
        };

        await db.insert(trainingProgress).values(progress);
        res.status(201).json(progress);
    } catch (error) {
        console.error('Failed to start module:', error);
        res.status(500).json({ error: 'Failed to start module' });
    }
});

// Mark video watched
trainingRouter.post('/api/training/progress/:contractorId/video-complete/:moduleId', async (req, res) => {
    try {
        await db.update(trainingProgress)
            .set({ videoWatchedAt: new Date() })
            .where(and(
                eq(trainingProgress.contractorId, req.params.contractorId),
                eq(trainingProgress.moduleId, req.params.moduleId)
            ));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to mark video watched:', error);
        res.status(500).json({ error: 'Failed to mark video watched' });
    }
});

// Submit quiz
trainingRouter.post('/api/training/progress/:contractorId/quiz/:moduleId', async (req, res) => {
    try {
        const modules = await db.select()
            .from(trainingModules)
            .where(eq(trainingModules.id, req.params.moduleId))
            .limit(1);

        if (modules.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        const mod = modules[0];
        const { answers } = req.body;

        if (!answers || !Array.isArray(answers)) {
            return res.status(400).json({ error: 'Answers array required' });
        }

        const questions = (mod.quizQuestions as any[]) || [];

        if (answers.length !== questions.length) {
            return res.status(400).json({ error: `Expected ${questions.length} answers` });
        }

        // Score
        let correct = 0;
        const results = questions.map((q, i) => {
            const isCorrect = answers[i] === q.correctIndex;
            if (isCorrect) correct++;
            return { question: q.question, yourAnswer: answers[i], correctAnswer: q.correctIndex, isCorrect };
        });

        const score = Math.round((correct / questions.length) * 100);
        const passed = score >= (mod.passThreshold || 80);

        // Get current progress
        const prog = await db.select()
            .from(trainingProgress)
            .where(and(
                eq(trainingProgress.contractorId, req.params.contractorId),
                eq(trainingProgress.moduleId, req.params.moduleId)
            ))
            .limit(1);

        await db.update(trainingProgress)
            .set({
                quizScore: score,
                passed,
                attempts: (prog[0]?.attempts || 0) + 1,
                completedAt: passed ? new Date() : null,
            })
            .where(and(
                eq(trainingProgress.contractorId, req.params.contractorId),
                eq(trainingProgress.moduleId, req.params.moduleId)
            ));

        // Check if all training complete
        if (passed) {
            await updateOverallTrainingStatus(req.params.contractorId);
        }

        res.json({
            score,
            passed,
            passThreshold: mod.passThreshold || 80,
            correct,
            total: questions.length,
            results,
            canRetry: !passed,
        });
    } catch (error) {
        console.error('Failed to submit quiz:', error);
        res.status(500).json({ error: 'Failed to submit quiz' });
    }
});

async function updateOverallTrainingStatus(contractorId: string) {
    try {
        const required = await db.select()
            .from(trainingModules)
            .where(and(
                eq(trainingModules.isActive, true),
                eq(trainingModules.isRequired, true)
            ));

        const progress = await db.select()
            .from(trainingProgress)
            .where(eq(trainingProgress.contractorId, contractorId));

        const allPassed = required.every(mod =>
            progress.some(p => p.moduleId === mod.id && p.passed)
        );

        if (allPassed) {
            await db.update(partnerApplications)
                .set({
                    trainingStatus: 'complete',
                    trainingCompletedAt: new Date(),
                    status: 'training_complete',
                    updatedAt: new Date(),
                })
                .where(eq(partnerApplications.contractorId, contractorId));
        }
    } catch (error) {
        console.error('Failed to update training status:', error);
    }
}

// Admin: Create module
trainingRouter.post('/api/training/admin/modules', async (req, res) => {
    try {
        const { slug, title, description, durationMinutes, videoUrl, thumbnailUrl, quizQuestions, passThreshold, orderIndex, isRequired } = req.body;

        if (!slug || !title) {
            return res.status(400).json({ error: 'Slug and title required' });
        }

        const mod = {
            id: uuidv4(),
            slug,
            title,
            description: description || null,
            durationMinutes: durationMinutes || 10,
            videoUrl: videoUrl || null,
            thumbnailUrl: thumbnailUrl || null,
            quizQuestions: quizQuestions || [],
            passThreshold: passThreshold || 80,
            orderIndex: orderIndex || 0,
            isRequired: isRequired !== false,
            isActive: true,
        };

        await db.insert(trainingModules).values(mod);
        res.status(201).json(mod);
    } catch (error) {
        console.error('Failed to create module:', error);
        res.status(500).json({ error: 'Failed to create module' });
    }
});

// Admin: Update module
trainingRouter.put('/api/training/admin/modules/:id', async (req, res) => {
    try {
        const updates = req.body;
        delete updates.id;

        await db.update(trainingModules)
            .set(updates)
            .where(eq(trainingModules.id, req.params.id));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to update module:', error);
        res.status(500).json({ error: 'Failed to update module' });
    }
});

// Seed default modules if none exist
trainingRouter.post('/api/training/admin/seed', async (req, res) => {
    try {
        const existing = await db.select().from(trainingModules).limit(1);
        if (existing.length > 0) {
            return res.json({ message: 'Modules already exist' });
        }

        const defaultModules = [
            {
                id: uuidv4(),
                slug: 'customer-service-excellence',
                title: 'Customer Service Excellence',
                description: 'Learn exceptional customer service skills.',
                durationMinutes: 10,
                orderIndex: 1,
                isRequired: true,
                isActive: true,
                passThreshold: 80,
                quizQuestions: [
                    { question: 'What should you do when arriving at a property?', options: ['Start working immediately', 'Introduce yourself and confirm the job', 'Wait outside', 'Call the office'], correctIndex: 1 },
                    { question: 'How should you handle a complaint?', options: ['Ignore it', 'Argue', 'Listen and work towards a solution', 'Leave'], correctIndex: 2 },
                ],
            },
            {
                id: uuidv4(),
                slug: 'health-safety-basics',
                title: 'Health & Safety Basics',
                description: 'Essential safety practices.',
                durationMinutes: 10,
                orderIndex: 2,
                isRequired: true,
                isActive: true,
                passThreshold: 80,
                quizQuestions: [
                    { question: 'What should you check before starting work?', options: ['TV schedule', 'Hazards and utilities', 'Parking only', 'Nothing'], correctIndex: 1 },
                    { question: 'When working at height, what is essential?', options: ['Speed', 'Appropriate safety equipment', 'Someone holding ladder casually', 'Nothing'], correctIndex: 1 },
                ],
            },
            {
                id: uuidv4(),
                slug: 'handy-standards',
                title: 'The Handy Standards',
                description: 'Learn about Handy partner standards.',
                durationMinutes: 10,
                orderIndex: 3,
                isRequired: true,
                isActive: true,
                passThreshold: 80,
                quizQuestions: [
                    { question: 'What is the partner commission rate?', options: ['5-10%', '10-15%', '15-20%', '25-30%'], correctIndex: 2 },
                    { question: 'How quickly should you respond to inquiries?', options: ['Within a week', 'When available', 'Within 2 hours during business hours', 'Only weekdays'], correctIndex: 2 },
                ],
            },
        ];

        await db.insert(trainingModules).values(defaultModules);
        res.status(201).json({ message: 'Seeded 3 modules', modules: defaultModules });
    } catch (error) {
        console.error('Failed to seed modules:', error);
        res.status(500).json({ error: 'Failed to seed modules' });
    }
});
