import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, Edit2, Trash2, Plus, ArrowRight } from 'lucide-react';

interface Task {
    description: string;
    estimatedHours: number;
    confidence?: 'high' | 'medium' | 'low';
}

interface TaskReviewCardProps {
    tasks: Task[];
    onTasksConfirmed: (confirmedTasks: Task[]) => void;
    onTaskEdit?: (index: number, newDescription: string) => void;
    onTaskRemove?: (index: number) => void;
    onTaskAdd?: (newTask: string) => void;
    isLoading?: boolean;
    hideConfirmButton?: boolean;
    theme?: 'light' | 'dark';
}

export default function TaskReviewCard({
    tasks: initialTasks,
    onTasksConfirmed,
    onTaskEdit,
    onTaskRemove,
    onTaskAdd,
    isLoading = false,
    hideConfirmButton = false,
    theme = 'light'
}: TaskReviewCardProps) {
    const [tasks, setTasks] = useState<Task[]>(initialTasks);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isAddingTask, setIsAddingTask] = useState(false);
    const [newTaskValue, setNewTaskValue] = useState('');

    const handleStartEdit = (index: number, currentDescription: string) => {
        setEditingIndex(index);
        setEditValue(currentDescription);
    };

    const handleSaveEdit = (index: number) => {
        if (editValue.trim()) {
            const updatedTasks = [...tasks];
            updatedTasks[index] = { ...updatedTasks[index], description: editValue.trim() };
            setTasks(updatedTasks);
            onTaskEdit?.(index, editValue.trim());
        }
        setEditingIndex(null);
        setEditValue('');
    };

    const handleCancelEdit = () => {
        setEditingIndex(null);
        setEditValue('');
    };

    const handleRemove = (index: number) => {
        const updatedTasks = tasks.filter((_, i) => i !== index);
        setTasks(updatedTasks);
        onTaskRemove?.(index);
    };

    const handleAddTask = () => {
        if (newTaskValue.trim()) {
            const newTask: Task = {
                description: newTaskValue.trim(),
                estimatedHours: 1,
                confidence: 'medium'
            };
            setTasks([...tasks, newTask]);
            onTaskAdd?.(newTaskValue.trim());
            setNewTaskValue('');
            setIsAddingTask(false);
        }
    };

    const handleConfirm = () => {
        onTasksConfirmed(tasks);
    };

    const getConfidenceBadge = (confidence?: 'high' | 'medium' | 'low') => {
        if (!confidence) return null;

        const styles = {
            high: 'bg-green-100 text-green-700 border-green-200',
            medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
            low: 'bg-orange-100 text-orange-700 border-orange-200'
        };

        const labels = {
            high: 'HIGH CONFIDENCE',
            medium: 'MEDIUM CONFIDENCE',
            low: 'NEEDS REVIEW'
        };

        return (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${styles[confidence]}`}>
                {labels[confidence]}
            </span>
        );
    };

    const formatHours = (hours: number) => {
        if (hours === 1) return '~1 hour';
        if (hours < 1) return '~30 mins';
        return `~${hours}-${hours + 1} hours`;
    };

    return (
        <div className="w-full max-w-2xl mx-auto px-4 py-6 space-y-6">


            {/* Task List */}
            <div className="space-y-3">
                {tasks.map((task, index) => (
                    <Card key={index} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                                {/* Task Content */}
                                <div className="flex-1 space-y-2">
                                    {/* Confidence Badge */}
                                    {task.confidence && (
                                        <div className="flex">
                                            {getConfidenceBadge(task.confidence)}
                                        </div>
                                    )}

                                    {/* Description - Editable */}
                                    {editingIndex === index ? (
                                        <div className="space-y-2">
                                            <Input
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                className="text-base"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveEdit(index);
                                                    if (e.key === 'Escape') handleCancelEdit();
                                                }}
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleSaveEdit(index)}
                                                    className="bg-green-600 hover:bg-green-700 text-white"
                                                >
                                                    Save
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={handleCancelEdit}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="text-slate-800 font-medium text-base leading-relaxed">
                                                {task.description}
                                            </p>
                                            <p className="text-slate-500 text-sm">
                                                {formatHours(task.estimatedHours)}
                                            </p>
                                        </>
                                    )}
                                </div>

                                {/* Action Buttons */}
                                {editingIndex !== index && (
                                    <div className="flex gap-2 pt-1">
                                        <button
                                            onClick={() => handleStartEdit(index, task.description)}
                                            className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                                            aria-label="Edit task"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleRemove(index)}
                                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                            aria-label="Remove task"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Add Task Section */}
            {isAddingTask ? (
                <Card className="border-slate-200 border-dashed shadow-sm">
                    <CardContent className="p-4 space-y-3">
                        <Input
                            value={newTaskValue}
                            onChange={(e) => setNewTaskValue(e.target.value)}
                            placeholder="Describe the additional job..."
                            className="text-base"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddTask();
                                if (e.key === 'Escape') {
                                    setIsAddingTask(false);
                                    setNewTaskValue('');
                                }
                            }}
                        />
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                onClick={handleAddTask}
                                disabled={!newTaskValue.trim()}
                                className="bg-amber-400 hover:bg-amber-500 text-slate-900"
                            >
                                Add Job
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setIsAddingTask(false);
                                    setNewTaskValue('');
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <button
                    onClick={() => setIsAddingTask(true)}
                    className={`w-full p-4 border-2 border-dashed rounded-lg transition-colors flex items-center justify-center gap-2 font-medium ${theme === 'dark'
                        ? 'border-slate-700 text-slate-300 hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400'
                        : 'border-slate-300 text-slate-600 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-600'
                        }`}
                >
                    <Plus className="w-5 h-5" />
                    Add another job
                </button>
            )}

            {/* Confirm Button */}
            {!hideConfirmButton && (
                <Button
                    onClick={handleConfirm}
                    disabled={isLoading || tasks.length === 0}
                    className="w-full py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold text-lg rounded-xl shadow-lg hover:shadow-xl transition-all"
                >
                    {isLoading ? (
                        'Processing...'
                    ) : (
                        <>
                            Looks good → Continue
                            <ArrowRight className="w-5 h-5 ml-2" />
                        </>
                    )}
                </Button>
            )
            }
        </div >
    );
}
