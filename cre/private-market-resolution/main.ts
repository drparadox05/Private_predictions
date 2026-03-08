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
  resolutionServiceUrl: z.string().min(1),
  gasLimit: z.string(),
  isTestnet: z.boolean(),
})

type Config = z.infer<typeof configSchema>

type ResolutionRequest = {
  marketAddress: Address
  marketId: string
  question: string
  tradingEnd: string
}

type ResolutionServiceResponse = {
  outcome: "YES" | "NO"
  evidenceHash: Hex
}

type ResolutionReport = {
  marketId: bigint
  outcome: number
  evidenceHash: Hex
  resolutionHash: Hex
}

type CREReportEnvelope = {
  reportType: number
  payload: Hex
}

const marketAbi = parseAbi([
  "event MarketResolutionRequested(uint64 indexed marketId)",
  "function getMarketResolutionData(uint64 marketId) view returns (string question, uint64 tradingEnd, uint8 status, uint8 resolvedOutcome, bool resolutionRequested)",
])

const resolutionReportParams = parseAbiParameters(
  "(uint64 marketId,uint8 outcome,bytes32 evidenceHash,bytes32 resolutionHash)"
)
const creReportEnvelopeParams = parseAbiParameters("(uint8 reportType,bytes payload)")
const CRE_REPORT_TYPE_RESOLUTION = 2
const resolutionHashParams = parseAbiParameters("uint64 marketId, uint8 outcome, bytes32 evidenceHash")
const OUTCOME_YES = 1
const OUTCOME_NO = 2

const fetchResolution = (
  sendRequester: HTTPSendRequester,
  resolutionServiceUrl: string,
  payload: ResolutionRequest,
): ResolutionServiceResponse => {
  const body = hexToBase64(bytesToHex(new TextEncoder().encode(JSON.stringify(payload))))
  const response = sendRequester
    .sendRequest({
      url: resolutionServiceUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    })
    .result()

  if (response.statusCode !== 200) {
    throw new Error(`Resolution service failed with status ${response.statusCode}`)
  }

  const responseText = new TextDecoder().decode(response.body)
  return JSON.parse(responseText) as ResolutionServiceResponse
}

const readMarketResolutionData = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  marketAddress: Address,
  marketId: bigint,
): {
  question: string
  tradingEnd: bigint
  resolutionRequested: boolean
} => {
  const callData = encodeFunctionData({
    abi: marketAbi,
    functionName: "getMarketResolutionData",
    args: [marketId],
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

  const [question, tradingEnd, , , resolutionRequested] = decodeFunctionResult({
    abi: marketAbi,
    functionName: "getMarketResolutionData",
    data: bytesToHex(contractCall.data),
  }) as readonly [string, bigint, number, number, boolean]

  return { question, tradingEnd, resolutionRequested }
}

const normalizeOutcome = (outcome: string): number => {
  if (outcome === "YES") {
    return OUTCOME_YES
  }
  if (outcome === "NO") {
    return OUTCOME_NO
  }
  throw new Error(`Unsupported resolution outcome: ${outcome}`)
}

const buildResolutionReport = (
  marketId: bigint,
  response: ResolutionServiceResponse,
): ResolutionReport => {
  const outcome = normalizeOutcome(response.outcome)
  const resolutionHash = keccak256(
    encodeAbiParameters(resolutionHashParams, [
      marketId,
      outcome,
      response.evidenceHash,
    ])
  )

  return {
    marketId,
    outcome,
    evidenceHash: response.evidenceHash,
    resolutionHash,
  }
}

const onMarketResolutionRequested = (runtime: Runtime<Config>, log: EVMLog): string => {
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
    throw new Error("Resolution request log missing topics")
  }

  const decodedLog = decodeEventLog({
    abi: marketAbi,
    eventName: "MarketResolutionRequested",
    topics: eventTopics as [Hex, ...Hex[]],
    data: bytesToHex(log.data),
  })

  const marketId = decodedLog.args.marketId as bigint
  runtime.log(`Preparing resolution for market ${marketId.toString()}`)

  const evmClient = new EVMClient(network.chainSelector.selector)
  const resolutionData = readMarketResolutionData(runtime, evmClient, marketAddress, marketId)
  if (!resolutionData.resolutionRequested) {
    throw new Error(`Market ${marketId.toString()} is not awaiting resolution`)
  }

  const httpClient = new HTTPClient()
  const resolutionResponse = httpClient
    .sendRequest(runtime, fetchResolution, consensusIdenticalAggregation<ResolutionServiceResponse>())(
      runtime.config.resolutionServiceUrl,
      {
        marketAddress,
        marketId: marketId.toString(),
        question: resolutionData.question,
        tradingEnd: resolutionData.tradingEnd.toString(),
      },
    )
    .result()

  const resolutionReport = buildResolutionReport(marketId, resolutionResponse)
  const encodedResolutionReport = encodeAbiParameters(resolutionReportParams, [
    {
      marketId: resolutionReport.marketId,
      outcome: resolutionReport.outcome,
      evidenceHash: resolutionReport.evidenceHash,
      resolutionHash: resolutionReport.resolutionHash,
    },
  ])
  const encodedReport = encodeAbiParameters(creReportEnvelopeParams, [
    {
      reportType: CRE_REPORT_TYPE_RESOLUTION,
      payload: encodedResolutionReport,
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

  runtime.log(`Resolution write tx status: ${String(writeResult.txStatus)}`)
  runtime.log(`Processed resolution for market ${marketId.toString()}`)

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
  const marketResolutionRequestedTopic = keccak256(toBytes("MarketResolutionRequested(uint64)"))

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.marketAddress)],
        topics: [
          {
            values: [hexToBase64(marketResolutionRequestedTopic)],
          },
        ],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onMarketResolutionRequested,
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
