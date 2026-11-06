import { ExternalLink } from "lucide-react";
import { googleMapsUrl } from "../lib/maps";

export function MapLink({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
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
