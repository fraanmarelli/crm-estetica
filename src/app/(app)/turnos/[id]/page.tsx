import { BackLink } from "@/components/back-link";
import { AppointmentView } from "./view";

export default async function EditAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cobrar?: string; vista?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <BackLink fallback="/" />
      <AppointmentView id={id} sp={sp} />
    </div>
  );
}
