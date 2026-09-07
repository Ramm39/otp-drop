import type { Handler } from "@netlify/functions";
import {
  collectionMembers,
  corsHeaders,
  json,
  mailtm,
  optionsResponse,
  randomLocalPart,
} from "./lib/shared";

type Domain = {
  id: string;
  domain: string;
  isActive: boolean;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const domains = await mailtm<unknown>("/domains?page=1");
    if (domains.status >= 400) {
      return json(domains.status, {
        error: "Failed to load mail.tm domains",
        details: domains.data,
      });
    }

    const domain = collectionMembers<Domain>(domains.data).find(
      (item) => item.isActive && Boolean(item.domain),
    );
    if (!domain) {
      return json(503, {
        error: "No active mail.tm domain available",
        details: domains.data,
      });
    }

    const address = `${randomLocalPart()}@${domain.domain}`;
    const password = `${randomLocalPart(12)}!A1`;

    const created = await mailtm<{ id?: string; address?: string; "hydra:description"?: string }>(
      "/accounts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password }),
      },
    );

    if (created.status >= 400 || !created.data?.id) {
      return json(created.status >= 400 ? created.status : 502, {
        error: "Failed to create mail.tm account",
        details: created.data,
      });
    }

    const tokenResponse = await mailtm<{ token?: string }>("/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    });

    if (tokenResponse.status >= 400 || !tokenResponse.data?.token) {
      return json(tokenResponse.status >= 400 ? tokenResponse.status : 502, {
        error: "Failed to create mail.tm token",
        details: tokenResponse.data,
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        id: created.data.id,
        address: created.data.address ?? address,
        password,
        token: tokenResponse.data.token,
      }),
    };
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : "Failed to create inbox",
    });
  }
};
