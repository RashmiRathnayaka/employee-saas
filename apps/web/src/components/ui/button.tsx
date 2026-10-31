import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)]",
  {
    variants: {
      variant: {
        primary: "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90",
        secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        ghost: "hover:bg-slate-100 text-slate-900",
        link: "text-[var(--color-primary)] underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-6",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", asChild, ...props }, ref) => {
    if (asChild) {
      return <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
    }
    return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
