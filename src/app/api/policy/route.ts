import { NextResponse } from "next/server";
import {
  readStore,
  createPolicy,
  updatePolicy,
  deletePolicy,
  createAgent,
  updateAgent,
  deleteAgent,
} from "@/lib/store";
import type { Policy, Agent } from "@/lib/store";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function GET() {
  const store = await readStore();
  return NextResponse.json({
    policies: Object.values(store.policies),
    agents: Object.values(store.agents),
    approvals: store.approvals,
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const type: string = body.type ?? "policy";

  if (type === "policy") {
    const { policy_id, display_name, currency, total_budget, per_transaction_cap,
            allowed_merchant_categories, card_expiry_days, velocity_max_per_hour } =
      body as Partial<Policy>;

    if (!policy_id || !SLUG_RE.test(policy_id)) {
      return NextResponse.json(
        { error: "policy_id must be a lowercase slug (letters, digits, hyphens; must start with a letter/digit)" },
        { status: 400 },
      );
    }
    if (!display_name?.trim()) {
      return NextResponse.json({ error: "display_name is required" }, { status: 400 });
    }

    try {
      // Only include known Policy fields — drop 'type' and any other UI extras.
      const policy = await createPolicy({
        policy_id,
        display_name,
        currency: currency || "USD",
        total_budget: total_budget ?? 500,
        per_transaction_cap: per_transaction_cap ?? 100,
        allowed_merchant_categories: allowed_merchant_categories ?? [],
        card_expiry_days: card_expiry_days ?? 30,
        velocity_max_per_hour: velocity_max_per_hour ?? 10,
      });
      return NextResponse.json({ policy }, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to create policy" },
        { status: 409 },
      );
    }
  }

  if (type === "agent") {
    const { agent_id, display_name, project_id, issuance_mode, policy_id } =
      body as Partial<Agent>;

    if (!agent_id || !SLUG_RE.test(agent_id)) {
      return NextResponse.json(
        { error: "agent_id must be a lowercase slug (letters, digits, hyphens; must start with a letter/digit)" },
        { status: 400 },
      );
    }
    if (!display_name?.trim()) {
      return NextResponse.json({ error: "display_name is required" }, { status: 400 });
    }
    if (!project_id?.trim()) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    }
    if (!issuance_mode) {
      return NextResponse.json({ error: "issuance_mode is required" }, { status: 400 });
    }
    if (!policy_id?.trim()) {
      return NextResponse.json({ error: "policy_id is required" }, { status: 400 });
    }

    try {
      // Only include known Agent fields — drop 'type' and any other UI extras.
      const agent = await createAgent({ agent_id, display_name, project_id, issuance_mode, policy_id });
      return NextResponse.json({ agent }, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to create agent" },
        { status: 409 },
      );
    }
  }

  return NextResponse.json({ error: `Unknown type "${type}"` }, { status: 400 });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const type: string = body.type ?? "policy";

  if (type === "policy") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { policy_id, type: _t, ...patch } = body as Partial<Policy> & { policy_id: string; type?: string };
    if (!policy_id) {
      return NextResponse.json({ error: "policy_id is required" }, { status: 400 });
    }
    const policy = await updatePolicy(policy_id, patch);
    if (!policy) {
      return NextResponse.json({ error: `Policy "${policy_id}" not found` }, { status: 404 });
    }
    return NextResponse.json({ policy });
  }

  if (type === "agent") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { agent_id, type: _t, ...patch } = body as Partial<Agent> & { agent_id: string; type?: string };
    if (!agent_id) {
      return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
    }
    const agent = await updateAgent(agent_id, patch);
    if (!agent) {
      return NextResponse.json({ error: `Agent "${agent_id}" not found` }, { status: 404 });
    }
    return NextResponse.json({ agent });
  }

  return NextResponse.json({ error: `Unknown type "${type}"` }, { status: 400 });
}

export async function DELETE(req: Request) {
  const body = await req.json();
  const type: string = body.type ?? "agent";

  if (type === "policy") {
    const { policy_id } = body as { policy_id: string };
    if (!policy_id) {
      return NextResponse.json({ error: "policy_id is required" }, { status: 400 });
    }
    try {
      const ok = await deletePolicy(policy_id);
      if (!ok) return NextResponse.json({ error: `Policy "${policy_id}" not found` }, { status: 404 });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Delete failed" }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  }

  if (type === "agent") {
    const { agent_id } = body as { agent_id: string };
    if (!agent_id) {
      return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
    }
    const ok = await deleteAgent(agent_id);
    if (!ok) {
      return NextResponse.json({ error: `Agent "${agent_id}" not found` }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: `Unknown type "${type}"` }, { status: 400 });
}
