import { ExportSheetRoute } from "@/components/ExportSheet";

export const dynamic = "force-dynamic";

export default async function InterceptedExport({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExportSheetRoute recordingId={id} />;
}
