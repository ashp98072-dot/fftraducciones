const MAILBOX = "fyftraducciones@gmail.com";
const SUBJECT = "Nueva solicitud de cotización - F&F Traducciones";
const MAX_BODY_BYTES = 20000;
const SERVICES = {
  translation: "Traducción",
  interpretation: "Interpretación",
  localization: "Localización",
  editing: "Corrección / Edición",
};
const COUNTRIES = {
  BZ: "Belice", CR: "Costa Rica", SV: "El Salvador", GT: "Guatemala",
  HN: "Honduras", NI: "Nicaragua", PA: "Panamá", OT: "Otro",
};

function allowedOrigin(origin, env) {
  const allowed = new Set([
    "https://www.fyftraducciones.com", "https://fyftraducciones.com",
    ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(Boolean).map(host => `https://${host}`),
  ]);
  if (allowed.has(origin)) return true;
  if (!env.VERCEL && env.NODE_ENV !== "production") {
    try {
      const url = new URL(origin);
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        && ["http:", "https:"].includes(url.protocol) && url.origin === origin;
    } catch { return false; }
  }
  return false;
}

async function readBody(req, type) {
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) throw new RangeError("body-too-large");
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (Buffer.byteLength(typeof body === "string" ? body : JSON.stringify(body)) > MAX_BODY_BYTES) {
    throw new RangeError("body-too-large");
  }
  if (typeof body === "string") {
    if (type === "application/json") return JSON.parse(body);
    const params = new URLSearchParams(body);
    if (new Set(params.keys()).size !== [...params.keys()].length) throw new Error("duplicate-field");
    return Object.fromEntries(params);
  }
  return body;
}

function createHandler({ createTransport, env = process.env, now = Date.now }) {
  // Best-effort throttling per warm instance; this is not a distributed limit.
  const attempts = new Map();
  let transport;
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const reply = (status, error) => {
      res.statusCode = status;
      res.end(JSON.stringify(error ? { ok: false, error } : { ok: true }));
    };
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return reply(405, "method-not-allowed");
    }
    if (!allowedOrigin(req.headers.origin, env)) return reply(403, "origin-not-allowed");
    const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!["application/x-www-form-urlencoded", "application/json"].includes(type)) {
      return reply(415, "unsupported-content-type");
    }
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) return reply(413, "body-too-large");
    let body;
    try { body = await readBody(req, type); }
    catch (error) { return reply(error instanceof RangeError ? 413 : 400, "invalid-body"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, "invalid-body");
    if (typeof body._gotcha === "string" && body._gotcha.trim()) return reply(200);
    const limits = { name: 150, email: 254, service: 30, message: 5000, phone: 50, country: 2, _gotcha: 200 };
    const fields = {};
    for (const [key, max] of Object.entries(limits)) {
      if (body[key] !== undefined && typeof body[key] !== "string") return reply(400, "invalid-fields");
      fields[key] = (body[key] || "").trim();
      if (fields[key].length > max) return reply(400, "invalid-fields");
    }
    if (!fields.name || !fields.message || /[\r\n\u0000]/.test(fields.name)
      || !/^[^\s@<>;,\u0000-\u001f\u007f]+@[^\s@<>;,\u0000-\u001f\u007f]+\.[^\s@<>;,\u0000-\u001f\u007f]+$/.test(fields.email)
      || !Object.hasOwn(SERVICES, fields.service)
      || (fields.country && !Object.hasOwn(COUNTRIES, fields.country))) {
      return reply(400, "invalid-fields");
    }
    const password = (env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
    if (!password) return reply(503, "mail-not-configured");
    const time = now();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    // Vercel supplies x-real-ip. Local/dev requests fall back to the socket.
    const ip = req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
    const attempt = attempts.get(ip) || { count: 0, until: time + 60000 };
    if (attempt.count >= 5 || (!attempts.has(ip) && attempts.size >= 1000)) {
      res.setHeader("Retry-After", "60");
      return reply(429, "too-many-requests");
    }
    attempt.count += 1;
    attempts.set(ip, attempt);
    try {
      transport ||= createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: MAILBOX, pass: password },
        connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
        tls: { minVersion: "TLSv1.2" },
        disableFileAccess: true, disableUrlAccess: true,
      });
      const result = await transport.sendMail({
        from: { name: "F&F Traducciones", address: MAILBOX },
        to: MAILBOX,
        replyTo: { name: fields.name, address: fields.email },
        subject: SUBJECT,
        text: [
          `Nombre: ${fields.name}`, `Correo: ${fields.email}`,
          `Teléfono / WhatsApp: ${fields.phone || "No indicado"}`,
          `País: ${COUNTRIES[fields.country] || "No indicado"}`,
          `Servicio: ${SERVICES[fields.service]}`, "", "Mensaje:", fields.message,
        ].join("\n"),
      });
      if (!result.accepted?.includes(MAILBOX)) return reply(502, "mail-delivery-failed");
      return reply(200);
    } catch {
      // Do not log client details, credentials, or SMTP responses.
      console.error("cotizacion: mail delivery failed");
      return reply(502, "mail-delivery-failed");
    }
  };
}

module.exports = { createHandler };
