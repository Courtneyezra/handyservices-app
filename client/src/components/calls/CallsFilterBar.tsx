import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Search, Filter, X } from "lucide-react";

// Define DateRange locally or import from local types if needed
interface DateRange {
    from: Date | undefined;
    to?: Date | undefined;
}

interface CallsFilterBarProps {
    dateRange: DateRange | undefined;
    setDateRange: (range: DateRange | undefined) => void;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    outcomeFilter: string;
    setOutcomeFilter: (outcome: string) => void;
    hasSkusOnly: boolean;
    setHasSkusOnly: (enabled: boolean) => void;
    onClearFilters: () => void;
}

export function CallsFilterBar({
    dateRange,
    setDateRange,
    searchTerm,
    setSearchTerm,
    outcomeFilter,
    setOutcomeFilter,
    hasSkusOnly,
    setHasSkusOnly,
    onClearFilters,
}: CallsFilterBarProps) {
    return (
        <Card className="mb-4 lg:mb-6 bg-card border-border backdrop-blur-sm transition-colors duration-300">
            <CardContent className="p-4 flex flex-col lg:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2 w-full">
                    <Label>Search</Label>
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search name, phone, or address..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8 bg-background border-border text-foreground placeholder:text-muted-foreground"
                        />
                    </div>
                </div>

                <div className="space-y-2 min-w-[240px]">
                    <Label>Date Range</Label>
                    <div className="flex items-center gap-2">
                        <Input
                            type="date"
                            value={dateRange?.from ? dateRange.from.toISOString().split('T')[0] : ''}
                            onChange={(e) => setDateRange({ ...dateRange, from: e.target.value ? new Date(e.target.value) : undefined, to: dateRange?.to })}
                            className="w-full lg:w-[140px] bg-background border-border text-foreground"
                        />
                        <span className="text-muted-foreground">-</span>
                        <Input
                            type="date"
                            value={dateRange?.to ? dateRange.to.toISOString().split('T')[0] : ''}
                            onChange={(e) => setDateRange({ ...dateRange, from: dateRange?.from, to: e.target.value ? new Date(e.target.value) : undefined })}
                            className="w-full lg:w-[140px] bg-background border-border text-foreground"
                        />
                    </div>
                </div>

                <div className="space-y-2 min-w-[180px]">
                    <Label>Outcome</Label>
                    <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Outcomes" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All Outcomes</SelectItem>
                            <SelectItem value="INSTANT_PRICE">Instant Price</SelectItem>
                            <SelectItem value="VIDEO_QUOTE">Video Quote</SelectItem>
                            <SelectItem value="SITE_VISIT">Site Visit</SelectItem>
                            <SelectItem value="NO_ANSWER">No Answer</SelectItem>
                            <SelectItem value="VOICEMAIL">Voicemail</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center space-x-2 pb-3 min-w-[120px]">
                    <Switch
                        id="has-skus"
                        checked={hasSkusOnly}
                        onCheckedChange={setHasSkusOnly}
                    />
                    <Label htmlFor="has-skus">Has SKUs</Label>
                </div>

                <Button
                    variant="ghost"
                    onClick={onClearFilters}
                    className="mb-0.5"
                >
                    <X className="mr-2 h-4 w-4" />
                    Clear
                </Button>
            </CardContent>
        </Card>
    );
}

// Stub for DatePickerWithRange if it doesn't exist yet, but assuming it does or we'll mock it
// If it doesn't exist, I'll need to create it. I see no "DatePickerWithRange" in the listing of components/ui.
// I'll create a simple input for now or assume I need to create it.
// Checking file components list again... it wasn't listed.
// I will create simple inputs for Start/End date instead if needed, but let's assume the component exists or I'll stub it here.
