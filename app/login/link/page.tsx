import { MagicLinkConsumer } from "@/components/MagicLinkConsumer";

export const dynamic = "force-dynamic";

export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <MagicLinkConsumer token={token ?? ""} />
    </main>
  );
}
