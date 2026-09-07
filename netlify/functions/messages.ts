import type { Handler } from "@netlify/functions";
import {
  bearerFromEvent,
  collectionMembers,
  corsHeaders,
  json,
  mailtm,
  optionsResponse,
} from "./lib/shared";

type Message = {
  id: string;
  from: { name?: string; address: string };
  to: Array<{ address: string }>;
  subject: string;
  intro: string;
  text?: string;
  html?: string[] | string;
  createdAt: string;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const token = bearerFromEvent(event.headers as Record<string, string | undefined>);
  if (!token) {
    return json(401, { error: "Missing mailbox token" });
  }

  const authHeader = `Bearer ${token}`;
  const id = event.queryStringParameters?.id;

  try {
    if (id) {
      const message = await mailtm<Message>(`/messages/${encodeURIComponent(id)}`, {
        headers: { Authorization: authHeader },
      });
      if (message.status >= 400) {
        return json(message.status, message.data);
      }
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ...message.data, source: "mail.tm" }),
      };
    }

    const list = await mailtm<unknown>("/messages", {
      headers: { Authorization: authHeader },
    });

    if (list.status >= 400) {
      return json(list.status, list.data);
    }

    const messages = collectionMembers<Message>(list.data).map((message) => ({
      ...message,
      source: "mail.tm" as const,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ messages }),
    };
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : "Failed to fetch messages",
    });
  }
};
