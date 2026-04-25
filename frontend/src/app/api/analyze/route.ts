import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const agentResp = await fetch(`${AGENT_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!agentResp.ok) {
      const errorText = await agentResp.text();
      return NextResponse.json(
        { error: `Agent returned ${agentResp.status}: ${errorText}` },
        { status: agentResp.status },
      );
    }

    const data = await agentResp.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to reach analysis agent: ${message}` },
      { status: 502 },
    );
  }
}
