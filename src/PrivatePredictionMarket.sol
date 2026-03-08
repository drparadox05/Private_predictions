pragma solidity 0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {AutomationCompatibleInterface} from "./interfaces/AutomationCompatibleInterface.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

contract PrivatePredictionMarket is AutomationCompatibleInterface, IReceiver {
    uint96 public constant PRICE_SCALE = 1_000_000;

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint8 private constant CRE_REPORT_TYPE_SETTLEMENT = 1;
    uint8 private constant CRE_REPORT_TYPE_RESOLUTION = 2;

    error Unauthorized();
    error InvalidAddress();
    error InvalidMarket();
    error InvalidEpoch();
    error InvalidState();
    error InvalidAmount();
    error InvalidArrayLength();
    error InvalidSettlement();
    error Reentrancy();
    error InsufficientFreeCollateral();
    error InsufficientReservedCollateral();
    error TransferFailed();
    error EpochNotReady();
    error EpochAlreadySettled();
    error MarketClosed();
    error MarketNotResolved();
    error NothingToRedeem();

    enum MarketStatus {
        Uninitialized,
        Active,
        Expired,
        Resolved,
        Cancelled
    }

    enum Outcome {
        Undetermined,
        Yes,
        No
    }

    struct Market {
        address resolutionOracle;
        uint64 tradingStart;
        uint64 tradingEnd;
        uint64 epochLength;
        uint64 lastEpochSettlementRequest;
        uint64 lastSettledEpoch;
        uint32 orderCount;
        MarketStatus status;
        Outcome resolvedOutcome;
        string question;
    }

    struct EpochState {
        bool settlementRequested;
        bool settled;
        uint96 clearingPrice;
        bytes32 settlementRoot;
        bytes32 settlementHash;
    }

    struct Order {
        address trader;
        uint64 marketId;
        uint64 epoch;
        uint40 submittedAt;
        bytes ciphertext;
    }

    struct TraderSettlement {
        address trader;
        uint128 reservedCollateralSpent;
        uint128 reservedCollateralRefunded;
        uint128 collateralCredit;
        int128 yesSharesDelta;
        int128 noSharesDelta;
    }

    struct Position {
        uint128 yesShares;
        uint128 noShares;
        bool redeemed;
    }

    struct SettlementReport {
        uint64 marketId;
        uint64 epoch;
        uint96 clearingPrice;
        bytes32 settlementRoot;
        int256 totalYesSharesDelta;
        int256 totalNoSharesDelta;
        bytes32 settlementHash;
    }

    struct ResolutionReport {
        uint64 marketId;
        Outcome outcome;
        bytes32 evidenceHash;
        bytes32 resolutionHash;
    }

    struct CREReportEnvelope {
        uint8 reportType;
        bytes payload;
    }

    IERC20 public immutable collateralToken;
    address public owner;
    address public automationForwarder;
    address public creForwarder;
    uint256 private reentrancyLock = NOT_ENTERED;

    uint64 public nextMarketId = 1;
    uint256 public nextOrderId = 1;

    mapping(uint64 => Market) public markets;
    mapping(uint64 => mapping(uint64 => EpochState)) public epochStates;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256) public freeCollateral;
    mapping(address => uint256) public reservedCollateral;
    mapping(uint64 => mapping(address => Position)) public positions;
    mapping(uint64 => mapping(uint64 => mapping(address => uint256))) public epochReservedCollateral;
    mapping(uint64 => mapping(uint64 => mapping(address => bool))) public epochHasSubmittedOrder;
    mapping(uint64 => mapping(address => uint64)) public nextClaimEpoch;
    mapping(uint64 => mapping(address => uint256)) public unclaimedSettlementCount;
    mapping(uint64 => int256) public marketClaimedYesShares;
    mapping(uint64 => int256) public marketClaimedNoShares;
    mapping(uint64 => int256) public marketPendingYesSharesDelta;
    mapping(uint64 => int256) public marketPendingNoSharesDelta;
    mapping(uint64 => mapping(uint64 => int256)) public epochTotalYesSharesDelta;
    mapping(uint64 => mapping(uint64 => int256)) public epochTotalNoSharesDelta;
    mapping(uint64 => bool) public marketResolutionRequested;
    mapping(uint64 => mapping(uint64 => uint256[])) private epochOrderIds;
    mapping(uint64 => mapping(address => uint64)) private lastClaimEpoch;
    mapping(uint64 => mapping(uint64 => mapping(address => uint64))) private claimEpochLinks;
    mapping(uint64 => mapping(uint64 => mapping(address => bool))) public epochSettlementClaimed;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AutomationForwarderSet(address indexed forwarder);
    event CREForwarderSet(address indexed forwarder);
    event MarketCreated(
        uint64 indexed marketId,
        address indexed resolutionOracle,
        uint64 tradingStart,
        uint64 tradingEnd,
        uint64 epochLength,
        string question
    );
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event EpochCollateralLocked(
        uint64 indexed marketId,
        uint64 indexed epoch,
        address indexed trader,
        uint256 amount,
        uint256 totalLockedCollateral
    );
    event EpochCollateralUnlocked(
        uint64 indexed marketId,
        uint64 indexed epoch,
        address indexed trader,
        uint256 amount,
        uint256 remainingLockedCollateral
    );
    event EncryptedOrderSubmitted(
        uint256 indexed orderId,
        uint64 indexed marketId,
        uint64 indexed epoch,
        address trader,
        bytes ciphertext
    );
    event EpochSettlementRequested(uint64 indexed marketId, uint64 indexed epoch);
    event MarketResolutionRequested(uint64 indexed marketId);
    event EpochSettled(
        uint64 indexed marketId,
        uint64 indexed epoch,
        uint256 clearingPrice,
        bytes32 settlementRoot,
        bytes32 settlementHash
    );
    event ClaimQueueUpdated(
        uint64 indexed marketId,
        address indexed trader,
        uint64 indexed epoch,
        uint64 nextClaimEpoch,
        uint256 unclaimedSettlementCount,
        bool claimed
    );
    event EpochSettlementClaimed(uint64 indexed marketId, uint64 indexed epoch, address indexed trader, bytes32 settlementLeaf);
    event EpochSettlementBatchClaimed(
        uint64 indexed marketId,
        address indexed trader,
        uint256 claimCount,
        uint64 firstEpoch,
        uint64 lastEpoch,
        uint64 nextClaimEpoch,
        uint256 unclaimedSettlementCount
    );
    event MarketShareSupplyUpdated(
        uint64 indexed marketId,
        int256 claimedYesShares,
        int256 claimedNoShares,
        int256 pendingYesSharesDelta,
        int256 pendingNoSharesDelta
    );
    event CREReportProcessed(uint64 indexed marketId, uint64 indexed epoch, bytes32 metadataHash);
    event CREMarketResolutionProcessed(uint64 indexed marketId, Outcome outcome, bytes32 metadataHash, bytes32 evidenceHash);
    event MarketResolved(uint64 indexed marketId, Outcome outcome);
    event Redeemed(address indexed user, uint64 indexed marketId, uint256 payout);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyAuthorizedAutomation() {
        if (msg.sender != owner && msg.sender != automationForwarder) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (reentrancyLock == ENTERED) revert Reentrancy();
        reentrancyLock = ENTERED;
        _;
        reentrancyLock = NOT_ENTERED;
    }

    constructor(address collateralToken_, address owner_) {
        if (collateralToken_ == address(0) || owner_ == address(0)) revert InvalidAddress();
        collateralToken = IERC20(collateralToken_);
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAutomationForwarder(address forwarder) external onlyOwner {
        if (forwarder == address(0)) revert InvalidAddress();
        automationForwarder = forwarder;
        emit AutomationForwarderSet(forwarder);
    }

    function setCREForwarder(address forwarder) external onlyOwner {
        if (forwarder == address(0)) revert InvalidAddress();
        creForwarder = forwarder;
        emit CREForwarderSet(forwarder);
    }

    function createMarket(
        string calldata question,
        address resolutionOracle,
        uint64 tradingStart,
        uint64 tradingEnd,
        uint64 epochLength
    ) external onlyOwner returns (uint64 marketId) {
        if (resolutionOracle == address(0)) revert InvalidAddress();
        if (bytes(question).length == 0) revert InvalidState();
        if (epochLength == 0 || tradingEnd <= tradingStart || tradingStart < block.timestamp) revert InvalidState();

        marketId = nextMarketId++;
        Market storage market = markets[marketId];
        market.resolutionOracle = resolutionOracle;
        market.tradingStart = tradingStart;
        market.tradingEnd = tradingEnd;
        market.epochLength = epochLength;
        market.status = MarketStatus.Active;
        market.question = question;

        emit MarketCreated(marketId, resolutionOracle, tradingStart, tradingEnd, epochLength, question);
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        freeCollateral[msg.sender] += amount;
        bool success = collateralToken.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (freeCollateral[msg.sender] < amount) revert InsufficientFreeCollateral();
        freeCollateral[msg.sender] -= amount;
        bool success = collateralToken.transfer(msg.sender, amount);
        if (!success) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function lockEpochCollateral(uint64 marketId, uint64 epoch, uint128 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        Market storage market = markets[marketId];
        _validateActiveMarket(market);

        _validateLockableEpoch(marketId, epoch);
        if (freeCollateral[msg.sender] < amount) revert InsufficientFreeCollateral();

        freeCollateral[msg.sender] -= amount;
        reservedCollateral[msg.sender] += amount;
        epochReservedCollateral[marketId][epoch][msg.sender] += amount;

        emit EpochCollateralLocked(marketId, epoch, msg.sender, amount, epochReservedCollateral[marketId][epoch][msg.sender]);
    }

    function unlockEpochCollateral(uint64 marketId, uint64 epoch, uint128 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (markets[marketId].status == MarketStatus.Uninitialized) revert InvalidMarket();
        if (epochHasSubmittedOrder[marketId][epoch][msg.sender]) revert InvalidState();

        EpochState storage epochState = epochStates[marketId][epoch];
        if (epochState.settlementRequested || epochState.settled) revert InvalidState();

        uint256 lockedForEpoch = epochReservedCollateral[marketId][epoch][msg.sender];
        if (lockedForEpoch < amount) revert InsufficientReservedCollateral();

        epochReservedCollateral[marketId][epoch][msg.sender] = lockedForEpoch - amount;
        reservedCollateral[msg.sender] -= amount;
        freeCollateral[msg.sender] += amount;

        emit EpochCollateralUnlocked(
            marketId,
            epoch,
            msg.sender,
            amount,
            epochReservedCollateral[marketId][epoch][msg.sender]
        );
    }

    function submitEncryptedOrder(uint64 marketId, bytes calldata ciphertext) external returns (uint256 orderId) {
        if (ciphertext.length == 0) revert InvalidAmount();
        Market storage market = markets[marketId];
        _validateActiveMarket(market);

        uint64 epoch = getCurrentEpoch(marketId);
        if (epochReservedCollateral[marketId][epoch][msg.sender] == 0) revert InsufficientReservedCollateral();

        if (!epochHasSubmittedOrder[marketId][epoch][msg.sender]) {
            epochHasSubmittedOrder[marketId][epoch][msg.sender] = true;
            unclaimedSettlementCount[marketId][msg.sender] += 1;
            _enqueueClaimEpoch(marketId, msg.sender, epoch);
        }

        orderId = nextOrderId++;
        orders[orderId] = Order({
            trader: msg.sender,
            marketId: marketId,
            epoch: epoch,
            submittedAt: uint40(block.timestamp),
            ciphertext: ciphertext
        });

        epochOrderIds[marketId][epoch].push(orderId);
        market.orderCount += 1;

        emit EncryptedOrderSubmitted(orderId, marketId, epoch, msg.sender, ciphertext);
    }

    function getCurrentEpoch(uint64 marketId) public view returns (uint64) {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.Active) revert MarketClosed();
        if (block.timestamp < market.tradingStart || block.timestamp >= market.tradingEnd) revert InvalidEpoch();
        return uint64((block.timestamp - market.tradingStart) / market.epochLength) + 1;
    }

    function getEpochForTimestamp(uint64 marketId, uint256 timestamp) public view returns (uint64) {
        Market storage market = markets[marketId];
        if (market.status == MarketStatus.Uninitialized) revert InvalidMarket();
        if (timestamp < market.tradingStart || timestamp >= market.tradingEnd) revert InvalidEpoch();
        return uint64((timestamp - market.tradingStart) / market.epochLength) + 1;
    }

    function isEpochReadyForSettlement(uint64 marketId, uint64 epoch) public view returns (bool) {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.Active && market.status != MarketStatus.Expired) return false;
        if (epoch == 0 || epoch > getTotalEpochs(marketId)) return false;
        if (epochOrderIds[marketId][epoch].length == 0) return false;
        uint256 epochEnd = uint256(market.tradingStart) + uint256(epoch) * uint256(market.epochLength);
        if (epochEnd > market.tradingEnd) {
            epochEnd = market.tradingEnd;
        }
        EpochState storage epochState = epochStates[marketId][epoch];
        return epochEnd <= block.timestamp && !epochState.settlementRequested && !epochState.settled;
    }

    function getTotalEpochs(uint64 marketId) public view returns (uint64) {
        Market storage market = markets[marketId];
        if (market.status == MarketStatus.Uninitialized) revert InvalidMarket();

        uint256 duration = uint256(market.tradingEnd) - uint256(market.tradingStart);
        return uint64((duration + uint256(market.epochLength) - 1) / uint256(market.epochLength));
    }

    function getEpochWindow(uint64 marketId, uint64 epoch) external view returns (uint256 startTime, uint256 endTime) {
        uint64 totalEpochs = getTotalEpochs(marketId);
        if (epoch == 0 || epoch > totalEpochs) revert InvalidEpoch();

        Market storage market = markets[marketId];
        startTime = uint256(market.tradingStart) + (uint256(epoch) - 1) * uint256(market.epochLength);
        endTime = startTime + uint256(market.epochLength);
        if (endTime > market.tradingEnd) {
            endTime = market.tradingEnd;
        }
    }

    function getNextSettlementEpoch(uint64 marketId) public view returns (uint64) {
        Market storage market = markets[marketId];
        if (market.status == MarketStatus.Uninitialized) revert InvalidMarket();

        if (market.lastEpochSettlementRequest != market.lastSettledEpoch) {
            return 0;
        }

        uint64 firstCandidateEpoch = market.lastSettledEpoch + 1;
        uint64 totalEpochs = getTotalEpochs(marketId);
        if (firstCandidateEpoch == 0 || firstCandidateEpoch > totalEpochs) {
            return 0;
        }

        for (uint64 epoch = firstCandidateEpoch; epoch <= totalEpochs; ++epoch) {
            if (isEpochReadyForSettlement(marketId, epoch)) {
                return epoch;
            }
        }

        return 0;
    }

    function getUserMarketState(uint64 marketId, address user)
        external
        view
        returns (uint256 freeBalance, uint256 reservedBalance, uint128 yesShares, uint128 noShares, bool redeemed)
    {
        if (markets[marketId].status == MarketStatus.Uninitialized) revert InvalidMarket();

        Position storage position = positions[marketId][user];
        return (
            freeCollateral[user],
            reservedCollateral[user],
            position.yesShares,
            position.noShares,
            position.redeemed
        );
    }

    function getClaimQueueState(uint64 marketId, address user)
        external
        view
        returns (uint64 nextEpoch, uint256 pendingCount)
    {
        if (markets[marketId].status == MarketStatus.Uninitialized) revert InvalidMarket();

        return (nextClaimEpoch[marketId][user], unclaimedSettlementCount[marketId][user]);
    }

    function getPendingClaimEpochs(uint64 marketId, address user, uint256 maxCount)
        external
        view
        returns (uint64[] memory epochs)
    {
        if (markets[marketId].status == MarketStatus.Uninitialized) revert InvalidMarket();
        if (maxCount == 0) {
            return new uint64[](0);
        }

        uint256 pendingCount = unclaimedSettlementCount[marketId][user];
        uint256 resultLength = pendingCount < maxCount ? pendingCount : maxCount;
        epochs = new uint64[](resultLength);

        uint64 epoch = nextClaimEpoch[marketId][user];
        for (uint256 i = 0; i < resultLength && epoch != 0; ++i) {
            epochs[i] = epoch;
            epoch = claimEpochLinks[marketId][epoch][user];
        }
    }

    function getClaimStatus(uint64 marketId, uint64 epoch, address user)
        external
        view
        returns (
            bool queued,
            bool readyToClaim,
            bool claimed,
            uint256 reservedForEpoch,
            uint96 clearingPrice,
            bytes32 settlementRoot
        )
    {
        if (markets[marketId].status == MarketStatus.Uninitialized) revert InvalidMarket();

        reservedForEpoch = epochReservedCollateral[marketId][epoch][user];
        claimed = epochSettlementClaimed[marketId][epoch][user];
        queued = epochHasSubmittedOrder[marketId][epoch][user] && !claimed && reservedForEpoch != 0;

        EpochState storage epochState = epochStates[marketId][epoch];
        clearingPrice = epochState.clearingPrice;
        settlementRoot = epochState.settlementRoot;
        readyToClaim = queued && epochState.settled && nextClaimEpoch[marketId][user] == epoch;
    }

    function getMarketShareSupply(uint64 marketId)
        external
        view
        returns (
            int256 claimedYesShares,
            int256 claimedNoShares,
            int256 pendingYesSharesDelta,
            int256 pendingNoSharesDelta
        )
    {
        if (markets[marketId].status == MarketStatus.Uninitialized) revert InvalidMarket();

        return (
            marketClaimedYesShares[marketId],
            marketClaimedNoShares[marketId],
            marketPendingYesSharesDelta[marketId],
            marketPendingNoSharesDelta[marketId]
        );
    }

    function getMarketResolutionData(uint64 marketId)
        external
        view
        returns (string memory question, uint64 tradingEnd, MarketStatus status, Outcome resolvedOutcome, bool resolutionRequested)
    {
        Market storage market = markets[marketId];
        if (market.status == MarketStatus.Uninitialized) revert InvalidMarket();

        return (
            market.question,
            market.tradingEnd,
            market.status,
            market.resolvedOutcome,
            marketResolutionRequested[marketId]
        );
    }

    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        uint64[] memory marketIds = abi.decode(checkData, (uint64[]));
        uint256 length = marketIds.length;

        for (uint256 i = 0; i < length; ++i) {
            uint64 marketId = marketIds[i];
            Market storage market = markets[marketId];
            if (market.status == MarketStatus.Uninitialized) {
                continue;
            }

            uint64 nextEpoch = getNextSettlementEpoch(marketId);
            if (nextEpoch != 0) {
                return (true, abi.encode(marketId, nextEpoch));
            }

            if (_isMarketReadyForResolution(marketId) && !marketResolutionRequested[marketId]) {
                return (true, abi.encode(marketId, uint64(0)));
            }
        }

        return (false, bytes(""));
    }

    function performUpkeep(bytes calldata performData) external override onlyAuthorizedAutomation {
        (uint64 marketId, uint64 epoch) = abi.decode(performData, (uint64, uint64));
        if (epoch == 0) {
            _requestMarketResolution(marketId);
            return;
        }

        Market storage market = markets[marketId];
        if (market.lastEpochSettlementRequest != market.lastSettledEpoch) revert EpochNotReady();
        if (!isEpochReadyForSettlement(marketId, epoch)) revert EpochNotReady();

        EpochState storage epochState = epochStates[marketId][epoch];
        epochState.settlementRequested = true;
        market.lastEpochSettlementRequest = epoch;

        if (block.timestamp >= market.tradingEnd) {
            market.status = MarketStatus.Expired;
        }

        emit EpochSettlementRequested(marketId, epoch);
    }

    function requestMarketResolution(uint64 marketId) external onlyAuthorizedAutomation {
        _requestMarketResolution(marketId);
    }

    function settleEpoch(
        uint64 marketId,
        uint64 epoch,
        uint96 clearingPrice,
        bytes32 settlementRoot,
        int256 totalYesSharesDelta,
        int256 totalNoSharesDelta,
        bytes32 settlementHash
    ) external {
        if (creForwarder != address(0)) revert InvalidState();
        _authorizeOracle(marketId);
        _finalizeEpochSettlement(
            marketId,
            epoch,
            clearingPrice,
            settlementRoot,
            totalYesSharesDelta,
            totalNoSharesDelta,
            settlementHash
        );
    }

    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != creForwarder) revert Unauthorized();

        CREReportEnvelope memory creReport = abi.decode(report, (CREReportEnvelope));
        if (creReport.reportType == CRE_REPORT_TYPE_SETTLEMENT) {
            SettlementReport memory settlementReport = abi.decode(creReport.payload, (SettlementReport));
            _finalizeEpochSettlement(
                settlementReport.marketId,
                settlementReport.epoch,
                settlementReport.clearingPrice,
                settlementReport.settlementRoot,
                settlementReport.totalYesSharesDelta,
                settlementReport.totalNoSharesDelta,
                settlementReport.settlementHash
            );

            emit CREReportProcessed(
                settlementReport.marketId,
                settlementReport.epoch,
                keccak256(metadata)
            );
            return;
        }

        if (creReport.reportType == CRE_REPORT_TYPE_RESOLUTION) {
            ResolutionReport memory resolutionReport = abi.decode(creReport.payload, (ResolutionReport));
            _finalizeResolutionReport(resolutionReport);
            emit CREMarketResolutionProcessed(
                resolutionReport.marketId,
                resolutionReport.outcome,
                keccak256(metadata),
                resolutionReport.evidenceHash
            );
            return;
        }

        revert InvalidState();
    }

    function hashSettlementReport(SettlementReport calldata settlementReport) external pure returns (bytes32) {
        return _hashSettlementPayload(
            settlementReport.marketId,
            settlementReport.epoch,
            settlementReport.clearingPrice,
            settlementReport.settlementRoot,
            settlementReport.totalYesSharesDelta,
            settlementReport.totalNoSharesDelta
        );
    }

    function hashResolutionReport(ResolutionReport calldata resolutionReport) external pure returns (bytes32) {
        return _hashResolutionPayload(resolutionReport.marketId, resolutionReport.outcome, resolutionReport.evidenceHash);
    }

    function hashSettlementLeaf(uint64 marketId, uint64 epoch, TraderSettlement calldata traderSettlement)
        external
        pure
        returns (bytes32)
    {
        return _hashSettlementLeaf(marketId, epoch, traderSettlement);
    }

    function getEpochOrderCount(uint64 marketId, uint64 epoch) external view returns (uint256) {
        return epochOrderIds[marketId][epoch].length;
    }

    function claimEpochSettlement(
        uint64 marketId,
        uint64 epoch,
        TraderSettlement calldata traderSettlement,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        _claimEpochSettlement(marketId, epoch, traderSettlement, merkleProof, msg.sender);
    }

    function batchClaimEpochSettlements(
        uint64 marketId,
        uint64[] calldata epochs,
        TraderSettlement[] calldata traderSettlements,
        bytes32[][] calldata merkleProofs
    ) external nonReentrant returns (uint256 claimedCount, uint64 nextEpochAfterBatch) {
        uint256 length = epochs.length;
        if (length == 0 || traderSettlements.length != length || merkleProofs.length != length) {
            revert InvalidArrayLength();
        }

        address claimant = msg.sender;
        for (uint256 i = 0; i < length; ++i) {
            uint64 epoch = epochs[i];
            _claimEpochSettlement(marketId, epoch, traderSettlements[i], merkleProofs[i], claimant);
        }

        claimedCount = length;
        nextEpochAfterBatch = nextClaimEpoch[marketId][claimant];

        _emitBatchClaimed(marketId, claimant, claimedCount, epochs[0], epochs[length - 1], nextEpochAfterBatch);
    }

    function _authorizeOracle(uint64 marketId) internal view {
        Market storage market = markets[marketId];
        if (market.resolutionOracle != msg.sender) revert Unauthorized();
    }

    function _finalizeEpochSettlement(
        uint64 marketId,
        uint64 epoch,
        uint96 clearingPrice,
        bytes32 settlementRoot,
        int256 totalYesSharesDelta,
        int256 totalNoSharesDelta,
        bytes32 settlementHash
    ) internal {
        Market storage market = markets[marketId];
        EpochState storage epochState = epochStates[marketId][epoch];
        if (!epochState.settlementRequested) revert EpochNotReady();
        if (epochState.settled) revert EpochAlreadySettled();
        if (epoch != market.lastEpochSettlementRequest || epoch <= market.lastSettledEpoch) revert InvalidEpoch();
        if (clearingPrice > PRICE_SCALE || settlementRoot == bytes32(0) || settlementHash == bytes32(0)) {
            revert InvalidSettlement();
        }
        if (
            settlementHash
                != _hashSettlementPayload(
                    marketId,
                    epoch,
                    clearingPrice,
                    settlementRoot,
                    totalYesSharesDelta,
                    totalNoSharesDelta
                )
        ) {
            revert InvalidSettlement();
        }
        _applyEpochShareSupplyDelta(marketId, epoch, totalYesSharesDelta, totalNoSharesDelta);

        epochState.settled = true;
        epochState.clearingPrice = clearingPrice;
        epochState.settlementRoot = settlementRoot;
        epochState.settlementHash = settlementHash;
        market.lastSettledEpoch = epoch;

        if (block.timestamp >= market.tradingEnd) {
            market.status = MarketStatus.Expired;
        }

        emit EpochSettled(marketId, epoch, clearingPrice, settlementRoot, settlementHash);
    }

    function resolveMarket(uint64 marketId, Outcome outcome) external {
        if (creForwarder != address(0)) revert InvalidState();
        _authorizeOracle(marketId);
        _finalizeMarketResolution(marketId, outcome);
    }

    function redeem(uint64 marketId) external {
        Market storage market = markets[marketId];
        if (market.status != MarketStatus.Resolved) revert MarketNotResolved();
        if (unclaimedSettlementCount[marketId][msg.sender] != 0) revert InvalidState();

        Position storage position = positions[marketId][msg.sender];
        if (position.redeemed) revert NothingToRedeem();

        uint256 payout;
        if (market.resolvedOutcome == Outcome.Yes) {
            payout = position.yesShares;
        } else if (market.resolvedOutcome == Outcome.No) {
            payout = position.noShares;
        }

        if (payout == 0) revert NothingToRedeem();

        position.redeemed = true;
        position.yesShares = 0;
        position.noShares = 0;
        freeCollateral[msg.sender] += payout;

        emit Redeemed(msg.sender, marketId, payout);
    }

    function getEpochOrderIds(uint64 marketId, uint64 epoch) external view returns (uint256[] memory) {
        return epochOrderIds[marketId][epoch];
    }

    function _validateActiveMarket(Market storage market) internal view {
        if (market.status != MarketStatus.Active) revert MarketClosed();
        if (block.timestamp < market.tradingStart || block.timestamp >= market.tradingEnd) revert MarketClosed();
    }

    function _validateLockableEpoch(uint64 marketId, uint64 epoch) internal view {
        if (epoch == 0 || epoch > getTotalEpochs(marketId)) revert InvalidEpoch();

        uint64 currentEpoch = getCurrentEpoch(marketId);
        if (epoch < currentEpoch) revert InvalidEpoch();

        EpochState storage epochState = epochStates[marketId][epoch];
        if (epochState.settlementRequested || epochState.settled) revert InvalidState();
    }

    function _applyPositionDelta(uint128 currentPosition, int128 delta) internal pure returns (uint128) {
        if (delta >= 0) {
            return currentPosition + uint128(uint128(delta));
        }

        uint128 decrease = uint128(uint128(-delta));
        if (decrease > currentPosition) revert InvalidSettlement();
        return currentPosition - decrease;
    }

    function _hashSettlementPayload(
        uint64 marketId,
        uint64 epoch,
        uint96 clearingPrice,
        bytes32 settlementRoot,
        int256 totalYesSharesDelta,
        int256 totalNoSharesDelta
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(marketId, epoch, clearingPrice, settlementRoot, totalYesSharesDelta, totalNoSharesDelta)
        );
    }

    function _hashResolutionPayload(uint64 marketId, Outcome outcome, bytes32 evidenceHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(marketId, outcome, evidenceHash));
    }

    function _hashSettlementLeaf(uint64 marketId, uint64 epoch, TraderSettlement memory traderSettlement)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                marketId,
                epoch,
                traderSettlement.trader,
                traderSettlement.reservedCollateralSpent,
                traderSettlement.reservedCollateralRefunded,
                traderSettlement.collateralCredit,
                traderSettlement.yesSharesDelta,
                traderSettlement.noSharesDelta
            )
        );
    }

    function _claimEpochSettlement(
        uint64 marketId,
        uint64 epoch,
        TraderSettlement calldata traderSettlement,
        bytes32[] calldata merkleProof,
        address claimant
    ) internal {
        if (traderSettlement.trader != claimant) revert Unauthorized();

        EpochState storage epochState = epochStates[marketId][epoch];
        if (!epochState.settled) revert EpochNotReady();
        if (nextClaimEpoch[marketId][claimant] != epoch) revert InvalidEpoch();
        if (epochSettlementClaimed[marketId][epoch][claimant]) revert InvalidState();

        bytes32 settlementLeaf = _hashSettlementLeaf(marketId, epoch, traderSettlement);
        if (!_verifySettlementProof(epochState.settlementRoot, merkleProof, settlementLeaf)) {
            revert InvalidSettlement();
        }

        _finalizeClaim(marketId, epoch, claimant, epochState.clearingPrice, traderSettlement, settlementLeaf);
    }

    function _finalizeClaim(
        uint64 marketId,
        uint64 epoch,
        address claimant,
        uint96 clearingPrice,
        TraderSettlement calldata traderSettlement,
        bytes32 settlementLeaf
    ) internal {
        _applySettlementClaim(marketId, epoch, clearingPrice, traderSettlement);
        _applyClaimShareSupplyDelta(marketId, traderSettlement.yesSharesDelta, traderSettlement.noSharesDelta);
        epochSettlementClaimed[marketId][epoch][claimant] = true;
        _dequeueClaimEpoch(marketId, claimant, epoch);

        emit EpochSettlementClaimed(marketId, epoch, claimant, settlementLeaf);
    }

    function _emitBatchClaimed(
        uint64 marketId,
        address claimant,
        uint256 claimedCount,
        uint64 firstEpoch,
        uint64 lastEpoch,
        uint64 nextEpochAfterBatch
    ) internal {
        emit EpochSettlementBatchClaimed(
            marketId,
            claimant,
            claimedCount,
            firstEpoch,
            lastEpoch,
            nextEpochAfterBatch,
            unclaimedSettlementCount[marketId][claimant]
        );
    }

    function _applySettlementClaim(
        uint64 marketId,
        uint64 epoch,
        uint96 clearingPrice,
        TraderSettlement calldata traderSettlement
    ) internal {
        if (traderSettlement.trader == address(0)) revert InvalidSettlement();

        uint256 reservedForEpoch = epochReservedCollateral[marketId][epoch][traderSettlement.trader];
        uint256 released =
            uint256(traderSettlement.reservedCollateralSpent) + uint256(traderSettlement.reservedCollateralRefunded);

        if (reservedForEpoch == 0) revert InvalidSettlement();
        if (released != reservedForEpoch) revert InvalidSettlement();
        if (uint256(traderSettlement.reservedCollateralSpent) < _requiredSpendForSettlement(traderSettlement, clearingPrice)) {
            revert InvalidSettlement();
        }
        if (uint256(traderSettlement.collateralCredit) > _maxCreditForSettlement(traderSettlement, clearingPrice)) {
            revert InvalidSettlement();
        }
        if (reservedCollateral[traderSettlement.trader] < released) revert InsufficientReservedCollateral();

        epochReservedCollateral[marketId][epoch][traderSettlement.trader] = 0;
        delete epochHasSubmittedOrder[marketId][epoch][traderSettlement.trader];
        reservedCollateral[traderSettlement.trader] -= released;
        freeCollateral[traderSettlement.trader] +=
            uint256(traderSettlement.reservedCollateralRefunded) + uint256(traderSettlement.collateralCredit);

        Position storage position = positions[marketId][traderSettlement.trader];
        position.yesShares = _applyPositionDelta(position.yesShares, traderSettlement.yesSharesDelta);
        position.noShares = _applyPositionDelta(position.noShares, traderSettlement.noSharesDelta);
    }

    function _applyEpochShareSupplyDelta(
        uint64 marketId,
        uint64 epoch,
        int256 totalYesSharesDelta,
        int256 totalNoSharesDelta
    ) internal {
        int256 nextExpectedYes = marketClaimedYesShares[marketId] + marketPendingYesSharesDelta[marketId] + totalYesSharesDelta;
        int256 nextExpectedNo = marketClaimedNoShares[marketId] + marketPendingNoSharesDelta[marketId] + totalNoSharesDelta;
        if (nextExpectedYes < 0 || nextExpectedNo < 0) {
            revert InvalidSettlement();
        }

        epochTotalYesSharesDelta[marketId][epoch] = totalYesSharesDelta;
        epochTotalNoSharesDelta[marketId][epoch] = totalNoSharesDelta;
        marketPendingYesSharesDelta[marketId] += totalYesSharesDelta;
        marketPendingNoSharesDelta[marketId] += totalNoSharesDelta;

        emit MarketShareSupplyUpdated(
            marketId,
            marketClaimedYesShares[marketId],
            marketClaimedNoShares[marketId],
            marketPendingYesSharesDelta[marketId],
            marketPendingNoSharesDelta[marketId]
        );
    }

    function _applyClaimShareSupplyDelta(uint64 marketId, int128 yesSharesDelta, int128 noSharesDelta) internal {
        marketClaimedYesShares[marketId] = _applyOpenInterestDelta(marketClaimedYesShares[marketId], int256(yesSharesDelta));
        marketClaimedNoShares[marketId] = _applyOpenInterestDelta(marketClaimedNoShares[marketId], int256(noSharesDelta));
        marketPendingYesSharesDelta[marketId] -= int256(yesSharesDelta);
        marketPendingNoSharesDelta[marketId] -= int256(noSharesDelta);

        int256 expectedYes = marketClaimedYesShares[marketId] + marketPendingYesSharesDelta[marketId];
        int256 expectedNo = marketClaimedNoShares[marketId] + marketPendingNoSharesDelta[marketId];
        if (expectedYes < 0 || expectedNo < 0) revert InvalidSettlement();

        emit MarketShareSupplyUpdated(
            marketId,
            marketClaimedYesShares[marketId],
            marketClaimedNoShares[marketId],
            marketPendingYesSharesDelta[marketId],
            marketPendingNoSharesDelta[marketId]
        );
    }

    function _applyOpenInterestDelta(int256 currentOpenInterest, int256 delta) internal pure returns (int256) {
        int256 updatedOpenInterest = currentOpenInterest + delta;
        if (updatedOpenInterest < 0) revert InvalidSettlement();
        return updatedOpenInterest;
    }

    function _requestMarketResolution(uint64 marketId) internal {
        if (!_isMarketReadyForResolution(marketId) || marketResolutionRequested[marketId]) revert InvalidState();

        Market storage market = markets[marketId];
        if (market.status == MarketStatus.Active && block.timestamp >= market.tradingEnd) {
            market.status = MarketStatus.Expired;
        }

        marketResolutionRequested[marketId] = true;
        emit MarketResolutionRequested(marketId);
    }

    function _finalizeResolutionReport(ResolutionReport memory resolutionReport) internal {
        if (!marketResolutionRequested[resolutionReport.marketId]) revert InvalidState();
        if (
            resolutionReport.resolutionHash
                != _hashResolutionPayload(
                    resolutionReport.marketId,
                    resolutionReport.outcome,
                    resolutionReport.evidenceHash
                )
        ) {
            revert InvalidSettlement();
        }

        marketResolutionRequested[resolutionReport.marketId] = false;
        _finalizeMarketResolution(resolutionReport.marketId, resolutionReport.outcome);
    }

    function _finalizeMarketResolution(uint64 marketId, Outcome outcome) internal {
        Market storage market = markets[marketId];
        if (market.status == MarketStatus.Resolved || market.status == MarketStatus.Cancelled) revert InvalidState();
        if (outcome != Outcome.Yes && outcome != Outcome.No) revert InvalidState();
        if (block.timestamp < market.tradingEnd) revert MarketClosed();
        if (market.lastEpochSettlementRequest != market.lastSettledEpoch) revert InvalidState();
        if (getNextSettlementEpoch(marketId) != 0) revert InvalidState();

        marketResolutionRequested[marketId] = false;
        market.status = MarketStatus.Resolved;
        market.resolvedOutcome = outcome;

        emit MarketResolved(marketId, outcome);
    }

    function _isMarketReadyForResolution(uint64 marketId) internal view returns (bool) {
        Market storage market = markets[marketId];
        if (market.status == MarketStatus.Uninitialized || market.status == MarketStatus.Resolved || market.status == MarketStatus.Cancelled) {
            return false;
        }
        if (block.timestamp < market.tradingEnd) {
            return false;
        }
        if (market.lastEpochSettlementRequest != market.lastSettledEpoch) {
            return false;
        }
        return getNextSettlementEpoch(marketId) == 0;
    }

    function _enqueueClaimEpoch(uint64 marketId, address trader, uint64 epoch) internal {
        uint64 pendingTail = lastClaimEpoch[marketId][trader];
        if (pendingTail == 0) {
            nextClaimEpoch[marketId][trader] = epoch;
            lastClaimEpoch[marketId][trader] = epoch;
        } else {
            claimEpochLinks[marketId][pendingTail][trader] = epoch;
            lastClaimEpoch[marketId][trader] = epoch;
        }

        emit ClaimQueueUpdated(
            marketId,
            trader,
            epoch,
            nextClaimEpoch[marketId][trader],
            unclaimedSettlementCount[marketId][trader],
            false
        );
    }

    function _dequeueClaimEpoch(uint64 marketId, address trader, uint64 epoch) internal {
        uint64 currentHead = nextClaimEpoch[marketId][trader];
        if (currentHead != epoch) revert InvalidEpoch();

        uint64 nextEpoch = claimEpochLinks[marketId][epoch][trader];
        nextClaimEpoch[marketId][trader] = nextEpoch;
        if (nextEpoch == 0) {
            lastClaimEpoch[marketId][trader] = 0;
        }
        delete claimEpochLinks[marketId][epoch][trader];

        unchecked {
            unclaimedSettlementCount[marketId][trader] -= 1;
        }

        emit ClaimQueueUpdated(
            marketId,
            trader,
            epoch,
            nextClaimEpoch[marketId][trader],
            unclaimedSettlementCount[marketId][trader],
            true
        );
    }

    function _verifySettlementProof(bytes32 settlementRoot, bytes32[] calldata merkleProof, bytes32 settlementLeaf)
        internal
        pure
        returns (bool)
    {
        bytes32 computedHash = settlementLeaf;
        uint256 length = merkleProof.length;

        for (uint256 i = 0; i < length; ++i) {
            bytes32 proofElement = merkleProof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == settlementRoot;
    }

    function _requiredSpendForSettlement(TraderSettlement memory traderSettlement, uint96 clearingPrice)
        internal
        pure
        returns (uint256)
    {
        uint96 noPrice = PRICE_SCALE - clearingPrice;
        return _positiveDeltaNotional(traderSettlement.yesSharesDelta, clearingPrice)
            + _positiveDeltaNotional(traderSettlement.noSharesDelta, noPrice);
    }

    function _maxCreditForSettlement(TraderSettlement memory traderSettlement, uint96 clearingPrice)
        internal
        pure
        returns (uint256)
    {
        uint96 noPrice = PRICE_SCALE - clearingPrice;
        return _negativeDeltaNotional(traderSettlement.yesSharesDelta, clearingPrice)
            + _negativeDeltaNotional(traderSettlement.noSharesDelta, noPrice);
    }

    function _positiveDeltaNotional(int128 delta, uint96 price) internal pure returns (uint256) {
        if (delta <= 0) {
            return 0;
        }

        return (uint256(int256(delta)) * uint256(price)) / uint256(PRICE_SCALE);
    }

    function _negativeDeltaNotional(int128 delta, uint96 price) internal pure returns (uint256) {
        if (delta >= 0) {
            return 0;
        }

        return (uint256(-int256(delta)) * uint256(price)) / uint256(PRICE_SCALE);
    }
}
