import type { LegacyImportProgress, LegacyImportResult } from "@/lib/legacyPatientsImport";

export type LegacyImportJob = {
  importing: boolean;
  progress: LegacyImportProgress | null;
  result: LegacyImportResult | null;
  error: string | null;
  fileName: string | null;
};

let job: LegacyImportJob = {
  importing: false,
  progress: null,
  result: null,
  error: null,
  fileName: null,
};

const listeners = new Set<() => void>();

export function getLegacyImportJob(): LegacyImportJob {
  return job;
}

export function subscribeLegacyImportJob(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(next: Partial<LegacyImportJob>) {
  job = { ...job, ...next };
  listeners.forEach((l) => l());
}

export async function startLegacyImport(file: File): Promise<LegacyImportResult> {
  if (job.importing) {
    throw new Error("An import is already running. Wait for it to finish.");
  }
  emit({
    importing: true,
    progress: { phase: "reading", processed: 0, total: 0, inserted: 0, updated: 0, skipped: 0 },
    result: null,
    error: null,
    fileName: file.name,
  });
  try {
    const { importLegacyPatients } = await import("@/lib/legacyPatientsImport");
    const result = await importLegacyPatients(file, (progress) => emit({ progress }));
    emit({ importing: false, result, progress: null });
    return result;
  } catch (e: any) {
    const message = e?.message || "Import failed";
    emit({ importing: false, error: message, progress: null });
    throw e;
  }
}
