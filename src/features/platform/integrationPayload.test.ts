import { describe, expect, it } from "vitest";
import { buildCredentialsPayload, providerFieldKeys, PROVIDERS } from "./integrationPayload";

describe("buildCredentialsPayload", () => {
  it("sends AfroMessage's sender_id as config, not as a secret (AC-1)", () => {
    expect(buildCredentialsPayload("sms_afromessage", { api_key: " k ", sender_id: "TIMHIRT" })).toEqual({
      provider: "sms_afromessage",
      credentials: { api_key: "k" },
      config: { sender_id: "TIMHIRT" },
    });
  });

  it("omits config for providers that have none", () => {
    expect(buildCredentialsPayload("sms_smsala", { api_key: "k" })).toEqual({
      provider: "sms_smsala",
      credentials: { api_key: "k" },
    });
  });

  it("never posts a key the form does not render", () => {
    for (const provider of PROVIDERS) {
      const rendered = providerFieldKeys(provider).map((f) => f.key);
      const values = Object.fromEntries(rendered.map((k) => [k, "v"]));
      const body = buildCredentialsPayload(provider, { ...values, stray: "x" });
      const posted = [...Object.keys(body.credentials), ...Object.keys(body.config ?? {})];
      expect(posted.sort()).toEqual([...rendered].sort());
    }
  });
});
