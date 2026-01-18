
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt, DollarSign, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import ContractorAppShell from '@/components/layout/ContractorAppShell';
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function ExpensesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isAddOpen, setIsAddOpen] = useState(false);

    // Form state
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState('materials');
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [receiptUrl, setReceiptUrl] = useState('');
    const [isUploading, setIsUploading] = useState(false);

    const { data: expenses, isLoading } = useQuery<any[]>({
        queryKey: ['/api/contractor/expenses'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/expenses', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch expenses');
            return res.json();
        }
    });

    const { data: stats, isLoading: isStatsLoading } = useQuery<any>({
        queryKey: ['/api/contractor/stats/financials'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/stats/financials', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch stats');
            return res.json();
        }
    });

    const createMutation = useMutation({
        mutationFn: async (newExpense: any) => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/expenses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(newExpense),
            });
            if (!res.ok) throw new Error('Failed to create expense');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/contractor/expenses'] });
            queryClient.invalidateQueries({ queryKey: ['/api/contractor/stats/financials'] });
            setIsAddOpen(false);
            setDescription('');
            setAmount('');
            setReceiptUrl('');
            toast({ title: "Expense Added", description: "Expense tracked successfully." });
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to add expense.", variant: "destructive" });
        }
    });

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const formData = new FormData();
            formData.append('file', file);

            setIsUploading(true);
            try {
                // Determine if upload needs auth? Assuming simpler upload for now but safer to check.
                // If the upload endpoint is public, this is fine. If protected, add header.
                // Based entirely on upload.ts being generic, it might be public.
                // But let's verify if the USER fails again. 
                // Wait, I should probably add auth just in case if I can attach custom headers to FormData fetch?
                // Standard fetch allows headers with FormData, but don't set Content-Type!

                const token = localStorage.getItem('contractorToken');
                const headers: Record<string, string> = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers,
                    body: formData,
                });
                const data = await res.json();
                if (data.success) {
                    setReceiptUrl(data.url);
                    toast({ title: "Receipt Uploaded", description: "Receipt attached successfully." });
                } else {
                    toast({ title: "Upload Failed", description: data.error || "Could not upload receipt.", variant: "destructive" });
                }
            } catch (error) {
                console.error("Upload error", error);
                toast({ title: "Upload Error", description: "Failed to upload receipt.", variant: "destructive" });
            } finally {
                setIsUploading(false);
            }
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate({
            description,
            amountPence: Math.round(parseFloat(amount) * 100),
            category,
            date: new Date(date).toISOString(),
            receiptUrl,
        });
    };

    // Calculate totals
    const totalExpenses = expenses?.reduce((acc: number, curr: any) => acc + (curr.amountPence || 0), 0) || 0;

    // Simple Income Calculation from stats (mock logic for display if stats structure varies)
    const totalIncome = stats?.jobs?.reduce((acc: number, curr: any) => acc + (curr.amountPence || 0), 0) || 0;
    const profit = totalIncome - totalExpenses;

    if (isLoading) return <div className="p-8 text-center text-slate-500">Loading financials...</div>;

    return (
        <ContractorAppShell title="Bookkeeping">
            <div className="max-w-6xl mx-auto space-y-6 pb-20">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 hidden lg:block">Bookkeeping</h1>
                        <p className="text-slate-500 hidden lg:block">Track your income and expenses</p>
                    </div>
                    <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm">
                                <Plus className="w-4 h-4" /> Add Expense
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-white border-gray-200 text-slate-900 sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>New Expense</DialogTitle>
                            </DialogHeader>
                            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Description</label>
                                    <Input
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        className="bg-white border-gray-200 focus:border-indigo-500"
                                        placeholder="e.g. Screws from Wickes"
                                        required
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Amount (£)</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={amount}
                                            onChange={e => setAmount(e.target.value)}
                                            className="bg-white border-gray-200 focus:border-indigo-500"
                                            placeholder="0.00"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Category</label>
                                        <Select value={category} onValueChange={setCategory}>
                                            <SelectTrigger className="bg-white border-gray-200 focus:border-indigo-500">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border-gray-200">
                                                <SelectItem value="materials">Materials</SelectItem>
                                                <SelectItem value="travel">Travel / Fuel</SelectItem>
                                                <SelectItem value="equipment">Tools & Equipment</SelectItem>
                                                <SelectItem value="marketing">Marketing</SelectItem>
                                                <SelectItem value="insurance">Insurance</SelectItem>
                                                <SelectItem value="other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Receipt (Optional)</label>
                                    <Input
                                        type="file"
                                        onChange={handleFileChange}
                                        className="bg-white border-gray-200 file:text-indigo-600 file:font-semibold hover:file:bg-indigo-50"
                                        accept="image/*,application/pdf"
                                    />
                                    {isUploading && <p className="text-xs text-indigo-600 mt-1 font-medium">Uploading...</p>}
                                    {receiptUrl && <p className="text-xs text-emerald-600 mt-1 font-medium">Receipt attached!</p>}
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Date</label>
                                    <Input
                                        type="date"
                                        value={date}
                                        onChange={e => setDate(e.target.value)}
                                        className="bg-white border-gray-200 focus:border-indigo-500"
                                        required
                                    />
                                </div>
                                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" disabled={createMutation.isPending || isUploading}>
                                    {createMutation.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : 'Save Expense'}
                                </Button>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* Financial Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-500">Total Income</CardTitle>
                            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                                <TrendingUp className="h-4 w-4 text-emerald-600" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-slate-900">£{(totalIncome / 100).toFixed(2)}</div>
                            <p className="text-xs text-slate-500 mt-1">Revenue from completed jobs</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-500">Total Expenses</CardTitle>
                            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center">
                                <TrendingDown className="h-4 w-4 text-rose-600" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-slate-900">£{(totalExpenses / 100).toFixed(2)}</div>
                            <p className="text-xs text-slate-500 mt-1">Materials & Overheads</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-white border-gray-200 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-500">Net Profit</CardTitle>
                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                                <DollarSign className="h-4 w-4 text-indigo-600" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                £{(profit / 100).toFixed(2)}
                            </div>
                            <p className="text-xs text-slate-500 mt-1">Before Tax</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Expenses List */}
                <Card className="bg-white border-gray-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-slate-900">Recent Expenses</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {expenses?.length === 0 ? (
                                <div className="text-slate-500 text-center py-12 flex flex-col items-center">
                                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                                        <Receipt className="w-6 h-6 text-slate-400" />
                                    </div>
                                    <p className="font-medium text-slate-900">No expenses yet</p>
                                    <p className="text-sm text-slate-500">Add materials or travel costs to track spending.</p>
                                </div>
                            ) : (
                                expenses?.map((expense: any) => (
                                    <div key={expense.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-gray-100 hover:border-indigo-200 transition-colors group">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2.5 bg-white border border-gray-200 rounded-full text-slate-500 shadow-sm group-hover:text-indigo-600 group-hover:border-indigo-100 transition-colors">
                                                <Receipt className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-slate-900">{expense.description}</h4>
                                                <p className="text-sm text-slate-500 capitalize">{expense.category} • {format(new Date(expense.date), 'MMM d, yyyy')}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            {expense.receiptUrl && (
                                                <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100">View Receipt</a>
                                            )}
                                            <div className="font-bold text-slate-900 text-lg">
                                                -£{(expense.amountPence / 100).toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ContractorAppShell>
    );
}
