import type { Handler, HandlerEvent } from "@netlify/functions";
import { corsHeaders, json, optionsResponse } from "./lib/shared";

type Body = {
  to?: string;
};

function generateOtp(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body: Body = {};
  try {
    body = event.body ? (JSON.parse(event.body) as Body) : {};
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const to = (body.to ?? "demo@otpdrop.local").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return json(400, { error: "A valid destination address is required" });
  }

  const otp = generateOtp();
  const sentAt = new Date().toISOString();

  return json(200, {
    ok: true,
    otp,
    message: {
      id: `local-${sentAt}`,
      from: {
        name: "OTP Drop",
        address: "noreply@otpdrop.app",
      },
      to: [{ address: to }],
      subject: `Your verification code is ${otp}`,
      intro: `Use this one-time passcode to finish sign-in: ${otp}`,
      text: [
        "OTP Drop — test message",
        "",
        `Your verification code is ${otp}.`,
        "",
        "This code expires in 10 minutes.",
        "If you did not request it, ignore this email.",
      ].join("\n"),
      html: [
        `<div style="font-family:Georgia,serif;line-height:1.5;color:#173028">`,
        `<p>OTP Drop — test message</p>`,
        `<p>Your verification code is <strong style="font-size:28px;letter-spacing:0.12em">${otp}</strong>.</p>`,
        `<p>This code expires in 10 minutes.</p>`,
        `</div>`,
      ].join(""),
      createdAt: sentAt,
      source: "test-otp",
    },
  });
};
