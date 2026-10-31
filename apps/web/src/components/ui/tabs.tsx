import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "../../lib/cn";

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn("flex gap-1 border-b border-slate-200", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-900",
        "data-[state=active]:border-[var(--color-primary)] data-[state=active]:text-[var(--color-primary)]",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = RadixTabs.Content;
