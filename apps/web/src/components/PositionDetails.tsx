import { formatDistance } from "@employee-saas/shared";
import { MapLink } from "./MapLink";
import { strings } from "../strings";

/**
 * One exact position, for the people the API gives it to. The API decides that, not this
 * component: a manager's response has no coordinates to show. Callers still only render
 * this for HR and Company Admin, so a mistake on one side doesn't show a position.
 */
export function PositionDetails({
  title,
  latitude,
  longitude,
  accuracyM,
  distanceM,
  mocked,
}: {
  title: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  accuracyM: number | null;
  distanceM: number | null;
  mocked: boolean | null;
}) {
  const hasPosition = latitude != null && longitude != null;

  return (
    <section className="rounded-md border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {hasPosition ? (
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">{strings.position.coordinates}</dt>
            <dd className="text-right text-slate-900">
              {latitude}, {longitude}
            </dd>
          </div>
          {accuracyM !== null ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{strings.position.accuracy}</dt>
              <dd className="text-right text-slate-900">{strings.position.accuracyValue(accuracyM)}</dd>
            </div>
          ) : null}
          {distanceM !== null ? (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">{strings.position.distance}</dt>
              <dd className="text-right text-slate-900">{formatDistance(distanceM)}</dd>
            </div>
          ) : null}
          {mocked ? <p className="text-amber-700">{strings.position.mocked}</p> : null}
          <p className="pt-1">
            <MapLink latitude={latitude} longitude={longitude} label={strings.position.openInMaps} />
          </p>
        </dl>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600">{strings.position.notRecorded}</p>
          <p className="mt-1 text-xs text-slate-500">{strings.position.notRecordedHint}</p>
        </>
      )}
    </section>
  );
}
