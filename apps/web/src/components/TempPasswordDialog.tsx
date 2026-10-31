import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { strings } from "../strings";

export function TempPasswordDialog({
  open,
  onOpenChange,
  password,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  password: string | null;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!password) return;
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
    >
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogTitle>{title ?? strings.tempPassword.title}</DialogTitle>
        <DialogDescription>{strings.tempPassword.warning}</DialogDescription>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
          <code className="flex-1 select-all break-all text-sm font-semibold text-slate-900">{password}</code>
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            {copied ? strings.common.copied : strings.common.copy}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{strings.tempPassword.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
