const assert = require("assert");
const {
  applySignalUpdate,
  isUpdateAlert,
  parseBody,
  parseSignal,
  parseSignalUpdate,
  signalFromUpdate
} = require("./signal");

const secret = "change-this-tradingview-secret";

const proSignal = parseSignal(parseBody(JSON.stringify({
  secret,
  type: "PRO_SIGNAL",
  direction: "BUY",
  symbol: "XAUUSD",
  timeframe: "15",
  price: 4130.135,
  tp1: 4135.988,
  tp2: 4141.005,
  sl: 4110.923,
  sid: 680
})), secret);

assert.equal(proSignal.symbol, "XAUUSD");
assert.equal(proSignal.direction, "BUY");
assert.equal(proSignal.entry, "4130.135");
assert.equal(proSignal.takeProfit, "4135.988");
assert.equal(proSignal.takeProfit2, "4141.005");
assert.equal(proSignal.stopLoss, "4110.923");

const reversalSignal = parseSignal(parseBody(JSON.stringify({
  secret,
  type: "REVERSAL",
  prevDirection: "SELL",
  direction: "BUY",
  symbol: "XAUUSD",
  timeframe: "15",
  entries: "4118.325|4105.095",
  entryCount: 2,
  avgEntry: 4111.710,
  price: 4130.135,
  tp1: 4135.988,
  tp2: 4141.005,
  sl: 4110.923,
  sid: 681
})), secret);

assert.equal(reversalSignal.entry, "4111.710");
assert.equal(reversalSignal.stopLoss, "4110.923");

assert.throws(() => parseSignal({ ...proSignal.rawAlert, secret: "wrong" }, secret), /Invalid webhook secret/);

const dynamicTp = parseSignalUpdate(parseBody(JSON.stringify({
  secret,
  type: "DYNAMIC_TP",
  direction: "SELL",
  symbol: "XAUUSD",
  timeframe: "60",
  entryPrice: 4121.245,
  tp1: 4113.545,
  price: 4113.545,
  sid: 1128
})), secret);

assert.equal(isUpdateAlert(dynamicTp.rawAlert), true);
assert.equal(dynamicTp.id, "1128");
assert.equal(dynamicTp.status, "TP Hit");
assert.equal(dynamicTp.entry, "4121.245");
assert.equal(dynamicTp.takeProfit, "4113.545");

const tp2Hit = parseSignalUpdate(parseBody(JSON.stringify({
  secret,
  type: "TP2_HIT",
  direction: "SELL",
  symbol: "XAUUSD",
  timeframe: "60",
  entryPrice: 4121.245,
  tp2: 4094.294,
  price: 4094.294,
  sid: 1128
})), secret);

assert.equal(tp2Hit.status, "TP2 Hit");
assert.equal(tp2Hit.takeProfit2, "4094.294");

const slHit = parseSignalUpdate(parseBody(JSON.stringify({
  secret,
  type: "SL_HIT",
  direction: "SELL",
  symbol: "XAUUSD",
  timeframe: "15",
  entryPrice: 4105.095,
  sl: 4131.159,
  price: 4129.685,
  sid: 679
})), secret);

assert.equal(slHit.status, "SL Hit");
assert.equal(slHit.stopLoss, "4131.159");

const storedFromUpdate = signalFromUpdate(dynamicTp);
applySignalUpdate(storedFromUpdate, tp2Hit);
assert.equal(storedFromUpdate.status, "TP2 Hit");
assert.equal(storedFromUpdate.takeProfit2, "4094.294");

console.log("Gold Master backend self-test passed");
