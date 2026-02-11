import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
    FileText,
    Clock,
    UserX,
    Calendar,
    PlusCircle,
    ArrowRight,
} from "lucide-react";

interface QuickAction {
    label: string;
    description: string;
    icon: React.ElementType;
    href: string;
    variant?: "default" | "outline" | "secondary";
}

const quickActions: QuickAction[] = [
    {
        label: "Create Quote",
        description: "Generate a new quote",
        icon: PlusCircle,
        href: "/admin/generate-quote",
        variant: "default",
    },
    {
        label: "Pending Jobs",
        description: "View jobs awaiting action",
        icon: Clock,
        href: "/admin/dispatch?status=pending",
        variant: "outline",
    },
    {
        label: "Unassigned Jobs",
        description: "Assign contractors to jobs",
        icon: UserX,
        href: "/admin/dispatch?assigned=false",
        variant: "outline",
    },
    {
        label: "Today's Schedule",
        description: "View today's appointments",
        icon: Calendar,
        href: "/admin/availability",
        variant: "outline",
    },
];

export function QuickActions() {
    const [, setLocation] = useLocation();

    return (
        <Card className="bg-card border-border shadow-sm backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="text-secondary flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Quick Actions
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {quickActions.map((action, index) => (
                        <motion.div
                            key={action.href}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                        >
                            <Button
                                variant={action.variant}
                                className="w-full h-auto py-4 px-4 justify-start gap-3 group"
                                onClick={() => setLocation(action.href)}
                            >
                                <div
                                    className={`p-2 rounded-lg ${
                                        action.variant === "default"
                                            ? "bg-primary-foreground/20"
                                            : "bg-muted"
                                    }`}
                                >
                                    <action.icon className="h-5 w-5" />
                                </div>
                                <div className="flex-1 text-left">
                                    <div className="font-medium">{action.label}</div>
                                    <div
                                        className={`text-xs ${
                                            action.variant === "default"
                                                ? "text-primary-foreground/70"
                                                : "text-muted-foreground"
                                        }`}
                                    >
                                        {action.description}
                                    </div>
                                </div>
                                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Button>
                        </motion.div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

export default QuickActions;
