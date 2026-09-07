import "./style.css";
import {
  createInbox,
  extractOtp,
  getMessage,
  listMessages,
  type MailAccount,
  type MailMessage,
} from "./mailtm";

type Session = {
  account: MailAccount | null;
  messages: MailMessage[];
  selectedId: string | null;
  latestOtp: string | null;
  polling: boolean;
  busy: boolean;
};

const state: Session = {
  account: null,
  messages: [],
  selectedId: null,
  latestOtp: null,
  polling: false,
  busy: false,
};

const STORAGE_KEY = "otpdrop.session.v1";
let pollTimer: number | undefined;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

app.innerHTML = `
  <div class="shell">
    <section class="hero">
      <div class="brand">
        <div class="brand-mark">O</div>
        <h1 class="brand-name">OTP Drop</h1>
      </div>
      <div class="hero-copy">
        <h2>Catch one-time codes in a fresh inbox.</h2>
        <p>
          Spin up a temporary address, request a test OTP, or forward real
          verification mail here. Codes are highlighted the moment they land.
        </p>
      </div>
    </section>

    <section class="layout">
      <article class="panel" id="inbox-panel">
        <h3>Your inbox</h3>
        <p class="hint">
          Addresses are backed by mail.tm for live delivery. Use “Send test OTP”
          to verify the UI without leaving this page.
        </p>

        <div class="address-box">
          <div class="address">
            <span id="address-label">Creating inbox…</span>
          </div>
          <div class="actions">
            <button class="btn btn-primary" id="btn-new" type="button">New address</button>
            <button class="btn btn-secondary" id="btn-copy" type="button" disabled>Copy</button>
            <button class="btn btn-spark" id="btn-otp" type="button" disabled>Send test OTP</button>
          </div>
        </div>

        <div class="otp-card" id="otp-card">
          <p>Latest OTP</p>
          <strong id="otp-value">------</strong>
        </div>

        <p class="status" id="status"></p>
        <p class="footer-note">
          For your own apps and accounts only. Do not use disposable inboxes to
          evade platform security or abuse signup flows.
        </p>
      </article>

      <article class="panel" id="messages-panel">
        <h3>Messages</h3>
        <p class="hint">New mail is polled every few seconds while this tab stays open.</p>
        <div class="message-list" id="message-list">
          <div class="empty">No messages yet.</div>
        </div>
        <div class="reader" id="reader">
          <h4 id="reader-subject"></h4>
          <pre id="reader-body"></pre>
        </div>
      </article>
    </section>
  </div>
`;

const addressLabel = must("#address-label");
const statusEl = must("#status");
const otpCard = must("#otp-card");
const otpValue = must("#otp-value");
const messageList = must("#message-list");
const reader = must("#reader");
const readerSubject = must("#reader-subject");
const readerBody = must("#reader-body");
const btnNew = must<HTMLButtonElement>("#btn-new");
const btnCopy = must<HTMLButtonElement>("#btn-copy");
const btnOtp = must<HTMLButtonElement>("#btn-otp");

btnNew.addEventListener("click", () => {
  void bootstrapInbox(true);
});

btnCopy.addEventListener("click", async () => {
  if (!state.account) return;
  await navigator.clipboard.writeText(state.account.address);
  setStatus("Address copied.");
});

btnOtp.addEventListener("click", () => {
  void sendTestOtp();
});

void bootstrapInbox(false);

async function bootstrapInbox(forceNew: boolean): Promise<void> {
  stopPolling();
  setBusy(true);
  setStatus(forceNew ? "Creating a fresh inbox…" : "Preparing inbox…");

  try {
    if (!forceNew) {
      const restored = restoreSession();
      if (restored) {
        state.account = restored;
      }
    }

    if (forceNew || !state.account) {
      state.account = await createInbox();
      state.messages = [];
      state.selectedId = null;
      state.latestOtp = null;
      persistSession(state.account);
    }

    addressLabel.textContent = state.account.address;
    btnCopy.disabled = false;
    btnOtp.disabled = false;
    renderMessages();
    renderOtp();
    setStatus("Inbox ready. Listening for mail…");
    startPolling();
    await refreshMessages();
  } catch (error) {
    console.error(error);
    addressLabel.textContent = "Unable to create inbox";
    setStatus(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

async function sendTestOtp(): Promise<void> {
  if (!state.account || state.busy) return;

  setBusy(true);
  setStatus("Sending test OTP…");

  try {
    const response = await fetch("/api/send-test-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: state.account.address }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as {
      otp: string;
      message: MailMessage;
    };

    upsertMessage(payload.message);
    state.latestOtp = payload.otp;
    state.selectedId = payload.message.id;
    renderMessages();
    renderOtp();
    await openMessage(payload.message.id, payload.message);
    setStatus(`Test OTP received: ${payload.otp}`);
  } catch (error) {
    console.error(error);
    setStatus(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

function startPolling(): void {
  stopPolling();
  state.polling = true;
  pollTimer = window.setInterval(() => {
    void refreshMessages();
  }, 4000);
}

function stopPolling(): void {
  state.polling = false;
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function refreshMessages(): Promise<void> {
  if (!state.account || !state.polling) return;

  try {
    const remote = await listMessages(state.account.token);
    let changed = false;

    for (const message of remote) {
      if (!state.messages.some((item) => item.id === message.id)) {
        upsertMessage(message);
        changed = true;

        const candidate = extractOtp(
          `${message.subject}\n${message.intro}\n${message.text ?? ""}`,
        );
        if (candidate) {
          state.latestOtp = candidate;
        }
      }
    }

    if (changed) {
      renderMessages();
      renderOtp();
      setStatus("New mail arrived.");
    }
  } catch (error) {
    console.error(error);
  }
}

async function openMessage(
  id: string,
  seed?: MailMessage,
): Promise<void> {
  if (!state.account) return;

  state.selectedId = id;
  renderMessages();

  let message = seed ?? state.messages.find((item) => item.id === id);
  if (!message) return;

  if (message.source !== "test-otp" && !message.text && !message.html) {
    message = await getMessage(state.account.token, id);
    upsertMessage(message);
  }

  const bodyText =
    message.text ||
    (Array.isArray(message.html) ? message.html.join("\n") : message.html) ||
    message.intro;

  const otp = extractOtp(`${message.subject}\n${bodyText}`);
  if (otp) {
    state.latestOtp = otp;
    renderOtp();
  }

  reader.classList.add("visible");
  readerSubject.textContent = message.subject || "(no subject)";
  readerBody.textContent = bodyText;
}

function upsertMessage(message: MailMessage): void {
  const index = state.messages.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    state.messages[index] = { ...state.messages[index], ...message };
  } else {
    state.messages.unshift(message);
  }
}

function renderMessages(): void {
  if (state.messages.length === 0) {
    messageList.innerHTML = `<div class="empty">No messages yet.</div>`;
    reader.classList.remove("visible");
    return;
  }

  messageList.innerHTML = state.messages
    .map((message) => {
      const active = message.id === state.selectedId ? "active" : "";
      const when = formatTime(message.createdAt);
      const from = message.from?.address || "unknown";
      return `
        <button class="message ${active}" type="button" data-id="${escapeAttr(message.id)}">
          <div class="meta"><span>${escapeHtml(from)}</span><span>${escapeHtml(when)}</span></div>
          <div class="subject">${escapeHtml(message.subject || "(no subject)")}</div>
          <div class="intro">${escapeHtml(message.intro || "")}</div>
        </button>
      `;
    })
    .join("");

  messageList.querySelectorAll<HTMLButtonElement>(".message").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (id) void openMessage(id);
    });
  });
}

function renderOtp(): void {
  if (!state.latestOtp) {
    otpCard.classList.remove("visible");
    otpValue.textContent = "------";
    return;
  }
  otpCard.classList.add("visible");
  otpValue.textContent = state.latestOtp;
}

function setBusy(busy: boolean): void {
  state.busy = busy;
  btnNew.disabled = busy;
  btnOtp.disabled = busy || !state.account;
  btnCopy.disabled = !state.account;
}

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function persistSession(account: MailAccount): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

function restoreSession(): MailAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MailAccount;
  } catch {
    return null;
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

function must<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
