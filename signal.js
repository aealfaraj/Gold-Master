const { randomUUID } = require("crypto");

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function parseBody(rawText) {
  const trimmed = rawText.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("No JSON alert found");
  }
  return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  return Number(value).toFixed(3);
}

function requireWebhookSecret(alert, webhookSecret) {
  if (alert.secret !== webhookSecret) {
    throw new HttpError(401, "Invalid webhook secret");
  }
}

function parseSignal(alert, webhookSecret) {
  requireWebhookSecret(alert, webhookSecret);

  const entry = toNumber(alert.avgEntry || alert.entry || alert.entryPrice || String(alert.entries || "").split("|")[0] || alert.price);
  const takeProfit = toNumber(alert.tp1 || alert.takeProfit || alert.tp);
  const takeProfit2 = toNumber(alert.tp2);
  const stopLoss = toNumber(alert.stopLoss || alert.sl);
  const direction = String(alert.direction || "").toUpperCase();
  const symbol = String(alert.symbol || "XAUUSD").toUpperCase();

  if (!["BUY", "SELL"].includes(direction)) {
    throw new HttpError(400, "direction must be BUY or SELL");
  }
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

function alertStatus(type) {
  if (type === "DYNAMIC_TP") return "TP Hit";
  if (type === "TP2_HIT") return "TP2 Hit";
  if (type === "SL_HIT") return "SL Hit";
  return "Active";
}

function isUpdateAlert(alert) {
  return ["DYNAMIC_TP", "TP2_HIT", "SL_HIT"].includes(String(alert.type || "").toUpperCase());
}

function parseSignalUpdate(alert, webhookSecret) {
  requireWebhookSecret(alert, webhookSecret);

  const type = String(alert.type || "").toUpperCase();
  const entry = toNumber(alert.avgEntry || alert.entry || alert.entryPrice || String(alert.entries || "").split("|")[0]);
  const takeProfit = toNumber(alert.tp1 || alert.takeProfit || alert.tp);
  const takeProfit2 = toNumber(alert.tp2);
  const stopLoss = toNumber(alert.stopLoss || alert.sl);
  const price = toNumber(alert.price);

  if (!isUpdateAlert(alert)) {
    throw new HttpError(400, "Alert is not a supported signal update");
  }
  if (!alert.sid) {
    throw new HttpError(400, "sid is required for signal update alerts");
  }

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

module.exports = {
  HttpError,
  applySignalUpdate,
  isUpdateAlert,
  parseBody,
  parseSignal,
  parseSignalUpdate,
  signalFromUpdate,
  publicSignal
};
