import React, { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

interface ProductizedService {
    id: string;
    skuCode: string;
    name: string;
    pricePence: number;
    category: string | null;
}

interface SkuSelectorDropdownProps {
    onSkuSelected: (sku: ProductizedService) => void;
    disabled?: boolean;
}

export function SkuSelectorDropdown({ onSkuSelected, disabled }: SkuSelectorDropdownProps) {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("");

    const { data: skus = [], isLoading } = useQuery({
        queryKey: ['skus'],
        queryFn: async () => {
            const res = await fetch('/api/skus');
            if (!res.ok) throw new Error('Failed to fetch SKUs');
            return res.json() as Promise<ProductizedService[]>;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                    disabled={disabled || isLoading}
                >
                    {value
                        ? skus.find((sku) => sku.skuCode === value)?.skuCode
                        : "Select SKU..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search SKUs..." />
                    <CommandList>
                        <CommandEmpty>No SKU found.</CommandEmpty>
                        <CommandGroup>
                            {skus.map((sku) => (
                                <CommandItem
                                    key={sku.id}
                                    value={sku.skuCode}
                                    onSelect={(currentValue) => {
                                        setValue(currentValue === value ? "" : currentValue);
                                        onSkuSelected(sku);
                                        setOpen(false);
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === sku.skuCode ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <div className="flex flex-col w-full">
                                        <div className="flex justify-between items-center">
                                            <span className="font-medium">{sku.skuCode}</span>
                                            <Badge variant="secondary">
                                                £{(sku.pricePence / 100).toFixed(2)}
                                            </Badge>
                                        </div>
                                        <span className="text-xs text-muted-foreground truncate" title={sku.name}>
                                            {sku.name}
                                        </span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
