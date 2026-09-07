import "./style.css";
import {
  createInbox,
  extractOtp,
  getMessage,
  listMessages,
  loginInbox,
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
  kept: boolean;
};

const state: Session = {
  account: null,
  messages: [],
  selectedId: null,
  latestOtp: null,
  polling: false,
  busy: false,
  kept: true,
};

const STORAGE_KEY = "otpdrop.session.v1";
const KEEP_KEY = "otpdrop.keep.v1";
let pollTimer: number | undefined;
let refreshInFlight: Promise<boolean> | null = null;

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
          Your address is saved on this device and reused on every visit.
          Keep the recovery password so you can restore it later.
        </p>
      </div>
    </section>

    <section class="layout">
      <article class="panel" id="inbox-panel">
        <h3>Your inbox</h3>
        <p class="hint">
          Leave <strong>Keep this address</strong> on to reuse the same inbox.
          Only click New address when you intentionally want a different one.
        </p>

        <div class="address-box">
          <div class="address">
            <span id="address-label">Loading saved inbox…</span>
            <span class="keep-badge" id="keep-badge">Saved</span>
          </div>
          <label class="keep-toggle">
            <input type="checkbox" id="keep-toggle" checked />
            <span>Keep this address on this device</span>
          </label>
          <div class="actions">
            <button class="btn btn-secondary" id="btn-copy" type="button" disabled>Copy address</button>
            <button class="btn btn-secondary" id="btn-save" type="button" disabled>Copy recovery</button>
            <button class="btn btn-spark" id="btn-otp" type="button" disabled>Send test OTP</button>
            <button class="btn btn-danger" id="btn-new" type="button">New address</button>
          </div>
        </div>

        <div class="recovery-box">
          <h4>Restore a kept address</h4>
          <p class="hint">Paste the recovery line, or type the email and password.</p>
          <input id="restore-input" type="text" placeholder="address@domain | password" autocomplete="off" />
          <div class="actions">
            <button class="btn btn-primary" id="btn-restore" type="button">Restore inbox</button>
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
const keepBadge = must("#keep-badge");
const keepToggle = must<HTMLInputElement>("#keep-toggle");
const statusEl = must("#status");
const otpCard = must("#otp-card");
const otpValue = must("#otp-value");
const messageList = must("#message-list");
const reader = must("#reader");
const readerSubject = must("#reader-subject");
const readerBody = must("#reader-body");
const restoreInput = must<HTMLInputElement>("#restore-input");
const btnNew = must<HTMLButtonElement>("#btn-new");
const btnCopy = must<HTMLButtonElement>("#btn-copy");
const btnSave = must<HTMLButtonElement>("#btn-save");
const btnOtp = must<HTMLButtonElement>("#btn-otp");
const btnRestore = must<HTMLButtonElement>("#btn-restore");

state.kept = restoreKeepPreference();
keepToggle.checked = state.kept;
renderKeepBadge();

keepToggle.addEventListener("change", () => {
  state.kept = keepToggle.checked;
  persistKeepPreference(state.kept);
  renderKeepBadge();
  if (state.kept && state.account) {
    persistSession(state.account);
    setStatus("Address will be kept on this device.");
  } else if (!state.kept) {
    clearSession();
    setStatus("Keep is off. This address will not be restored next visit.");
  }
});

btnNew.addEventListener("click", () => {
  void createNewAddress();
});

btnCopy.addEventListener("click", async () => {
  if (!state.account) return;
  await navigator.clipboard.writeText(state.account.address);
  setStatus("Address copied.");
});

btnSave.addEventListener("click", async () => {
  if (!state.account) return;
  const recovery = formatRecovery(state.account);
  await navigator.clipboard.writeText(recovery);
  setStatus("Recovery line copied. Store it somewhere safe.");
});

btnOtp.addEventListener("click", () => {
  void sendTestOtp();
});

btnRestore.addEventListener("click", () => {
  void restoreFromInput();
});

void bootstrapInbox(false);

async function createNewAddress(): Promise<void> {
  if (state.account) {
    const ok = window.confirm(
      `Replace ${state.account.address}?\n\nCopy recovery first if you want to keep using it later.`,
    );
    if (!ok) return;
  }
  await bootstrapInbox(true);
}

async function bootstrapInbox(forceNew: boolean): Promise<void> {
  stopPolling();
  setBusy(true);
  setStatus(forceNew ? "Creating a fresh inbox…" : "Loading your kept inbox…");

  try {
    if (!forceNew) {
      const restored = restoreSession();
      if (restored) {
        state.account = restored;
        try {
          state.account = await loginInbox(restored.address, restored.password);
          if (state.kept) persistSession(state.account);
        } catch {
          // Keep the saved account; token refresh may still work on demand.
          state.account = restored;
        }
      }
    }

    if (forceNew || !state.account) {
      state.account = await createInbox();
      state.messages = [];
      state.selectedId = null;
      state.latestOtp = null;
      if (state.kept) persistSession(state.account);
      else clearSession();
    }

    applyAccountToUi(state.account);
    setStatus(
      state.kept
        ? `Kept inbox ready: ${state.account.address}`
        : "Inbox ready. Turn on Keep to reuse it next time.",
    );
    startPolling();
    await refreshMessages();
  } catch (error) {
    console.error(error);
    addressLabel.textContent = "Unable to open inbox";
    setStatus(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

async function restoreFromInput(): Promise<void> {
  const raw = restoreInput.value.trim();
  if (!raw) {
    setStatus("Paste a recovery line first.", true);
    return;
  }

  const parsed = parseRecovery(raw);
  if (!parsed) {
    setStatus("Use format: address@domain | password", true);
    return;
  }

  setBusy(true);
  setStatus("Restoring kept inbox…");
  try {
    const account = await loginInbox(parsed.address, parsed.password);
    state.account = account;
    state.messages = [];
    state.selectedId = null;
    state.latestOtp = null;
    state.kept = true;
    keepToggle.checked = true;
    persistKeepPreference(true);
    persistSession(account);
    applyAccountToUi(account);
    renderKeepBadge();
    restoreInput.value = "";
    setStatus(`Restored ${account.address}. This address is kept.`);
    startPolling();
    await refreshMessages();
  } catch (error) {
    console.error(error);
    setStatus(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

function applyAccountToUi(account: MailAccount): void {
  addressLabel.textContent = account.address;
  btnCopy.disabled = false;
  btnSave.disabled = false;
  btnOtp.disabled = false;
  renderMessages();
  renderOtp();
  renderKeepBadge();
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
    ingestRemoteMessages(remote);
  } catch (error) {
    const message = errorMessage(error);
    if (/401|invalid jwt|unauthorized|token/i.test(message)) {
      const refreshed = await refreshToken();
      if (refreshed && state.account) {
        try {
          const remote = await listMessages(state.account.token);
          ingestRemoteMessages(remote);
          return;
        } catch (retryError) {
          console.error(retryError);
        }
      }
    }
    console.error(error);
  }
}

function ingestRemoteMessages(remote: MailMessage[]): void {
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
}

async function refreshToken(): Promise<boolean> {
  if (!state.account) return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const next = await loginInbox(state.account!.address, state.account!.password);
      state.account = {
        ...state.account!,
        ...next,
        password: state.account!.password,
      };
      if (state.kept) persistSession(state.account);
      setStatus("Session renewed. Still using your kept address.");
      return true;
    } catch (error) {
      console.error(error);
      setStatus(
        "Saved address login expired. Use Restore with your recovery line.",
        true,
      );
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
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
    try {
      message = await getMessage(state.account.token, id);
    } catch (error) {
      const refreshed = await refreshToken();
      if (!refreshed || !state.account) throw error;
      message = await getMessage(state.account.token, id);
    }
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

function renderKeepBadge(): void {
  keepBadge.textContent = state.kept ? "Saved" : "Temporary";
  keepBadge.classList.toggle("off", !state.kept);
}

function setBusy(busy: boolean): void {
  state.busy = busy;
  btnNew.disabled = busy;
  btnOtp.disabled = busy || !state.account;
  btnCopy.disabled = !state.account;
  btnSave.disabled = !state.account;
  btnRestore.disabled = busy;
}

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function persistSession(account: MailAccount): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function restoreSession(): MailAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const account = JSON.parse(raw) as MailAccount;
    if (!account.address || !account.password) return null;
    return account;
  } catch {
    return null;
  }
}

function persistKeepPreference(kept: boolean): void {
  localStorage.setItem(KEEP_KEY, kept ? "1" : "0");
}

function restoreKeepPreference(): boolean {
  const raw = localStorage.getItem(KEEP_KEY);
  if (raw === null) return true;
  return raw === "1";
}

function formatRecovery(account: MailAccount): string {
  return `${account.address} | ${account.password}`;
}

function parseRecovery(raw: string): { address: string; password: string } | null {
  if (raw.includes("|")) {
    const [address, ...rest] = raw.split("|");
    const password = rest.join("|").trim();
    if (!address.trim() || !password) return null;
    return { address: address.trim().toLowerCase(), password };
  }

  const parts = raw.split(/\s+/);
  if (parts.length >= 2 && parts[0].includes("@")) {
    return {
      address: parts[0].trim().toLowerCase(),
      password: parts.slice(1).join(" ").trim(),
    };
  }

  return null;
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
