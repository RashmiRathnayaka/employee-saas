import { Button } from "./ui/button";
import { strings } from "../strings";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 py-12 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {strings.common.retry}
        </Button>
      ) : null}
    </div>
  );
}
