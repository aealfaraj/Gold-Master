const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT || 4181);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-secret-token";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "change-this-tradingview-secret";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DATA_FILE = path.join(__dirname, "signals.json");
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
}

function readSignals() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
  if (!raw) {
    writeSignals([]);
    return [];
  }
  try {
    const signals = JSON.parse(raw);
    return Array.isArray(signals) ? signals : [];
  } catch (error) {
    writeSignals([]);
    return [];
  }
}

function writeSignals(signals) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(signals, null, 2));
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new HttpError(response.status, payload?.message || payload?.error || "Supabase request failed");
  }
  return payload;
}

function toDbSignal(signal) {
  return {
    id: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    entry: signal.entry || null,
    take_profit: signal.takeProfit || null,
    take_profit_2: signal.takeProfit2 || null,
    stop_loss: signal.stopLoss || null,
    last_price: signal.lastPrice || null,
    status: signal.status,
    type: signal.type,
    timeframe: signal.timeframe || null,
    pnl: signal.pnl,
    notes: signal.notes || "",
    raw_alert: signal.rawAlert || {},
    created_at: signal.createdAt,
    updated_at: signal.updatedAt
  };
}

function fromDbSignal(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    direction: row.direction,
    entry: row.entry || "",
    takeProfit: row.take_profit || "",
    takeProfit2: row.take_profit_2 || "",
    stopLoss: row.stop_loss || "",
    lastPrice: row.last_price || "",
    status: row.status,
    type: row.type,
    timeframe: row.timeframe || "",
    pnl: row.pnl,
    notes: row.notes || "",
    rawAlert: row.raw_alert || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function readSignalsStore() {
  if (!USE_SUPABASE) return readSignals();
  const rows = await supabaseRequest("signals?select=*&order=created_at.desc");
  return rows.map(fromDbSignal);
}

async function createSignalStore(signal) {
  if (!USE_SUPABASE) {
    const signals = readSignals();
    signals.unshift(signal);
    writeSignals(signals);
    return signal;
  }
  const rows = await supabaseRequest("signals", {
    method: "POST",
    body: JSON.stringify(toDbSignal(signal))
  });
  return fromDbSignal(rows[0]);
}

async function updateSignalStore(signal) {
  if (!USE_SUPABASE) {
    const signals = readSignals();
    const index = signals.findIndex(item => item.id === signal.id);
    if (index === -1) signals.unshift(signal);
    else signals[index] = signal;
    writeSignals(signals);
    return signal;
  }
  const rows = await supabaseRequest(`signals?id=eq.${encodeURIComponent(signal.id)}`, {
    method: "PATCH",
    body: JSON.stringify(toDbSignal(signal))
  });
  return fromDbSignal(rows[0]);
}

async function findSignalStore(id) {
  if (!USE_SUPABASE) return readSignals().find(item => item.id === id) || null;
  const rows = await supabaseRequest(`signals?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] ? fromDbSignal(rows[0]) : null;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parseBody(rawText) {
  const trimmed = rawText.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON alert found");
  return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  return Number(value).toFixed(3);
}

function requireWebhookSecret(alert) {
  if (alert.secret !== WEBHOOK_SECRET) throw new HttpError(401, "Invalid webhook secret");
}

function parseSignal(alert) {
  requireWebhookSecret(alert);
  const entry = toNumber(alert.avgEntry || alert.entry || alert.entryPrice || String(alert.entries || "").split("|")[0] || alert.price);
  const takeProfit = toNumber(alert.tp1 || alert.takeProfit || alert.tp);
  const takeProfit2 = toNumber(alert.tp2);
  const stopLoss = toNumber(alert.stopLoss || alert.sl);
  const direction = String(alert.direction || "").toUpperCase();
  const symbol = String(alert.symbol || "XAUUSD").toUpperCase();

  if (!["BUY", "SELL"].includes(direction)) throw new HttpError(400, "direction must be BUY or SELL");
  if (!symbol || entry === null || takeProfit === null || stopLoss === null) {
    throw new HttpError(400, "symbol, entry/price, tp1, and sl are required");
  }

  return {
    id: String(alert.sid || randomUUID()),
    symbol,
    direction,
    entry: formatNumber(entry),
    takeProfit: formatNumber(takeProfit),
    takeProfit2: takeProfit2 === null ? "" : formatNumber(takeProfit2),
    stopLoss: formatNumber(stopLoss),
    status: "Active",
    type: String(alert.type || "PRO_SIGNAL"),
    timeframe: alert.timeframe ? String(alert.timeframe) : "",
    pnl: alert.pnl === undefined ? null : toNumber(alert.pnl),
    notes: [
      alert.type ? `Type: ${alert.type}` : "",
      alert.timeframe ? `Timeframe: ${alert.timeframe}m` : "",
      takeProfit2 === null ? "" : `TP2: ${formatNumber(takeProfit2)}`,
      alert.pnl !== undefined ? `Bot P/L: ${formatNumber(alert.pnl)}` : "",
      alert.sid ? `Signal ID: ${alert.sid}` : ""
    ].filter(Boolean).join(" | "),
    rawAlert: alert,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function isUpdateAlert(alert) {
  return ["DYNAMIC_TP", "TP2_HIT", "SL_HIT"].includes(String(alert.type || "").toUpperCase());
}

function alertStatus(type) {
  if (type === "DYNAMIC_TP") return "TP Hit";
  if (type === "TP2_HIT") return "TP2 Hit";
  if (type === "SL_HIT") return "SL Hit";
  return "Active";
}

function parseSignalUpdate(alert) {
  requireWebhookSecret(alert);
  const type = String(alert.type || "").toUpperCase();
  const entry = toNumber(alert.avgEntry || alert.entry || alert.entryPrice || String(alert.entries || "").split("|")[0]);
  const takeProfit = toNumber(alert.tp1 || alert.takeProfit || alert.tp);
  const takeProfit2 = toNumber(alert.tp2);
  const stopLoss = toNumber(alert.stopLoss || alert.sl);
  const price = toNumber(alert.price);

  if (!isUpdateAlert(alert)) throw new HttpError(400, "Alert is not a supported signal update");
  if (!alert.sid) throw new HttpError(400, "sid is required for signal update alerts");

  return {
    id: String(alert.sid),
    symbol: String(alert.symbol || "XAUUSD").toUpperCase(),
    direction: String(alert.direction || "").toUpperCase(),
    entry: entry === null ? "" : formatNumber(entry),
    takeProfit: takeProfit === null ? "" : formatNumber(takeProfit),
    takeProfit2: takeProfit2 === null ? "" : formatNumber(takeProfit2),
    stopLoss: stopLoss === null ? "" : formatNumber(stopLoss),
    price: price === null ? "" : formatNumber(price),
    status: alertStatus(type),
    type,
    timeframe: alert.timeframe ? String(alert.timeframe) : "",
    notes: [
      `Update: ${type}`,
      alert.timeframe ? `Timeframe: ${alert.timeframe}m` : "",
      price === null ? "" : `Price: ${formatNumber(price)}`,
      takeProfit === null ? "" : `TP1: ${formatNumber(takeProfit)}`,
      takeProfit2 === null ? "" : `TP2: ${formatNumber(takeProfit2)}`,
      stopLoss === null ? "" : `SL: ${formatNumber(stopLoss)}`,
      `Signal ID: ${alert.sid}`
    ].filter(Boolean).join(" | "),
    rawAlert: alert
  };
}

function applySignalUpdate(signal, update) {
  signal.symbol = update.symbol || signal.symbol;
  signal.direction = update.direction || signal.direction;
  if (update.entry) signal.entry = update.entry;
  if (update.takeProfit) signal.takeProfit = update.takeProfit;
  if (update.takeProfit2) signal.takeProfit2 = update.takeProfit2;
  if (update.stopLoss) signal.stopLoss = update.stopLoss;
  signal.status = update.status;
  signal.type = update.type;
  signal.timeframe = update.timeframe || signal.timeframe;
  signal.lastPrice = update.price;
  signal.notes = update.notes;
  signal.rawAlert = update.rawAlert;
  signal.updatedAt = new Date().toISOString();
  return signal;
}

function signalFromUpdate(update) {
  const now = new Date().toISOString();
  return {
    id: update.id,
    symbol: update.symbol || "XAUUSD",
    direction: update.direction || "",
    entry: update.entry,
    takeProfit: update.takeProfit,
    takeProfit2: update.takeProfit2,
    stopLoss: update.stopLoss,
    status: update.status,
    type: update.type,
    timeframe: update.timeframe,
    pnl: null,
    notes: update.notes,
    rawAlert: update.rawAlert,
    lastPrice: update.price,
    createdAt: now,
    updatedAt: now
  };
}

function publicSignal(signal) {
  return {
    id: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    entry: signal.entry,
    takeProfit: signal.takeProfit,
    takeProfit2: signal.takeProfit2,
    stopLoss: signal.stopLoss,
    lastPrice: signal.lastPrice || "",
    status: signal.status,
    type: signal.type,
    timeframe: signal.timeframe,
    notes: signal.notes,
    createdAt: signal.createdAt,
    updatedAt: signal.updatedAt
  };
}

function requireAdmin(request) {
  const expected = `Bearer ${ADMIN_TOKEN}`;
  if (request.headers.authorization !== expected) throw new HttpError(401, "Invalid admin token");
}

async function updateSignalStatus(id, status) {
  const allowed = ["Active", "Pending", "TP Hit", "TP2 Hit", "SL Hit", "Closed"];
  if (!allowed.includes(status)) throw new HttpError(400, "Invalid status");

  const signal = await findSignalStore(id);
  if (!signal) throw new HttpError(404, "Signal not found");

  signal.status = status;
  signal.updatedAt = new Date().toISOString();
  return updateSignalStore(signal);
}

function pathParts(url) {
  return new URL(url, "http://localhost").pathname.split("/").filter(Boolean);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 200, { ok: true });

  try {
    const parts = pathParts(request.url);

    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, {
        ok: true,
        app: "Gold Master",
        storage: USE_SUPABASE ? "supabase" : "signals.json"
      });
    }

    if (request.method === "GET" && request.url === "/api/signals") {
      const signals = await readSignalsStore();
      return sendJson(response, 200, { signals: signals.map(publicSignal) });
    }

    if (request.method === "POST" && request.url === "/webhook/tradingview") {
      const alert = parseBody(await readBody(request));
      console.log(`[webhook] received type=${alert.type || "unknown"} symbol=${alert.symbol || "unknown"} sid=${alert.sid || "none"}`);
      if (isUpdateAlert(alert)) {
        const update = parseSignalUpdate(alert);
        let signal = await findSignalStore(update.id);
        let action = "updated";
        if (signal) {
          applySignalUpdate(signal, update);
        } else {
          signal = signalFromUpdate(update);
          action = "created_from_update";
        }
        await updateSignalStore(signal);
        console.log(`[webhook] ${action} signal id=${signal.id} status=${signal.status}`);
        return sendJson(response, 200, { ok: true, action, signal: publicSignal(signal) });
      }

      const signal = parseSignal(alert);
      await createSignalStore(signal);
      console.log(`[webhook] created signal id=${signal.id} status=${signal.status}`);
      return sendJson(response, 201, { ok: true, action: "created", signal: publicSignal(signal) });
    }

    if (request.method === "PATCH" && parts[0] === "admin" && parts[1] === "signals" && parts[3] === "status") {
      requireAdmin(request);
      const body = parseBody(await readBody(request));
      const signal = await updateSignalStatus(parts[2], body.status);
      return sendJson(response, 200, { ok: true, signal: publicSignal(signal) });
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(`[error] ${request.method} ${request.url}: ${error.message}`);
    sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gold Master backend running on port ${PORT}`);
});
