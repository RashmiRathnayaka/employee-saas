import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { strings } from "../strings";

export function NotAllowedPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-slate-900">{strings.notAllowed.title}</h1>
      <p className="text-sm text-slate-500">{strings.notAllowed.message}</p>
      <Button asChild>
        <Link to="/">{strings.notAllowed.backHome}</Link>
      </Button>
    </div>
  );
}
