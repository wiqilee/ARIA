"""Async HTTP client for the ARIA MCP Server (JSON-RPC 2.0 over HTTP)."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class MCPClient:
    """Client that speaks MCP protocol to the Rust MCP server."""

    def __init__(self, base_url: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.mcp_url = f"{self.base_url}/mcp"
        self.timeout = timeout
        self._request_id = 0

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def _call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a JSON-RPC 2.0 request to the MCP server."""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params or {},
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(self.mcp_url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        if "error" in data and data["error"] is not None:
            err = data["error"]
            raise MCPError(err.get("code", -1), err.get("message", "Unknown error"))

        return data.get("result")

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call a specific MCP tool and return the parsed result."""
        logger.info("Calling MCP tool: %s", tool_name)

        result = await self._call("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        })

        # MCP tool results come wrapped in content blocks
        if isinstance(result, dict) and "content" in result:
            for block in result["content"]:
                if block.get("type") == "text":
                    text = block.get("text", "{}")
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        return {"raw_text": text}

        return result or {}

    async def initialize(self) -> dict[str, Any]:
        """Initialize the MCP session."""
        result = await self._call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "aria-agent",
                "version": "0.1.0",
            },
        })
        # Send initialized notification
        await self._call("notifications/initialized")
        return result

    async def list_tools(self) -> list[dict[str, Any]]:
        """List all available tools on the MCP server."""
        result = await self._call("tools/list")
        return result.get("tools", []) if isinstance(result, dict) else []

    async def health_check(self) -> bool:
        """Check if the MCP server is healthy."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{self.base_url}/health")
                return resp.status_code == 200
        except Exception:
            return False

    # ── Convenience methods for each tool ───────────────────

    async def check_interactions(
        self,
        drugs: list[dict],
        patient_context: dict | None = None,
    ) -> dict:
        args = {"drugs": drugs}
        if patient_context:
            args["patient_context"] = patient_context
        return await self.call_tool("check_interactions", args)

    async def explain_mechanism(self, drug_a: str, drug_b: str) -> dict:
        return await self.call_tool("explain_mechanism", {
            "drug_a": {"name": drug_a},
            "drug_b": {"name": drug_b},
        })

    async def score_risk(self, interaction: dict, phenotype: dict) -> dict:
        return await self.call_tool("score_risk", {
            "interaction": interaction,
            "phenotype": phenotype,
        })

    async def suggest_alternatives(
        self,
        drug: str,
        reason: str,
        patient_context: dict | None = None,
    ) -> dict:
        args = {"drug": {"name": drug}, "reason": reason}
        if patient_context:
            args["patient_context"] = patient_context
        return await self.call_tool("suggest_alternatives", args)

    async def build_interaction_graph(self, drugs: list[dict]) -> dict:
        return await self.call_tool("build_interaction_graph", {"drugs": drugs})

    async def compute_burden_scores(self, drugs: list[dict]) -> dict:
        return await self.call_tool("compute_burden_scores", {"drugs": drugs})

    async def model_temporal_cascade(
        self,
        drugs: list[dict],
        duration_days: int = 14,
    ) -> dict:
        return await self.call_tool("model_temporal_cascade", {
            "drugs": drugs,
            "timeline": {"duration_days": duration_days},
        })

    async def generate_deprescribing_plan(self, analysis: dict) -> dict:
        return await self.call_tool("generate_deprescribing_plan", {"analysis": analysis})

    async def generate_report(self, analysis: dict) -> dict:
        return await self.call_tool("generate_report", {"analysis": analysis})


class MCPError(Exception):
    """Error from the MCP server."""

    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"MCP Error {code}: {message}")
