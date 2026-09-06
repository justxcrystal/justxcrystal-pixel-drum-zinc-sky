import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-2xl bg-surface-2 px-4 font-medium text-fg shadow-border outline-none",
        "placeholder:text-faint",
        "focus-visible:shadow-border-hover",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
