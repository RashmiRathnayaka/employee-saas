import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { CompanyTimeInput } from "../lib/companyTimeInput";
import { strings } from "../strings";

/** A date box and a time box for one moment, both in company time. See
 * lib/companyTimeInput.ts for why they're two boxes. */
export function CompanyTimeFields({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: CompanyTimeInput;
  onChange: (value: CompanyTimeInput) => void;
  error?: string | undefined;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      <div className="mt-1.5 grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-date`} className="text-xs text-slate-500">
            {label}: {strings.corrections.date}
          </Label>
          <Input id={`${id}-date`} type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-time`} className="text-xs text-slate-500">
            {label}: {strings.corrections.time}
          </Label>
          <Input id={`${id}-time`} type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
