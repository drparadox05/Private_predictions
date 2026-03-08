import {
  bytesToHex,
  consensusIdenticalAggregation,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  hexToBase64,
  HTTPClient,
  prepareReportRequest,
  Runner,
  type EVMLog,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk"
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem"
import { z } from "zod"

const configSchema = z.object({
  chainSelectorName: z.string(),
  marketAddress: z.string(),
  receiverAddress: z.string(),
  auctionServiceUrl: z.string().min(1),
  gasLimit: z.string(),
  isTestnet: z.boolean(),
})

type Config = z.infer<typeof configSchema>

type SettlementReport = {
  marketId: bigint
  epoch: bigint
  clearingPrice: bigint
  settlementRoot: Hex
  totalYesSharesDelta: bigint
  totalNoSharesDelta: bigint
  settlementHash: Hex
}

type CREReportEnvelope = {
  reportType: number
  payload: Hex
}

type OrderRecord = {
  orderId: bigint
  trader: Address
  marketId: bigint
  epoch: bigint
  epochLockedCollateral: bigint
  submittedAt: bigint
  ciphertext: Hex
}

type AuctionServiceRequest = {
  marketAddress: Address
  marketId: string
  epoch: string
  orderIds: string[]
  orders: Array<{
    orderId: string
    trader: Address
    marketId: string
    epoch: string
    epochLockedCollateral: string
    submittedAt: string
    ciphertext: Hex
  }>
}

type AuctionServiceResponse = {
  marketId: string
  epoch: string
  clearingPrice: string
  settlementRoot: Hex
  totalYesSharesDelta: string
  totalNoSharesDelta: string
  settlementHash: Hex
}

const marketAbi = parseAbi([
  "event EpochSettlementRequested(uint64 indexed marketId, uint64 indexed epoch)",
  "function getEpochOrderIds(uint64 marketId, uint64 epoch) view returns (uint256[])",
  "function orders(uint256 orderId) view returns (address trader, uint64 marketId, uint64 epoch, uint40 submittedAt, bytes ciphertext)",
  "function epochReservedCollateral(uint64 marketId, uint64 epoch, address trader) view returns (uint256)",
])

const settlementReportParams = parseAbiParameters(
  "(uint64 marketId,uint64 epoch,uint96 clearingPrice,bytes32 settlementRoot,int256 totalYesSharesDelta,int256 totalNoSharesDelta,bytes32 settlementHash)"
)
const creReportEnvelopeParams = parseAbiParameters("(uint8 reportType,bytes payload)")
const CRE_REPORT_TYPE_SETTLEMENT = 1

const fetchAuctionSettlement = (
  sendRequester: HTTPSendRequester,
  auctionServiceUrl: string,
  payload: AuctionServiceRequest,
): AuctionServiceResponse => {
  const body = hexToBase64(bytesToHex(new TextEncoder().encode(JSON.stringify(payload))))
  const response = sendRequester
    .sendRequest({
      url: auctionServiceUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    })
    .result()

  if (response.statusCode !== 200) {
    throw new Error(`Auction service failed with status ${response.statusCode}`)
  }

  const responseText = new TextDecoder().decode(response.body)
  return JSON.parse(responseText) as AuctionServiceResponse
}

const readEpochOrderIds = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  marketAddress: Address,
  marketId: bigint,
  epoch: bigint,
): bigint[] => {
  const callData = encodeFunctionData({
    abi: marketAbi,
    functionName: "getEpochOrderIds",
    args: [marketId, epoch],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: marketAddress,
        data: callData,
      }),
    })
    .result()

  return decodeFunctionResult({
    abi: marketAbi,
    functionName: "getEpochOrderIds",
    data: bytesToHex(contractCall.data),
  }) as bigint[]
}

const readOrder = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  marketAddress: Address,
  orderId: bigint,
): OrderRecord => {
  const callData = encodeFunctionData({
    abi: marketAbi,
    functionName: "orders",
    args: [orderId],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: marketAddress,
        data: callData,
      }),
    })
    .result()

  const [trader, marketId, epoch, submittedAt, ciphertext] = decodeFunctionResult({
    abi: marketAbi,
    functionName: "orders",
    data: bytesToHex(contractCall.data),
  }) as readonly [Address, bigint, bigint, number, Hex]

  const collateralCallData = encodeFunctionData({
    abi: marketAbi,
    functionName: "epochReservedCollateral",
    args: [marketId, epoch, trader],
  })

  const collateralCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: marketAddress,
        data: collateralCallData,
      }),
    })
    .result()

  const epochLockedCollateral = decodeFunctionResult({
    abi: marketAbi,
    functionName: "epochReservedCollateral",
    data: bytesToHex(collateralCall.data),
  }) as bigint

  return {
    orderId,
    trader,
    marketId,
    epoch,
    epochLockedCollateral,
    submittedAt: BigInt(submittedAt),
    ciphertext,
  }
}

const toAuctionPayload = (
  marketAddress: Address,
  marketId: bigint,
  epoch: bigint,
  orders: OrderRecord[],
): AuctionServiceRequest => {
  return {
    marketAddress,
    marketId: marketId.toString(),
    epoch: epoch.toString(),
    orderIds: orders.map((order) => order.orderId.toString()),
    orders: orders.map((order) => ({
      orderId: order.orderId.toString(),
      trader: order.trader,
      marketId: order.marketId.toString(),
      epoch: order.epoch.toString(),
      epochLockedCollateral: order.epochLockedCollateral.toString(),
      submittedAt: order.submittedAt.toString(),
      ciphertext: order.ciphertext,
    })),
  }
}

const normalizeSettlementReport = (response: AuctionServiceResponse): SettlementReport => {
  if (
    !response.settlementRoot ||
    !response.settlementHash ||
    response.totalYesSharesDelta === undefined ||
    response.totalNoSharesDelta === undefined
  ) {
    throw new Error(`Invalid auction settlement response: ${JSON.stringify(response)}`)
  }

  return {
    marketId: BigInt(response.marketId),
    epoch: BigInt(response.epoch),
    clearingPrice: BigInt(response.clearingPrice),
    settlementRoot: response.settlementRoot,
    totalYesSharesDelta: BigInt(response.totalYesSharesDelta),
    totalNoSharesDelta: BigInt(response.totalNoSharesDelta),
    settlementHash: response.settlementHash,
  }
}

const onEpochSettlementRequested = (runtime: Runtime<Config>, log: EVMLog): string => {
  const marketAddress = runtime.config.marketAddress as Address
  const receiverAddress = runtime.config.receiverAddress as Address

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: runtime.config.isTestnet,
  })

  if (!network) {
    throw new Error(`Network not found: ${runtime.config.chainSelectorName}`)
  }

  const eventTopics = log.topics.map((topic: Uint8Array) => bytesToHex(topic) as Hex)
  if (eventTopics.length === 0) {
    throw new Error("Settlement request log missing topics")
  }

  const decodedLog = decodeEventLog({
    abi: marketAbi,
    eventName: "EpochSettlementRequested",
    topics: eventTopics as [Hex, ...Hex[]],
    data: bytesToHex(log.data),
  })

  const marketId = decodedLog.args.marketId as bigint
  const epoch = decodedLog.args.epoch as bigint

  runtime.log(`Preparing settlement for market ${marketId.toString()} epoch ${epoch.toString()}`)

  const evmClient = new EVMClient(network.chainSelector.selector)
  const orderIds = readEpochOrderIds(runtime, evmClient, marketAddress, marketId, epoch)
  const orders = orderIds.map((orderId) => readOrder(runtime, evmClient, marketAddress, orderId))

  const httpClient = new HTTPClient()
  const auctionResponse = httpClient
    .sendRequest(runtime, fetchAuctionSettlement, consensusIdenticalAggregation<AuctionServiceResponse>())(
      runtime.config.auctionServiceUrl,
      toAuctionPayload(marketAddress, marketId, epoch, orders),
    )
    .result()

  const settlementReport = normalizeSettlementReport(auctionResponse)

  const encodedSettlementReport = encodeAbiParameters(settlementReportParams, [
    {
      marketId: settlementReport.marketId,
      epoch: settlementReport.epoch,
      clearingPrice: settlementReport.clearingPrice,
      settlementRoot: settlementReport.settlementRoot,
      totalYesSharesDelta: settlementReport.totalYesSharesDelta,
      totalNoSharesDelta: settlementReport.totalNoSharesDelta,
      settlementHash: settlementReport.settlementHash,
    },
  ])

  const encodedReport = encodeAbiParameters(creReportEnvelopeParams, [
    {
      reportType: CRE_REPORT_TYPE_SETTLEMENT,
      payload: encodedSettlementReport,
    } satisfies CREReportEnvelope,
  ])

  const report = runtime.report(prepareReportRequest(encodedReport)).result()
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: receiverAddress,
      report,
      gasConfig: {
        gasLimit: runtime.config.gasLimit,
      },
    })
    .result()

  runtime.log(`Settlement write tx status: ${String(writeResult.txStatus)}`)
  runtime.log(`Processed market ${marketId.toString()} epoch ${epoch.toString()}`)

  return bytesToHex(writeResult.txHash ?? new Uint8Array(32))
}

const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: config.isTestnet,
  })

  if (!network) {
    throw new Error(`Network not found: ${config.chainSelectorName}`)
  }

  const evmClient = new EVMClient(network.chainSelector.selector)
  const epochSettlementRequestedTopic = keccak256(toBytes("EpochSettlementRequested(uint64,uint64)"))

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.marketAddress)],
        topics: [
          {
            values: [hexToBase64(epochSettlementRequestedTopic)],
          },
        ],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onEpochSettlementRequested,
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
