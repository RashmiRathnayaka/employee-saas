import { useEffect, useState } from "react";
import type { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import {
  CreateSiteRequestSchema,
  type CompanySettingsDto,
  type PaginatedResponse,
  type SiteDto,
} from "@employee-saas/shared";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Pagination } from "../components/Pagination";
import { StatusBadge } from "../components/StatusBadge";
import { api, ApiClientError } from "../lib/apiClient";
import { applyApiErrorToForm, getErrorMessage } from "../lib/errorMapping";
import { useCompanySettings } from "../lib/queries";
import { useToast } from "../lib/toast";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { strings } from "../strings";

const PAGE_SIZE = 20;

// z.input because the schema turns an emptied address into null on the way out.
type SiteFormValues = z.input<typeof CreateSiteRequestSchema>;

function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function MapLink({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
  return (
    <a
      href={googleMapsUrl(latitude, longitude)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

export function SitesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SiteDto | null>(null);
  const [deactivating, setDeactivating] = useState<SiteDto | null>(null);
  const [deleting, setDeleting] = useState<SiteDto | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const { data: settings } = useCompanySettings();

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
  if (type !== "all") params.set("type", type);
  if (active !== "all") params.set("active", active);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sites", { page, debouncedSearch, type, active }],
    queryFn: () => api.get<PaginatedResponse<SiteDto>>(`/sites?${params.toString()}`),
  });

  const statusMutation = useMutation({
    mutationFn: (values: { id: string; isActive: boolean }) =>
      api.patch(`/sites/${values.id}/status`, { isActive: values.isActive }),
    onSuccess: async (_result, values) => {
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
      toast.success(values.isActive ? strings.sites.activated : strings.sites.deactivated);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/sites/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
      toast.success(strings.sites.deleted);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (error instanceof ApiClientError && error.code === "MODULE_DISABLED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{strings.sites.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title={strings.sites.moduleOff} description={strings.sites.moduleOffHint} />
        </CardContent>
      </Card>
    );
  }

  const filtering = !!debouncedSearch.trim() || type !== "all" || active !== "all";

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{strings.sites.title}</CardTitle>
        <Button size="sm" disabled={!settings} onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {strings.sites.newSite}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input
            placeholder={strings.sites.search}
            aria-label={strings.sites.search}
            className="max-w-xs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40" aria-label={strings.sites.type}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{strings.sites.allTypes}</SelectItem>
              <SelectItem value="OFFICE">{strings.sites.office}</SelectItem>
              <SelectItem value="EXTERNAL">{strings.sites.external}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={active}
            onValueChange={(value) => {
              setActive(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40" aria-label={strings.table.status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{strings.sites.allStatuses}</SelectItem>
              <SelectItem value="true">{strings.sites.active}</SelectItem>
              <SelectItem value="false">{strings.sites.inactive}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={strings.common.somethingWentWrong} onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          filtering ? (
            <EmptyState title={strings.sites.noMatches} />
          ) : (
            <EmptyState title={strings.sites.noSites} description={strings.sites.noSitesHint} />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-4">{strings.sites.name}</th>
                    <th className="py-2 pr-4">{strings.sites.type}</th>
                    <th className="py-2 pr-4">{strings.sites.location}</th>
                    <th className="py-2 pr-4">{strings.sites.radiusMeters}</th>
                    <th className="py-2 pr-4">GPS</th>
                    <th className="py-2 pr-4">{strings.table.status}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((site) => (
                    <tr key={site.id} className="border-b border-slate-100">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900">{site.name}</p>
                        {site.address ? <p className="text-xs text-slate-500">{site.address}</p> : null}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {site.type === "OFFICE" ? strings.sites.office : strings.sites.external}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {site.latitude !== null && site.longitude !== null ? (
                          <>
                            <p>
                              {site.latitude}, {site.longitude}
                            </p>
                            <MapLink latitude={site.latitude} longitude={site.longitude} label={strings.sites.openInMaps} />
                          </>
                        ) : (
                          strings.sites.noLocation
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{site.radiusMeters}</td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {site.gpsRequired ? strings.sites.gpsYes : strings.sites.gpsNo}
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={site.isActive ? "ACTIVE" : "INACTIVE"} />
                      </td>
                      <td className="py-2.5">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`${strings.sites.edit} ${site.name}`}
                            onClick={() => setEditing(site)}
                          >
                            {strings.sites.edit}
                          </Button>
                          {site.isActive ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={`${strings.sites.deactivate} ${site.name}`}
                              onClick={() => setDeactivating(site)}
                            >
                              {strings.sites.deactivate}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={`${strings.sites.activate} ${site.name}`}
                              disabled={statusMutation.isPending}
                              onClick={() => statusMutation.mutate({ id: site.id, isActive: true })}
                            >
                              {strings.sites.activate}
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`${strings.sites.delete} ${site.name}`}
                            onClick={() => setDeleting(site)}
                          >
                            {strings.sites.delete}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </CardContent>

      {creating && settings ? <SiteDialog settings={settings} onClose={() => setCreating(false)} /> : null}
      {editing ? <SiteDialog site={editing} onClose={() => setEditing(null)} /> : null}

      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={strings.sites.deactivateConfirm}
        description={strings.sites.deactivateConfirmHint}
        confirmLabel={strings.sites.deactivate}
        // The mutation shows its own error toast, so a failure stops here.
        onConfirm={() =>
          deactivating && statusMutation.mutateAsync({ id: deactivating.id, isActive: false }).catch(() => undefined)
        }
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={strings.sites.deleteConfirm}
        description={strings.sites.deleteConfirmHint}
        confirmLabel={strings.sites.delete}
        onConfirm={() => deleting && deleteMutation.mutateAsync(deleting.id).catch(() => undefined)}
      />
    </Card>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-red-600">
      {message}
    </p>
  );
}

/** An emptied coordinate is null ("no position"), and anything that isn't a
 * number stays NaN so the schema reports it instead of it quietly vanishing. */
function parseCoordinate(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number(value);
}

/** Create when given `settings` (for the defaults), edit when given `site`. */
function SiteDialog({
  site,
  settings,
  onClose,
}: {
  site?: SiteDto;
  settings?: CompanySettingsDto;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    clearErrors,
    control,
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SiteFormValues>({
    resolver: zodResolver(CreateSiteRequestSchema),
    defaultValues: {
      name: site?.name ?? "",
      type: site?.type ?? "OFFICE",
      address: site?.address ?? "",
      latitude: site?.latitude ?? null,
      longitude: site?.longitude ?? null,
      radiusMeters: site?.radiusMeters ?? settings?.gpsRadiusMeters,
      gpsRequired: site?.gpsRequired ?? settings?.gpsCheckinEnabledDefault ?? false,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: SiteFormValues) =>
      site ? api.patch(`/sites/${site.id}`, values) : api.post("/sites", values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
      toast.success(strings.sites.saved);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.code === "SITE_NAME_TAKEN") {
        setError("name", { type: "server", message: strings.errors.SITE_NAME_TAKEN });
      } else if (!applyApiErrorToForm(error, setError)) {
        toast.error(getErrorMessage(error));
      }
    },
  });

  const latitude = watch("latitude");
  const longitude = watch("longitude");
  const gpsRequired = watch("gpsRequired");

  // The server's location errors depend on all three of these together, so a
  // change to any of them can resolve an error shown on another field. The
  // form's own re-check only looks at the field being edited.
  const latitudeErrorType = errors.latitude?.type;
  const longitudeErrorType = errors.longitude?.type;
  useEffect(() => {
    if (latitudeErrorType === "server") clearErrors("latitude");
    if (longitudeErrorType === "server") clearErrors("longitude");
    // Only an edit should clear them, not the error arriving, so the error types
    // are deliberately not dependencies.
  }, [latitude, longitude, gpsRequired]);

  const hasValidPosition =
    typeof latitude === "number" && typeof longitude === "number" && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* A tall form: it scrolls rather than pushing Save off a short screen. */}
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogTitle>{site ? strings.sites.editSite : strings.sites.newSite}</DialogTitle>
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={handleSubmit((values) => mutation.mutateAsync(values).catch(() => undefined))}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="site-name">{strings.sites.name}</Label>
              <Input id="site-name" autoFocus {...register("name")} />
              <FieldError message={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-type">{strings.sites.type}</Label>
              <select
                id="site-type"
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                {...register("type")}
              >
                <option value="OFFICE">{strings.sites.office}</option>
                <option value="EXTERNAL">{strings.sites.external}</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="site-address">{strings.sites.addressOptional}</Label>
            <Input id="site-address" {...register("address")} />
            <FieldError message={errors.address?.message} />
          </div>

          <div className="space-y-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="site-latitude">{strings.sites.latitude}</Label>
                <Input id="site-latitude" inputMode="decimal" {...register("latitude", { setValueAs: parseCoordinate })} />
                <FieldError message={errors.latitude?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="site-longitude">{strings.sites.longitude}</Label>
                <Input id="site-longitude" inputMode="decimal" {...register("longitude", { setValueAs: parseCoordinate })} />
                <FieldError message={errors.longitude?.message} />
              </div>
            </div>
            <p className="text-xs text-slate-500">{strings.sites.coordinatesHint}</p>
            {hasValidPosition ? (
              <p className="text-sm">
                <MapLink latitude={latitude} longitude={longitude} label={strings.sites.openInMapsCheck} />
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5 sm:w-1/2 sm:pr-2">
            <Label htmlFor="site-radius">{strings.sites.radiusMeters}</Label>
            <Input id="site-radius" type="number" {...register("radiusMeters", { valueAsNumber: true })} />
            <FieldError message={errors.radiusMeters?.message} />
          </div>

          <div>
            <div className="flex items-center gap-3">
              <Controller
                control={control}
                name="gpsRequired"
                render={({ field }) => (
                  <Checkbox
                    id="site-gps"
                    checked={field.value === true}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <Label htmlFor="site-gps">{strings.sites.gpsRequired}</Label>
            </div>
            <p className="mt-1 text-xs text-slate-500">{strings.sites.gpsRequiredHint}</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {strings.common.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {strings.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
