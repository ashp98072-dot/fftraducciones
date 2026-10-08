const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createHandler } = require("../lib/cotizacion");

const mailbox = "fyftraducciones@gmail.com";
const valid = {
  name: "Cliente de prueba", email: "cliente@example.com", service: "translation",
  message: "Necesito traducir un documento.", _gotcha: "", _subject: "Asunto del formulario",
};

function fixture(options = {}) {
  const sent = [];
  let transportOptions;
  const handler = createHandler({
    env: { NODE_ENV: "production", GMAIL_APP_PASSWORD: "fake test password", ...options.env },
    now: options.now,
    createTransport: settings => {
      transportOptions = settings;
      return { sendMail: async message => {
        sent.push(message);
        if (options.failure) throw new Error("SMTP failure with private details");
        return { accepted: options.rejected ? [] : [mailbox] };
      } };
    },
  });
  async function call(overrides = {}) {
    const req = {
      method: "POST", body: { ...valid },
      headers: { origin: "https://www.fyftraducciones.com", "content-type": "application/x-www-form-urlencoded", "x-real-ip": "192.0.2.1", ...overrides.headers },
      ...overrides,
    };
    req.headers = { origin: "https://www.fyftraducciones.com", "content-type": "application/x-www-form-urlencoded", "x-real-ip": "192.0.2.1", ...overrides.headers };
    const headers = {};
    const res = { setHeader(key, value) { headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
    await handler(req, res);
    return { status: res.statusCode, body: res.body, headers };
  }
  return { handler, call, sent, settings: () => transportOptions };
}

test("fixed sender, recipient and subject; visitor only sets Reply-To and plain text", async () => {
  const f = fixture();
  const r = await f.call({ body: { ...valid, to: "attacker@example.com", _subject: "Injected subject", phone: "+502 1234", country: "GT" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(f.sent[0].from.address, mailbox);
  assert.equal(f.sent[0].to, mailbox);
  assert.equal(f.sent[0].subject, "Nueva solicitud de cotización - F&F Traducciones");
  assert.deepEqual(f.sent[0].replyTo, { name: valid.name, address: valid.email });
  assert.match(f.sent[0].text, /País: Guatemala/);
  assert.match(f.sent[0].text, /Servicio: Traducción/);
  assert.match(f.sent[0].text, /Necesito traducir/);
  assert.equal(f.sent[0].html, undefined);
  assert.equal(f.sent[0].attachments, undefined);
  assert.equal(f.settings().auth.user, mailbox);
  assert.equal(f.settings().auth.pass, "faketestpassword");
  assert.equal(f.settings().secure, true);
  assert.equal(f.settings().disableFileAccess, true);
});

test("phone and country may be empty", async () => {
  const f = fixture();
  assert.equal((await f.call()).status, 200);
  assert.match(f.sent[0].text, /País: No indicado/);
});

for (const [name, body] of Object.entries({
  "missing name": { ...valid, name: "  " },
  "missing message": { ...valid, message: "" },
  "missing email": { ...valid, email: "" },
  "invalid email": { ...valid, email: "not-an-email" },
  "email header injection": { ...valid, email: "x@example.com\r\nBcc: x@other.com" },
  "email control character": { ...valid, email: "x\u0000y@example.com" },
  "name header injection": { ...valid, name: "Name\r\nBcc: x@other.com" },
  "missing service": { ...valid, service: "" },
  "unsupported service": { ...valid, service: "unknown" },
  "prototype service name": { ...valid, service: "toString" },
  "unsupported country": { ...valid, country: "XX" },
  "array email": { ...valid, email: ["x@example.com"] },
  "object message": { ...valid, message: {} },
  "oversized name": { ...valid, name: "a".repeat(151) },
  "oversized message": { ...valid, message: "a".repeat(5001) },
  "array body": [],
  "null body": null,
})) {
  test(`rejects ${name} without contacting SMTP`, async () => {
    const f = fixture();
    assert.equal((await f.call({ body })).status, 400);
    assert.equal(f.sent.length, 0);
  });
}

test("honeypot responds neutrally without credentials or SMTP", async () => {
  const f = fixture({ env: { GMAIL_APP_PASSWORD: "" } });
  assert.equal((await f.call({ body: { _gotcha: "bot" } })).status, 200);
  assert.equal(f.sent.length, 0);
  assert.equal(f.settings(), undefined);
});

test("missing configuration returns 503, never a false success", async () => {
  const f = fixture({ env: { GMAIL_APP_PASSWORD: "" } });
  const r = await f.call();
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false);
  assert.equal(f.settings(), undefined);
});

test("rejects GET and advertises POST", async () => {
  const f = fixture();
  const r = await f.call({ method: "GET" });
  assert.equal(r.status, 405);
  assert.equal(r.headers.Allow, "POST");
  assert.equal(f.sent.length, 0);
});

for (const origin of [undefined, "null", "https://attacker.example", "https://www.fyftraducciones.com.attacker.example", "http://localhost:3000"]) {
  test(`rejects untrusted origin ${origin} in production`, async () => {
    const f = fixture();
    assert.equal((await f.call({ headers: { origin } })).status, 403);
    assert.equal(f.sent.length, 0);
  });
}

test("allows apex domain and only configured Vercel preview hosts", async () => {
  const f = fixture({ env: { VERCEL: "1", VERCEL_URL: "preview-test.vercel.app", VERCEL_BRANCH_URL: "branch-test.vercel.app" } });
  for (const origin of ["https://fyftraducciones.com", "https://preview-test.vercel.app", "https://branch-test.vercel.app"]) {
    assert.equal((await f.call({ headers: { origin } })).status, 200);
  }
  assert.equal((await f.call({ headers: { origin: "https://unrelated.vercel.app" } })).status, 403);
});

test("allows localhost only in development", async () => {
  const f = fixture({ env: { NODE_ENV: "development" } });
  assert.equal((await f.call({ headers: { origin: "http://127.0.0.1:8767" } })).status, 200);
});

test("rejects unsupported content type and oversized payload", async () => {
  const f = fixture();
  assert.equal((await f.call({ headers: { "content-type": "multipart/form-data" } })).status, 415);
  assert.equal((await f.call({ headers: { "content-length": "20001" } })).status, 413);
  assert.equal((await f.call({ body: { ...valid, ignored: "x".repeat(20001) } })).status, 413);
  assert.equal(f.sent.length, 0);
});

test("supports Vercel parsed JSON and raw URL-encoded form values", async () => {
  const f = fixture();
  assert.equal((await f.call({ body: JSON.stringify(valid), headers: { "content-type": "application/json" } })).status, 200);
  assert.equal((await f.call({ body: new URLSearchParams(valid).toString() })).status, 200);
  assert.equal((await f.call({ body: "{" , headers: { "content-type": "application/json" } })).status, 400);
  assert.equal((await f.call({ body: new URLSearchParams(valid).toString() + "&email=other%40example.com" })).status, 400);
});

test("bounds raw streams when runtime helpers are absent", async () => {
  const f = fixture();
  const run = async body => {
    const req = Readable.from([body]);
    req.method = "POST";
    req.headers = { origin: "https://www.fyftraducciones.com", "content-type": "application/x-www-form-urlencoded" };
    const res = { setHeader() {}, end() {} };
    await f.handler(req, res);
    return res.statusCode;
  };
  assert.equal(await run(new URLSearchParams(valid).toString()), 200);
  assert.equal(await run("x".repeat(20001)), 413);
});

test("limits attempts per warm instance and permits requests after window expiry", async () => {
  let time = 1000;
  const f = fixture({ now: () => time });
  for (let i = 0; i < 5; i++) assert.equal((await f.call()).status, 200);
  const limited = await f.call();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["Retry-After"], "60");
  assert.equal(f.sent.length, 5);
  assert.equal((await f.call({ headers: { "x-real-ip": "192.0.2.2" } })).status, 200);
  time += 60001;
  assert.equal((await f.call()).status, 200);
});

test("SMTP failure returns generic 502 without leaking error or clearing data", async () => {
  const f = fixture({ failure: true });
  const r = await f.call();
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { ok: false, error: "mail-delivery-failed" });
});

test("SMTP result must accept the fixed mailbox before reporting success", async () => {
  const f = fixture({ rejected: true });
  assert.equal((await f.call()).status, 502);
});
