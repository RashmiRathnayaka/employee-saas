import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white",
        "data-[state=checked]:border-[var(--color-primary)] data-[state=checked]:bg-[var(--color-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator>
        <Check className="h-3.5 w-3.5 text-[var(--color-primary-foreground)]" aria-hidden />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
