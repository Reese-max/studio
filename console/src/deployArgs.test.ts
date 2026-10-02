// studio#111: the "+ New fleet" / "+ Add instance" wizard's single
// `deploy_provision_agent` call is where #111's create-or-redeploy branch is
// reached from — a brand-new agent (no stored manifest) gets a freshly built
// `OABServiceManifest` applied through `apply_manifests`, an existing one takes
// `redeploy`'s patch path. That decision is the sidecar's, but everything it
// needs to make it — and to build a correct first manifest — arrives in this
// one argument object, so the object is pinned here rather than left implicit
// in the panel's submit handler.
//
// The AWS-credential half is the load-bearing one (studio#111): the wizard's
// identity step already collects Region + Credential profile and writes them
// into `fleets.toml`, but that file's `[fleet.<name>]` block carries no
// `cluster` key, so oab-mcp's per-cluster credential lookup
// (`FleetBindings::for_cluster`) can never match it — the sidecar falls back to
// the ambient `[default]` chain. On a first create there is no binding at all
// yet (`fleets.toml` is only written *after* a confirmed successful deploy),
// so the first manifest's VPC/subnet/security-group discovery — and the apply
// itself — would run against whatever account the ambient chain happens to
// resolve. The operator's chosen region/profile have to ride along with the
// call.

import { describe, it, expect } from "vitest";
import { provisionAgentArgs } from "./deployArgs";

const ecs = {
  image: "ghcr.io/openabdev/openab:0.10.0-beta.3-codex",
  name: "zeus",
  namespace: "default",
};

describe("provisionAgentArgs — the shape every provision call must have", () => {
  it("always names the image, agent and namespace", () => {
    const args = provisionAgentArgs({ ...ecs, acpEnabled: true });
    expect(args.image).toBe(ecs.image);
    expect(args.name).toBe("zeus");
    expect(args.namespace).toBe("default");
  });

  it("never sends a k8s dispatch for an ECS submit", () => {
    const args = provisionAgentArgs({ ...ecs, acpEnabled: true });
    expect(args.provider).toBeUndefined();
    expect(args.context).toBeUndefined();
    expect(args.expected_principal).toBeUndefined();
  });
});

describe("provisionAgentArgs — AWS credentials (studio#111)", () => {
  it("forwards the region and credential profile the wizard collected", () => {
    const args = provisionAgentArgs({
      ...ecs,
      acpEnabled: true,
      region: "ap-northeast-1",
      profile: "studio-prod",
    });
    expect(args.region).toBe("ap-northeast-1");
    expect(args.profile).toBe("studio-prod");
  });

  it("omits blank credentials rather than sending empty strings", () => {
    const args = provisionAgentArgs({ ...ecs, acpEnabled: true, region: "  ", profile: "" });
    expect("region" in args).toBe(false);
    expect("profile" in args).toBe(false);
  });

  it("keeps a region-only submit from inventing a profile", () => {
    const args = provisionAgentArgs({ ...ecs, acpEnabled: true, region: "eu-west-1" });
    expect(args.region).toBe("eu-west-1");
    expect("profile" in args).toBe(false);
  });
});

describe("provisionAgentArgs — k8s dispatch (studio#104/#153)", () => {
  const k8s = {
    ...ecs,
    namespace: "persephone",
    acpEnabled: true,
    k8s: { context: "orbstack", expectedPrincipal: "system:serviceaccount:persephone:runner" },
  };

  it("passes provider/context/expected_principal together", () => {
    const args = provisionAgentArgs(k8s);
    expect(args.provider).toBe("k8s");
    expect(args.context).toBe("orbstack");
    expect(args.expected_principal).toBe("system:serviceaccount:persephone:runner");
  });

  it("omits an unset context so the kubeconfig current-context applies", () => {
    const args = provisionAgentArgs({ ...k8s, k8s: { context: undefined, expectedPrincipal: undefined } });
    expect(args.provider).toBe("k8s");
    expect("context" in args).toBe(false);
    expect("expected_principal" in args).toBe(false);
  });

  it("never sends AWS credentials on a k8s submit", () => {
    // A k8s pod has no AWS credential chain (studio#104/#128), so a region or
    // profile left over from the identity step's AWS fields must not travel
    // with the call and mislead the sidecar into resolving one anyway.
    const args = provisionAgentArgs({ ...k8s, region: "ap-northeast-1", profile: "studio-prod" });
    expect("region" in args).toBe(false);
    expect("profile" in args).toBe(false);
  });
});

describe("provisionAgentArgs — optional wizard fields", () => {
  it("forwards chat platform secrets and the local config folder when set", () => {
    const args = provisionAgentArgs({
      ...ecs,
      acpEnabled: true,
      chatPlatform: "line",
      chatBotToken: "channel-token",
      chatChannelSecret: "channel-secret",
      apiKey: "sk-vendor",
      localConfigFolder: "/home/op/studio-config",
    });
    expect(args.chat_platform).toBe("line");
    expect(args.chat_bot_token).toBe("channel-token");
    expect(args.chat_channel_secret).toBe("channel-secret");
    expect(args.api_key).toBe("sk-vendor");
    expect(args.local_config_folder).toBe("/home/op/studio-config");
  });

  it("drops every blank optional field instead of sending empty strings", () => {
    const args = provisionAgentArgs({
      ...ecs,
      acpEnabled: false,
      apiKey: "  ",
      chatPlatform: "",
      chatBotToken: "",
      chatChannelSecret: "",
      acpToken: "",
      localConfigFolder: "",
    });
    for (const key of [
      "api_key",
      "chat_platform",
      "chat_bot_token",
      "chat_channel_secret",
      "acp_token",
      "local_config_folder",
    ]) {
      expect(key in args).toBe(false);
    }
  });

  it("carries acp_enabled verbatim — the sidecar owns the default-when-absent rule", () => {
    expect(provisionAgentArgs({ ...ecs, acpEnabled: false }).acp_enabled).toBe(false);
    expect(provisionAgentArgs({ ...ecs, acpEnabled: true }).acp_enabled).toBe(true);
  });

  it("never sends an acp_token for an ACP-off agent (the sidecar ignores it, and it would be a stray secret)", () => {
    const args = provisionAgentArgs({ ...ecs, acpEnabled: false, acpToken: "typed-anyway" });
    expect("acp_token" in args).toBe(false);
  });
});