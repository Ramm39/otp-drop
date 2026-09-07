const API = "https://api.mail.tm";

export type MailDomain = {
  id: string;
  domain: string;
  isActive: boolean;
};

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

type HydraCollection<T> = {
  "hydra:member": T[];
};

function randomLocalPart(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function getActiveDomain(): Promise<MailDomain> {
  const data = await parseJson<HydraCollection<MailDomain>>(
    await fetch(`${API}/domains?page=1`),
  );
  const domain = data["hydra:member"].find((item) => item.isActive);
  if (!domain) {
    throw new Error("No active mail.tm domain is available right now");
  }
  return domain;
}

export async function createInbox(): Promise<MailAccount> {
  const domain = await getActiveDomain();
  const address = `${randomLocalPart()}@${domain.domain}`;
  const password = `${randomLocalPart(12)}!A1`;

  const created = await parseJson<{ id: string; address: string }>(
    await fetch(`${API}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    }),
  );

  const tokenPayload = await parseJson<{ token: string }>(
    await fetch(`${API}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    }),
  );

  return {
    id: created.id,
    address: created.address,
    password,
    token: tokenPayload.token,
  };
}

export async function listMessages(token: string): Promise<MailMessage[]> {
  const data = await parseJson<HydraCollection<MailMessage>>(
    await fetch(`${API}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );

  return data["hydra:member"].map((message) => ({
    ...message,
    source: "mail.tm",
  }));
}

export async function getMessage(
  token: string,
  id: string,
): Promise<MailMessage> {
  const message = await parseJson<MailMessage>(
    await fetch(`${API}/messages/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return { ...message, source: "mail.tm" };
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
