import { Modal } from "@/components/modal";
import { AppointmentView } from "../../../turnos/[id]/view";

// El turno abierto desde la agenda o la ficha: ventana encima (docs/MAPA.md)
export default async function AppointmentModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cobrar?: string; vista?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <Modal label="Turno">
      <AppointmentView id={id} sp={sp} />
    </Modal>
  );
}
