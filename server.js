const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  HttpError,
  applySignalUpdate,
  isUpdateAlert,
  parseBody,
  parseSignal,
  parseSignalUpdate,
  signalFromUpdate,
  publicSignal
} = require("./signal");

const PORT = Number(process.env.PORT || 4181);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-secret-token";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "change-this-tradingview-secret";
const DATA_FILE = path.join(__dirname, "..", "data", "signals.json");

function readSignals() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeSignals(signals) {
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

function requireAdmin(request) {
  const expected = `Bearer ${ADMIN_TOKEN}`;
  if (request.headers.authorization !== expected) {
    throw new HttpError(401, "Invalid admin token");
  }
}

function updateSignalStatus(id, status) {
  const allowed = ["Active", "Pending", "TP Hit", "TP2 Hit", "SL Hit", "Closed"];
  if (!allowed.includes(status)) {
    throw new HttpError(400, "Invalid status");
  }

  const signals = readSignals();
  const signal = signals.find(item => item.id === id);
  if (!signal) {
    throw new HttpError(404, "Signal not found");
  }

  signal.status = status;
  signal.updatedAt = new Date().toISOString();
  writeSignals(signals);
  return signal;
}

function pathParts(url) {
  return new URL(url, "http://localhost").pathname.split("/").filter(Boolean);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 200, { ok: true });
    return;
  }

  try {
    const parts = pathParts(request.url);

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, app: "Gold Master" });
      return;
    }

    if (request.method === "GET" && request.url === "/api/signals") {
      sendJson(response, 200, { signals: readSignals().map(publicSignal) });
      return;
    }

    if (request.method === "POST" && request.url === "/webhook/tradingview") {
      const alert = parseBody(await readBody(request));
      const signals = readSignals();
      if (isUpdateAlert(alert)) {
        const update = parseSignalUpdate(alert, WEBHOOK_SECRET);
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
        sendJson(response, 200, { ok: true, action, signal: publicSignal(signal) });
      } else {
        const signal = parseSignal(alert, WEBHOOK_SECRET);
        signals.unshift(signal);
        writeSignals(signals);
        sendJson(response, 201, { ok: true, action: "created", signal: publicSignal(signal) });
      }
      return;
    }

    if (request.method === "PATCH" && parts[0] === "admin" && parts[1] === "signals" && parts[3] === "status") {
      requireAdmin(request);
      const body = parseBody(await readBody(request));
      const signal = updateSignalStatus(parts[2], body.status);
      sendJson(response, 200, { ok: true, signal: publicSignal(signal) });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    sendJson(response, statusCode, { ok: false, error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gold Master backend running on port ${PORT}`);
});
