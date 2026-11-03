export type Role =
  | "network_owner"
  | "network_admin"
  | "branch_admin"
  | "reception"
  | "professional";

export type AppointmentStatus = "scheduled" | "completed" | "no_show" | "cancelled";

export type RecallOutcome =
  | "no_answer"
  | "booked"
  | "later"
  | "not_interested"
  | "wrong_number"
  | "opted_out";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  loyalty_points_per_1000: number;
  settings: {
    recall_message?: string;
    weekly_email?: boolean;
    // Identidad visual por organización (colores en hex, logo como URL pública)
    brand?: {
      logo_url?: string;
      primary?: string;
      primary_strong?: string;
      primary_soft?: string;
    };
  } & Record<string, unknown>;
};

export type Branch = { id: string; name: string };

export type Membership = {
  organization_id: string;
  branch_id: string | null;
  role: Role;
};

export type Treatment = {
  id: string;
  name: string;
  category: string | null;
  recall_days: number | null;
  default_price: number | null;
  unit_label: string | null;
};

export type Professional = { id: string; full_name: string; branch_id: string | null };

export type Patient = {
  id: string;
  organization_id: string;
  home_branch_id: string | null;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  dni: string | null;
  birth_date: string | null;
  source: string | null;
  notes: string | null;
  consent_data_at: string | null;
  consent_marketing_at: string | null;
  marketing_opt_out_at: string | null;
  created_at: string;
};

export type AppointmentItemInput = {
  treatment_id: string;
  zone: string;
  quantity: string;
  price: string;
};

// values: lo que el usuario había escrito, para no perderlo si hay un error
export type ActionState = { error?: string; ok?: string; values?: Record<string, string> } | null;
