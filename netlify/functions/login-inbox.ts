import type { Handler } from "@netlify/functions";
import { corsHeaders, json, mailtm, optionsResponse } from "./lib/shared";

type Body = {
  address?: string;
  password?: string;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body: Body = {};
  try {
    body = event.body ? (JSON.parse(event.body) as Body) : {};
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const address = body.address?.trim().toLowerCase();
  const password = body.password;
  if (!address || !password) {
    return json(400, { error: "address and password are required" });
  }

  try {
    const tokenResponse = await mailtm<{ token?: string; id?: string }>("/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    });

    if (tokenResponse.status >= 400 || !tokenResponse.data?.token) {
      return json(tokenResponse.status >= 400 ? tokenResponse.status : 401, {
        error: "Could not restore that inbox. Check the address and password.",
        details: tokenResponse.data,
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        address,
        password,
        token: tokenResponse.data.token,
        id: tokenResponse.data.id ?? "",
      }),
    };
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : "Failed to restore inbox",
    });
  }
};
