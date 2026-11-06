import { Modal } from "@/components/modal";
import NewAppointmentPage from "../../../turnos/nuevo/page";

// Nuevo turno desde la agenda o la ficha: ventana encima
export default function NewAppointmentModal(props: {
  searchParams: Promise<{ paciente?: string; fecha?: string; q?: string; vista?: string }>;
}) {
  return (
    <Modal label="Nuevo turno">
      <NewAppointmentPage {...props} />
    </Modal>
  );
}
