import { NextRequest, NextResponse } from "next/server";
import { listCards, updateCardStatus, AirwallexError } from "@/lib/airwallex";
import { callTool } from "@/lib/mcpClient";
import { getAgent, getPolicy, createAgent } from "@/lib/store";

/** GET — list existing Company Virtual cards. */
export async function GET() {
  try {
    const cards = await listCards();
    return NextResponse.json({ cards });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST — create a virtual card.
 * Body: { agentId, policyId?, singleUse, limitAmount, currency, ... }
 *
 * projectId is optional — falls back to the agent's stored project_id or "default".
 * policyId: the policy to use for this agent. If the agent doesn't exist yet,
 * it is auto-created referencing that policy (human_provisioned by default).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const limitAmount = Number(body.limitAmount);
    if (!limitAmount || limitAmount <= 0) {
      return NextResponse.json({ error: "limitAmount must be > 0" }, { status: 400 });
    }
    if (!body.agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    const agentId = String(body.agentId);
    const policyId = String(body.policyId || "");

    // Resolve project_id: use body value if provided, else look up the existing agent.
    const existingAgent = await getAgent(agentId);
    const projectId = String(body.projectId || existingAgent?.project_id || "default");

    // If a policyId is given and the agent doesn't exist yet, auto-register it.
    if (policyId && !existingAgent) {
      const policy = await getPolicy(policyId);
      if (policy) {
        await createAgent({
          agent_id: agentId,
          display_name: agentId,
          project_id: projectId,
          issuance_mode: "human_provisioned",
          policy_id: policyId,
        });
      }
    }

    // Card issuance goes through the shared MCP server (provision_card) — the
    // same tool the headless agent runner uses. No direct create path here.
    const card = await callTool<{ refused?: boolean; reason?: string; message?: string } & Record<string, unknown>>("provision_card", {
      agent_id: agentId,
      project_id: projectId,
      single_use: Boolean(body.singleUse),
      limit_amount: limitAmount,
      currency: (body.currency || "USD").toUpperCase(),
      expires_on: body.expiresOn || undefined,
      allowed_merchant_categories: Array.isArray(body.allowedMerchantCategories)
        ? body.allowedMerchantCategories.map(String)
        : undefined,
    });
    if (card?.refused) {
      return NextResponse.json({ error: card.message || card.reason }, { status: 422 });
    }
    return NextResponse.json({ card });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH — freeze (INACTIVE), unfreeze (ACTIVE), or cancel (CLOSED) a card. Body: { cardId, status } */
export async function PATCH(req: NextRequest) {
  try {
    const { cardId, status } = await req.json();
    if (!cardId || !["ACTIVE", "INACTIVE", "CLOSED"].includes(status)) {
      return NextResponse.json({ error: "cardId and status (ACTIVE|INACTIVE|CLOSED) required" }, { status: 400 });
    }
    const card = await updateCardStatus(String(cardId), status as "ACTIVE" | "INACTIVE" | "CLOSED");
    return NextResponse.json({ card });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const status = err instanceof AirwallexError ? err.status : 500;
  return NextResponse.json(
    {
      error: err instanceof Error ? err.message : "Card operation failed",
      details: err instanceof AirwallexError ? err.body : undefined,
    },
    { status },
  );
}
