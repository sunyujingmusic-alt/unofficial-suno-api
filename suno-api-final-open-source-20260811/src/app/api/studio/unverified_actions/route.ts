import { studioJson, studioOptions } from '@/lib/studioHttp';

export const dynamic = 'force-static';

export async function GET() {
  return studioJson({
    status: 'not_forwarded',
    reason: 'The report marks these write payloads/semantics as unverified. They are intentionally not sent to Suno without a separately authorized, single-submit test.',
    actions: [
      'adjust_speed',
      'reverse_clip',
      'crop',
      'fade',
      'extract_stems',
      'remove_fx',
      'import_audio',
      'record_audio',
      'warp_markers',
      'alternate_takes',
      'project_archive',
      'project_unarchive',
      'project_bookmark',
      'project_metadata',
      'revision_clone',
    ],
    safety: {
      duplicate_paid_probe: 'not performed',
      arbitrary_upstream_proxy: 'not exposed',
      editor_writes: 'not implemented',
      discovered_project_writes: 'disabled unless SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=1, confirm_unverified_write=true, and the shared Studio token matches',
    },
  });
}

export async function OPTIONS() {
  return studioOptions();
}
