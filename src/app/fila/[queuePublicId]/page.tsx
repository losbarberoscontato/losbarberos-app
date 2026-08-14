import { WalkinQueue } from "@/components/walkin-queue";

export default async function WalkinQueuePage({ params }: { params: Promise<{ queuePublicId: string }> }) {
  const { queuePublicId } = await params;
  return <WalkinQueue queuePublicId={queuePublicId} />;
}
