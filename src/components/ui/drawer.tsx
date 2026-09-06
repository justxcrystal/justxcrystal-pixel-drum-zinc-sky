import { Drawer as Vaul } from "vaul";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Drawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Vaul.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      {children}
    </Vaul.Root>
  );
}

export function DrawerContent({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <Vaul.Portal>
      <Vaul.Overlay className="fixed inset-0 z-50 bg-bg/70" />
      <Vaul.Content
        aria-label={title}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-surface shadow-border outline-none",
          className,
        )}
      >
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-surface-3" />
        <Vaul.Title className="sr-only">{title}</Vaul.Title>
        <div className="overflow-y-auto px-5 pb-8 pt-4">{children}</div>
      </Vaul.Content>
    </Vaul.Portal>
  );
}
