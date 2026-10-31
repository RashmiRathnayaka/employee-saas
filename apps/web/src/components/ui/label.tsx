import * as RadixLabel from "@radix-ui/react-label";
import { cn } from "../../lib/cn";

export function Label({ className, ...props }: React.ComponentProps<typeof RadixLabel.Root>) {
  return <RadixLabel.Root className={cn("text-sm font-medium text-slate-700", className)} {...props} />;
}
