import crypto from "node:crypto"
import http from "node:http"
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem"

const PRICE_SCALE = 1_000_000n
const PORT = Number(process.env.AUCTION_SERVICE_PORT ?? 8080)
const AUCTION_PRIVATE_KEY_PEM = process.env.AUCTION_SERVICE_PRIVATE_KEY ?? ""
const settlementHashParams = parseAbiParameters(
  "uint64 marketId, uint64 epoch, uint96 clearingPrice, bytes32 settlementRoot, int256 totalYesSharesDelta, int256 totalNoSharesDelta"
)
const settlementLeafParams = parseAbiParameters(
  "uint64 marketId, uint64 epoch, address trader, uint128 reservedCollateralSpent, uint128 reservedCollateralRefunded, uint128 collateralCredit, int128 yesSharesDelta, int128 noSharesDelta"
)

const respond = (res, statusCode, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  })
  res.end(body)
}

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8")
        resolve(body.length === 0 ? {} : JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })

const base64ToBuffer = (value) => Buffer.from(value, "base64")

const parsePayload = (jsonText) => {
  const payload = JSON.parse(jsonText)
  if (!payload.side || !payload.outcome || !payload.size || !payload.limitPrice) {
    throw new Error("Invalid order payload")
  }
  return payload
}

const decryptEnvelopePayload = (payload, order) => {
  if (!AUCTION_PRIVATE_KEY_PEM) {
    throw new Error("AUCTION_SERVICE_PRIVATE_KEY is required to decrypt encrypted orders")
  }
  if (payload.version !== 1 || payload.alg !== "RSA-OAEP-256/AES-256-GCM") {
    throw new Error("Unsupported encrypted order envelope")
  }

  const aesKey = crypto.privateDecrypt(
    {
      key: AUCTION_PRIVATE_KEY_PEM,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    base64ToBuffer(payload.encryptedKey)
  )
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, base64ToBuffer(payload.iv))
  const ciphertext = base64ToBuffer(payload.ciphertext)
  const authTag = ciphertext.subarray(ciphertext.length - 16)
  const encryptedBody = ciphertext.subarray(0, ciphertext.length - 16)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(encryptedBody), decipher.final()]).toString("utf8")
  const decoded = parsePayload(plaintext)
  if (decoded.marketId !== String(order.marketId)) {
    throw new Error(`Order ${order.orderId} marketId mismatch after decryption`)
  }
  if (decoded.submittedBy && decoded.submittedBy.toLowerCase() !== order.trader.toLowerCase()) {
    throw new Error(`Order ${order.orderId} trader mismatch after decryption`)
  }
  return decoded
}

const decodeCiphertext = (ciphertext, order) => {
  const hex = ciphertext.startsWith("0x") ? ciphertext.slice(2) : ciphertext
  const decoded = Buffer.from(hex, "hex").toString("utf8")
  const payload = JSON.parse(decoded)
  const isEncryptedEnvelope = payload && payload.version === 1 && payload.alg && payload.encryptedKey && payload.iv && payload.ciphertext
  const resolvedPayload = isEncryptedEnvelope ? decryptEnvelopePayload(payload, order) : parsePayload(decoded)
  return {
    side: resolvedPayload.side,
    outcome: resolvedPayload.outcome,
    size: BigInt(resolvedPayload.size),
    limitPrice: BigInt(resolvedPayload.limitPrice),
  }
}

const canonicalizeOrder = (order) => {
  const decoded = decodeCiphertext(order.ciphertext, order)
  if (decoded.limitPrice < 0n || decoded.limitPrice > PRICE_SCALE) {
    throw new Error(`Order ${order.orderId} has invalid limit price`)
  }
  if (decoded.size <= 0n) {
    throw new Error(`Order ${order.orderId} has invalid size`)
  }

  let canonicalSide
  let effectiveYesLimitPrice

  if (decoded.outcome === "YES" && decoded.side === "BUY") {
    canonicalSide = "BUY"
    effectiveYesLimitPrice = decoded.limitPrice
  } else if (decoded.outcome === "YES" && decoded.side === "SELL") {
    canonicalSide = "SELL"
    effectiveYesLimitPrice = decoded.limitPrice
  } else if (decoded.outcome === "NO" && decoded.side === "BUY") {
    canonicalSide = "SELL"
    effectiveYesLimitPrice = PRICE_SCALE - decoded.limitPrice
  } else if (decoded.outcome === "NO" && decoded.side === "SELL") {
    canonicalSide = "BUY"
    effectiveYesLimitPrice = PRICE_SCALE - decoded.limitPrice
  } else {
    throw new Error(`Order ${order.orderId} has unsupported side/outcome`) 
  }

  return {
    ...order,
    submittedAt: BigInt(order.submittedAt),
    epochLockedCollateral: BigInt(order.epochLockedCollateral),
    size: decoded.size,
    originalSide: decoded.side,
    originalOutcome: decoded.outcome,
    canonicalSide,
    effectiveYesLimitPrice,
  }
}

const getCandidatePrices = (orders) => {
  const unique = new Set(orders.map((order) => order.effectiveYesLimitPrice.toString()))
  return [...unique].map((value) => BigInt(value)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

const chooseClearingPrice = (orders) => {
  const prices = getCandidatePrices(orders)
  if (prices.length === 0) {
    return 0n
  }

  let bestPrice = prices[0]
  let bestMatched = -1n
  let bestImbalance = 0n

  for (const price of prices) {
    const buyVolume = orders
      .filter((order) => order.canonicalSide === "BUY" && order.effectiveYesLimitPrice >= price)
      .reduce((acc, order) => acc + order.size, 0n)
    const sellVolume = orders
      .filter((order) => order.canonicalSide === "SELL" && order.effectiveYesLimitPrice <= price)
      .reduce((acc, order) => acc + order.size, 0n)
    const matched = buyVolume < sellVolume ? buyVolume : sellVolume
    const imbalance = buyVolume > sellVolume ? buyVolume - sellVolume : sellVolume - buyVolume

    if (matched > bestMatched || (matched === bestMatched && imbalance < bestImbalance)) {
      bestPrice = price
      bestMatched = matched
      bestImbalance = imbalance
    }
  }

  return bestPrice
}

const sortBuys = (left, right) => {
  if (left.effectiveYesLimitPrice !== right.effectiveYesLimitPrice) {
    return left.effectiveYesLimitPrice > right.effectiveYesLimitPrice ? -1 : 1
  }
  if (left.submittedAt !== right.submittedAt) {
    return left.submittedAt < right.submittedAt ? -1 : 1
  }
  return BigInt(left.orderId) < BigInt(right.orderId) ? -1 : 1
}

const sortSells = (left, right) => {
  if (left.effectiveYesLimitPrice !== right.effectiveYesLimitPrice) {
    return left.effectiveYesLimitPrice < right.effectiveYesLimitPrice ? -1 : 1
  }
  if (left.submittedAt !== right.submittedAt) {
    return left.submittedAt < right.submittedAt ? -1 : 1
  }
  return BigInt(left.orderId) < BigInt(right.orderId) ? -1 : 1
}

const allocateFills = (orders, clearingPrice) => {
  const activeBuys = orders.filter((order) => order.canonicalSide === "BUY" && order.effectiveYesLimitPrice >= clearingPrice).sort(sortBuys)
  const activeSells = orders.filter((order) => order.canonicalSide === "SELL" && order.effectiveYesLimitPrice <= clearingPrice).sort(sortSells)
  const fills = new Map(orders.map((order) => [order.orderId, 0n]))

  let buyIndex = 0
  let sellIndex = 0
  let remainingBuy = activeBuys[0]?.size ?? 0n
  let remainingSell = activeSells[0]?.size ?? 0n

  while (buyIndex < activeBuys.length && sellIndex < activeSells.length) {
    const fillSize = remainingBuy < remainingSell ? remainingBuy : remainingSell
    if (fillSize === 0n) {
      break
    }

    fills.set(activeBuys[buyIndex].orderId, fills.get(activeBuys[buyIndex].orderId) + fillSize)
    fills.set(activeSells[sellIndex].orderId, fills.get(activeSells[sellIndex].orderId) + fillSize)

    remainingBuy -= fillSize
    remainingSell -= fillSize

    if (remainingBuy === 0n) {
      buyIndex += 1
      remainingBuy = activeBuys[buyIndex]?.size ?? 0n
    }

    if (remainingSell === 0n) {
      sellIndex += 1
      remainingSell = activeSells[sellIndex]?.size ?? 0n
    }
  }

  return fills
}

const getOutcomeClearingPrice = (order, clearingYesPrice) =>
  order.originalOutcome === "YES" ? clearingYesPrice : PRICE_SCALE - clearingYesPrice

const settlementKey = (trader) => trader.toLowerCase()

const emptySettlement = (trader) => ({
  trader,
  epochLockedCollateral: 0n,
  reservedCollateralSpent: 0n,
  reservedCollateralRefunded: 0n,
  collateralCredit: 0n,
  yesSharesDelta: 0n,
  noSharesDelta: 0n,
})

const buildSettlements = (orders, fills, clearingYesPrice) => {
  const byTrader = new Map()

  for (const order of orders) {
    const fillSize = fills.get(order.orderId) ?? 0n
    const key = settlementKey(order.trader)
    const current = byTrader.get(key) ?? emptySettlement(order.trader)
    const outcomePrice = getOutcomeClearingPrice(order, clearingYesPrice)

    if (current.epochLockedCollateral === 0n) {
      current.epochLockedCollateral = order.epochLockedCollateral
    } else if (current.epochLockedCollateral !== order.epochLockedCollateral) {
      throw new Error(`Trader ${order.trader} has inconsistent epoch collateral across submitted orders`)
    }

    if (order.originalSide === "BUY") {
      const spend = (fillSize * outcomePrice) / PRICE_SCALE
      current.reservedCollateralSpent += spend
      if (order.originalOutcome === "YES") {
        current.yesSharesDelta += fillSize
      } else {
        current.noSharesDelta += fillSize
      }
    } else {
      current.collateralCredit += (fillSize * outcomePrice) / PRICE_SCALE
      if (order.originalOutcome === "YES") {
        current.yesSharesDelta -= fillSize
      } else {
        current.noSharesDelta -= fillSize
      }
    }

    byTrader.set(key, current)
  }

  return [...byTrader.values()].map((settlement) => ({
    ...(settlement.reservedCollateralSpent > settlement.epochLockedCollateral
      ? (() => {
          throw new Error(`Trader ${settlement.trader} is undercollateralized for the computed fills`)
        })()
      : {}),
    trader: settlement.trader,
    reservedCollateralSpent: settlement.reservedCollateralSpent.toString(),
    reservedCollateralRefunded: (settlement.epochLockedCollateral - settlement.reservedCollateralSpent).toString(),
    collateralCredit: settlement.collateralCredit.toString(),
    yesSharesDelta: settlement.yesSharesDelta.toString(),
    noSharesDelta: settlement.noSharesDelta.toString(),
  }))
}

const aggregateShareDeltas = (settlements) => {
  return settlements.reduce(
    (totals, settlement) => ({
      totalYesSharesDelta: totals.totalYesSharesDelta + BigInt(settlement.yesSharesDelta),
      totalNoSharesDelta: totals.totalNoSharesDelta + BigInt(settlement.noSharesDelta),
    }),
    {
      totalYesSharesDelta: 0n,
      totalNoSharesDelta: 0n,
    }
  )
}

const hashPair = (left, right) => {
  const [first, second] = left.toLowerCase() <= right.toLowerCase() ? [left, right] : [right, left]
  return keccak256(`${first}${second.slice(2)}`)
}

const hashSettlementLeaf = (marketId, epoch, settlement) => {
  return keccak256(
    encodeAbiParameters(settlementLeafParams, [
      BigInt(marketId),
      BigInt(epoch),
      settlement.trader,
      BigInt(settlement.reservedCollateralSpent),
      BigInt(settlement.reservedCollateralRefunded),
      BigInt(settlement.collateralCredit),
      BigInt(settlement.yesSharesDelta),
      BigInt(settlement.noSharesDelta),
    ])
  )
}

const buildMerkleClaims = (marketId, epoch, settlements) => {
  const leaves = settlements.map((settlement) => hashSettlementLeaf(marketId, epoch, settlement))
  if (leaves.length === 0) {
    throw new Error("Cannot finalize an empty settlement set")
  }

  const proofs = settlements.map(() => [])
  let level = leaves.map((leaf, index) => ({ hash: leaf, indexes: [index] }))

  while (level.length > 1) {
    const nextLevel = []

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = level[i + 1]

      if (!right) {
        nextLevel.push(left)
        continue
      }

      for (const index of left.indexes) {
        proofs[index].push(right.hash)
      }
      for (const index of right.indexes) {
        proofs[index].push(left.hash)
      }

      nextLevel.push({
        hash: hashPair(left.hash, right.hash),
        indexes: [...left.indexes, ...right.indexes],
      })
    }

    level = nextLevel
  }

  return {
    settlementRoot: level[0].hash,
    claims: settlements.map((settlement, index) => ({
      settlement,
      merkleProof: proofs[index],
    })),
  }
}

const computeSettlementHash = (payload) => {
  if (!payload.settlementRoot) {
    throw new Error("Missing settlementRoot")
  }

  return keccak256(
    encodeAbiParameters(settlementHashParams, [
      BigInt(payload.marketId),
      BigInt(payload.epoch),
      BigInt(payload.clearingPrice),
      payload.settlementRoot,
      BigInt(payload.totalYesSharesDelta),
      BigInt(payload.totalNoSharesDelta),
    ])
  )
}

const settleEpoch = (requestBody) => {
  const canonicalOrders = requestBody.orders.map(canonicalizeOrder)
  const clearingPrice = chooseClearingPrice(canonicalOrders)
  const fills = allocateFills(canonicalOrders, clearingPrice)
  const settlements = buildSettlements(canonicalOrders, fills, clearingPrice)
  const shareDeltaTotals = aggregateShareDeltas(settlements)
  const merkleClaims = buildMerkleClaims(requestBody.marketId, requestBody.epoch, settlements)
  const basePayload = {
    marketId: requestBody.marketId,
    epoch: requestBody.epoch,
    clearingPrice: clearingPrice.toString(),
    settlementRoot: merkleClaims.settlementRoot,
    totalYesSharesDelta: shareDeltaTotals.totalYesSharesDelta.toString(),
    totalNoSharesDelta: shareDeltaTotals.totalNoSharesDelta.toString(),
    claims: merkleClaims.claims,
  }

  return {
    ...basePayload,
    settlementHash: computeSettlementHash(basePayload),
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      respond(res, 200, { ok: true })
      return
    }

    if (req.method !== "POST" || req.url !== "/settle-epoch") {
      respond(res, 404, { error: "Not found" })
      return
    }

    const body = await readJsonBody(req)
    const settlement = settleEpoch(body)
    respond(res, 200, settlement)
  } catch (error) {
    respond(res, 400, { error: error instanceof Error ? error.message : "Unknown error" })
  }
})

server.listen(PORT, () => {
  process.stdout.write(`auction service listening on ${PORT}\n`)
})
