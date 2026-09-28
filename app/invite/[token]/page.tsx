import { AcceptInvite } from "@/components/AcceptInvite";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <AcceptInvite token={token} />
    </main>
  );
}
