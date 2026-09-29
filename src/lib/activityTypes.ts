export type ActivityType =
  | "card_charge"
  | "fx"
  | "deposit"
  | "topup"
  | "card_lifecycle";

export interface ActivityEvent {
  id: string;
  ts: number; // epoch ms
  type: ActivityType;
  title: string;
  subtitle?: string;
  amount?: number;
  currency?: string;
  direction?: "in" | "out";
  status?: string;
  agent_id?: string;
}
