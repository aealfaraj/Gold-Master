# Gold Master Backend

This is the first real backend for Gold Master. It receives TradingView alerts, saves signals, exposes signal history to the app, and lets you update a signal status from an admin tool.

## Run Locally

```powershell
cd C:\Users\Abdullah\Documents\Codex\2026-06-23\i-want-to-create-an-app\outputs\gold-master-backend
$env:ADMIN_TOKEN="change-this-secret-token"
$env:WEBHOOK_SECRET="change-this-tradingview-secret"
npm start
```

Health check:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:4181/health
```

Run parser tests:

```powershell
npm test
```

## Deploy on Render

Render setup:

```text
Service type: Web Service
Runtime: Node
Root Directory: outputs/gold-master-backend
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

Environment variables:

```text
ADMIN_TOKEN=make-a-long-private-admin-password
WEBHOOK_SECRET=make-a-long-private-tradingview-secret
SUPABASE_URL=https://yotojishckkmygmcrlrr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

After Render deploys, test:

```text
https://your-render-service.onrender.com/health
```

TradingView webhook URL:

```text
https://your-render-service.onrender.com/webhook/tradingview
```

## Supabase Setup

In Supabase, open SQL Editor and run the contents of:

```text
supabase-schema.sql
```

Then in Render, add these environment variables:

```text
SUPABASE_URL=https://yotojishckkmygmcrlrr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Use the service role key only inside Render environment variables. Do not put it in GitHub or in client-side app code.

After redeploying, `GET /api/signals` will read from Supabase. If the Supabase variables are missing, the backend falls back to local `signals.json`.

## TradingView Webhook URL

For local testing:

```text
http://127.0.0.1:4181/webhook/tradingview
```

For the real app, this must be deployed online, then TradingView will use:

```text
https://your-domain.com/webhook/tradingview
```

## TradingView Alert Message

Use this format. The `secret` protects the webhook so random people cannot send fake signals.

```json
{
  "secret": "change-this-tradingview-secret",
  "type": "PRO_SIGNAL",
  "direction": "BUY",
  "symbol": "XAUUSD",
  "timeframe": "15",
  "price": 4130.135,
  "tp1": 4135.988,
  "tp2": 4141.005,
  "sl": 4110.923,
  "sid": 680
}
```

The backend also supports your reversal format:

```json
{
  "secret": "change-this-tradingview-secret",
  "type": "REVERSAL",
  "prevDirection": "SELL",
  "direction": "BUY",
  "symbol": "XAUUSD",
  "timeframe": "15",
  "entries": "4118.325|4105.095",
  "entryCount": 2,
  "avgEntry": 4111.710,
  "price": 4130.135,
  "tp1": 4135.988,
  "tp2": 4141.005,
  "sl": 4110.923,
  "sid": 680
}
```

## Signal Update Alerts

These alerts update an existing signal using `sid`.

Dynamic TP / TP1 hit:

```json
{
  "secret": "change-this-tradingview-secret",
  "type": "DYNAMIC_TP",
  "direction": "SELL",
  "symbol": "XAUUSD",
  "timeframe": "60",
  "entryPrice": 4121.245,
  "tp1": 4113.545,
  "price": 4113.545,
  "sid": 1128
}
```

TP2 hit:

```json
{
  "secret": "change-this-tradingview-secret",
  "type": "TP2_HIT",
  "direction": "SELL",
  "symbol": "XAUUSD",
  "timeframe": "60",
  "entryPrice": 4121.245,
  "tp2": 4094.294,
  "price": 4094.294,
  "sid": 1128
}
```

SL hit:

```json
{
  "secret": "change-this-tradingview-secret",
  "type": "SL_HIT",
  "direction": "SELL",
  "symbol": "XAUUSD",
  "timeframe": "15",
  "entryPrice": 4105.095,
  "sl": 4131.159,
  "price": 4129.685,
  "sid": 679
}
```

## Endpoints

`POST /webhook/tradingview`

Receives TradingView alerts and saves them.

`GET /api/signals`

Returns saved signal history for the app.

`PATCH /admin/signals/:id/status`

Updates a signal status. Requires this header:

```text
Authorization: Bearer change-this-secret-token
```

Body:

```json
{
  "status": "TP Hit"
}
```
