# oab-mcp

The Studio control-plane **MCP server** (ADR-2). It exposes the `studio-cp`
read/write model as MCP tools over **stdio**, so an agent operates the OAB
control plane as a first-class client — "agents do control, humans direct."

## Tools

| Tool | Kind | Arguments |
|------|------|-----------|
| `deploy_list` | read | `cluster?` |
| `deploy_get` | read | `service`, `cluster?` |
| `get_agent_states` | read | `service?`, `cluster?` |
| `deploy_apply` | write | `manifest_yaml`, `cluster?`, `wait?` |
| `deploy_provision` | write | `library`, `template`, `overlay?`, `name`, `namespace?`, `image_tag?`, `provider?`, `fleet?`, `cluster?`, `region?`, `profile?`, `context?`, `expected_principal?` |
| `deploy_provision_agent` | write | `image`, `name`, `namespace?`, `api_key?`, `chat_platform?`, `chat_bot_token?`, `chat_channel_secret?`, `acp_enabled?`, `acp_token?`, `local_config_folder?`, `provider?`, `fleet?`, `cluster?`, `region?`, `profile?`, `context?`, `expected_principal?` |
| `deploy_scale` | write | `name`, `size` (0/1), `cluster?`, `namespace?` |
| `deploy_delete` | write | `resource`, `name`, `cluster?`, `namespace?` |

Reads project each ECS instance onto the canonical 6-state `AgentState`
(ADR-1). `deploy_scale` is 0 (off) / 1 (on) only — an OAB service runs a single
bot token, so >1 would duplicate responders. Both `deploy_provision*` create an
agent that has no stored manifest yet by building a fresh one and applying it
(studio#111) — see `deploy_provision_agent` in `src/lib.rs` for the arg-by-arg
contract.

## Run

```sh
OAB_CLUSTER=oab cargo run -p oab-mcp
```

The server speaks newline-delimited JSON-RPC on stdin/stdout. AWS credentials
are resolved from the standard chain **lazily**, on the first real tool call —
`initialize` and `tools/list` need none. `deploy_delete` resolves the
control-plane bucket from `$OAB_CONTROL_PLANE_BUCKET` (or the caller's account);
none of the write paths read `~/.oabctl/config.toml`.

`cluster` / `namespace` default to `$OAB_CLUSTER` (then `oab`) and `default`,
and are overridable per call.

The managing credential is resolved per ECS cluster from the `fleets.toml`
binding whose `cluster` key matches — a binding that doesn't declare one (which
the console's own writer never emits) leaves the fleet's recorded `region` /
`profile` unread, so the ambient `[default]` chain answers. Both
`deploy_provision*` tools therefore take optional per-call `region` /
`profile` (studio#111), which **layer** onto whatever the binding already
selects rather than replacing it: naming only `region` keeps the binding's
profile.

## Register (mcp.json)

```json
{
  "mcpServers": {
    "oab-studio": {
      "command": "oab-mcp",
      "env": { "OAB_CLUSTER": "oab" }
    }
  }
}
```
