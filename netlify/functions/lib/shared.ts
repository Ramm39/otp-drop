const API = "https://api.mail.tm";

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Mailbox-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

export function json(statusCode: number, payload: unknown) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(payload),
  };
}

export function optionsResponse() {
  return {
    statusCode: 204,
    headers: corsHeaders(),
    body: "",
  };
}

export async function mailtm<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: T; raw: string }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/ld+json, application/json",
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  let data: T;
  try {
    data = (raw ? JSON.parse(raw) : {}) as T;
  } catch {
    throw new Error(`mail.tm returned non-JSON (${response.status}): ${raw.slice(0, 200)}`);
  }

  return { status: response.status, data, raw };
}

export function collectionMembers<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const members = record["hydra:member"] ?? record.member;
    if (Array.isArray(members)) {
      return members as T[];
    }
  }
  return [];
}

export function randomLocalPart(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function bearerFromEvent(headers: Record<string, string | undefined>): string | null {
  const direct =
    headers["x-mailbox-token"] ||
    headers["X-Mailbox-Token"] ||
    headers.authorization ||
    headers.Authorization;

  if (!direct) return null;
  return direct.startsWith("Bearer ") ? direct.slice(7) : direct;
}
