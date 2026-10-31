import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "../../lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof RadixDialog.Content>) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <RadixDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl",
          className,
        )}
        {...props}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof RadixDialog.Title>) {
  return <RadixDialog.Title className={cn("text-lg font-semibold text-slate-900", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof RadixDialog.Description>) {
  return <RadixDialog.Description className={cn("mt-1 text-sm text-slate-600", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}
