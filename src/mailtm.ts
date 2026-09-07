const API = "/api";

export type MailAccount = {
  address: string;
  password: string;
  token: string;
  id: string;
};

export type MailMessage = {
  id: string;
  from: { name?: string; address: string };
  to: Array<{ address: string }>;
  subject: string;
  intro: string;
  text?: string;
  html?: string[] | string;
  createdAt: string;
  source?: "mail.tm" | "test-otp";
};

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Request failed (${response.status})`);
  }

  if (!response.ok) {
    const err = data as { error?: string; details?: string };
    throw new Error(err.error || err.details || text || `Request failed (${response.status})`);
  }

  return data as T;
}

export async function createInbox(): Promise<MailAccount> {
  return parseJson<MailAccount>(
    await fetch(`${API}/create-inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-Mailbox-Token": token,
  };
}

export async function listMessages(token: string): Promise<MailMessage[]> {
  const data = await parseJson<{ messages: MailMessage[] }>(
    await fetch(`${API}/messages`, {
      headers: authHeaders(token),
    }),
  );
  return data.messages;
}

export async function getMessage(
  token: string,
  id: string,
): Promise<MailMessage> {
  return parseJson<MailMessage>(
    await fetch(`${API}/messages?id=${encodeURIComponent(id)}`, {
      headers: authHeaders(token),
    }),
  );
}

export function extractOtp(input: string): string | null {
  const patterns = [
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
    /\b(\d{8})\b/,
    /code[:\s-]*([0-9]{4,8})/i,
    /otp[:\s-]*([0-9]{4,8})/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}
