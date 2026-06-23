const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT || 4181);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-secret-token";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "change-this-tradingview-secret";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "signals.json");

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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

function updateSignalStatus(id, status) {
  const allowed = ["Active", "Pending", "TP Hit", "TP2 Hit", "SL Hit", "Closed"];
  if (!allowed.includes(status)) throw new HttpError(400, "Invalid status");

  const signals = readSignals();
  const signal = signals.find(item => item.id === id);
  if (!signal) throw new HttpError(404, "Signal not found");

  signal.status = status;
  signal.updatedAt = new Date().toISOString();
  writeSignals(signals);
  return signal;
}

function pathParts(url) {
  return new URL(url, "http://localhost").pathname.split("/").filter(Boolean);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 200, { ok: true });

  try {
    const parts = pathParts(request.url);

    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { ok: true, app: "Gold Master" });
    }

    if (request.method === "GET" && request.url === "/api/signals") {
      return sendJson(response, 200, { signals: readSignals().map(publicSignal) });
    }

    if (request.method === "POST" && request.url === "/webhook/tradingview") {
      const alert = parseBody(await readBody(request));
      const signals = readSignals();
      if (isUpdateAlert(alert)) {
        const update = parseSignalUpdate(alert);
        let signal = signals.find(item => item.id === update.id);
        let action = "updated";
        if (signal) {
          applySignalUpdate(signal, update);
        } else {
          signal = signalFromUpdate(update);
          signals.unshift(signal);
          action = "created_from_update";
        }
        writeSignals(signals);
        return sendJson(response, 200, { ok: true, action, signal: publicSignal(signal) });
      }

      const signal = parseSignal(alert);
      signals.unshift(signal);
      writeSignals(signals);
      return sendJson(response, 201, { ok: true, action: "created", signal: publicSignal(signal) });
    }

    if (request.method === "PATCH" && parts[0] === "admin" && parts[1] === "signals" && parts[3] === "status") {
      requireAdmin(request);
      const body = parseBody(await readBody(request));
      const signal = updateSignalStatus(parts[2], body.status);
      return sendJson(response, 200, { ok: true, signal: publicSignal(signal) });
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(response, error.statusCode || 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gold Master backend running on port ${PORT}`);
});
