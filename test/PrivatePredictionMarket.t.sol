pragma solidity 0.8.26;

import {TestBase} from "./utils/TestBase.sol";
import {PrivatePredictionMarket} from "../src/PrivatePredictionMarket.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract PrivatePredictionMarketTest is TestBase {
    MockUSDC internal usdc;
    PrivatePredictionMarket internal market;

    address internal owner = address(0xA11CE);
    address internal resolutionOracle = address(0xB0B);
    address internal automationForwarder = address(0xCAFE);
    address internal creForwarder = address(0xFACE);
    address internal trader = address(0xD00D);
    address internal traderTwo = address(0xE11E);

    uint64 internal marketId;

    function setUp() public {
        usdc = new MockUSDC();
        market = new PrivatePredictionMarket(address(usdc), owner);

        vm.prank(owner);
        market.setAutomationForwarder(automationForwarder);

        usdc.mint(trader, 1_000_000_000);
        usdc.mint(traderTwo, 1_000_000_000);

        uint64 tradingStart = uint64(block.timestamp + 10);
        uint64 tradingEnd = tradingStart + 600;
        uint64 epochLength = 60;

        vm.prank(owner);
        marketId = market.createMarket("Will event happen?", resolutionOracle, tradingStart, tradingEnd, epochLength);
    }

    function testDepositAndWithdraw() public {
        vm.startPrank(trader);
        usdc.approve(address(market), 500_000_000);
        market.deposit(500_000_000);
        assertEq(market.freeCollateral(trader), 500_000_000);

        market.withdraw(100_000_000);
        assertEq(market.freeCollateral(trader), 400_000_000);
        assertEq(usdc.balanceOf(trader), 600_000_000);
        vm.stopPrank();
    }

    function testLockAndUnlockEpochCollateralWithoutSubmittingOrder() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);

        _lockEpochCollateral(trader, 1, 125_000_000);

        assertEq(market.freeCollateral(trader), 375_000_000);
        assertEq(market.reservedCollateral(trader), 125_000_000);
        assertEq(market.epochReservedCollateral(marketId, 1, trader), 125_000_000);
        assertEq(uint256(market.nextClaimEpoch(marketId, trader)), 0);
        assertEq(market.unclaimedSettlementCount(marketId, trader), 0);

        vm.prank(trader);
        market.unlockEpochCollateral(marketId, 1, 125_000_000);

        assertEq(market.freeCollateral(trader), 500_000_000);
        assertEq(market.reservedCollateral(trader), 0);
        assertEq(market.epochReservedCollateral(marketId, 1, trader), 0);
    }

    function testSubmitEncryptedOrderRequiresLockedEpochCollateral() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InsufficientReservedCollateral.selector));
        vm.prank(trader);
        market.submitEncryptedOrder(marketId, hex"123456");
    }

    function testLockEpochCollateralAndSubmitEncryptedOrderQueuesClaimEpoch() public {
        vm.startPrank(trader);
        usdc.approve(address(market), 500_000_000);
        market.deposit(500_000_000);
        vm.stopPrank();

        vm.warp(block.timestamp + 11);

        bytes memory ciphertext = hex"123456";
        uint256 orderId = _lockAndSubmitCurrentEpoch(trader, ciphertext, 125_000_000);

        assertEq(orderId, 1);
        assertEq(market.freeCollateral(trader), 375_000_000);
        assertEq(market.reservedCollateral(trader), 125_000_000);
        assertEq(market.epochReservedCollateral(marketId, 1, trader), 125_000_000);
        assertEq(uint256(market.nextClaimEpoch(marketId, trader)), 1);
        assertEq(market.unclaimedSettlementCount(marketId, trader), 1);
        assertTrue(market.epochHasSubmittedOrder(marketId, 1, trader));

        (address storedTrader, uint64 storedMarketId, uint64 storedEpoch,, bytes memory storedCiphertext) =
            market.orders(orderId);
        assertEq(storedTrader, trader);
        assertEq(uint256(storedMarketId), uint256(marketId));
        assertEq(uint256(storedEpoch), 1);
        assertTrue(keccak256(storedCiphertext) == keccak256(ciphertext));
    }

    function testAutomationRequestsSettlementForEndedEpoch() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        vm.warp(block.timestamp + 60);

        (bool upkeepNeeded, bytes memory performData) = market.checkUpkeep(abi.encode(_singleMarketArray(marketId)));
        assertTrue(upkeepNeeded);

        vm.prank(automationForwarder);
        market.performUpkeep(performData);

        (bool settlementRequested, bool settled, uint96 clearingPrice, bytes32 settlementRoot, bytes32 settlementHash) =
            market.epochStates(marketId, 1);
        assertTrue(settlementRequested);
        assertTrue(!settled);
        assertEq(uint256(clearingPrice), 0);
        assertEq(settlementRoot, bytes32(0));
        assertEq(settlementHash, bytes32(0));
    }

    function testOracleSettlementFinalizesRootAndClaimUpdatesBalancesAndPositions() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);

        PrivatePredictionMarket.SettlementReport memory report = _finalizeOracleSettlement(1, 600_000, settlements);

        (bool settlementRequested, bool settled, uint96 clearingPrice, bytes32 settlementRoot, bytes32 settlementHash) =
            market.epochStates(marketId, 1);
        assertTrue(settlementRequested);
        assertTrue(settled);
        assertEq(uint256(clearingPrice), 600_000);
        assertEq(settlementRoot, report.settlementRoot);
        assertEq(settlementHash, report.settlementHash);

        _claimSettlement(1, settlements, 0, trader);

        assertEq(market.freeCollateral(trader), 440_000_000);
        assertEq(market.reservedCollateral(trader), 0);
        assertEq(uint256(market.nextClaimEpoch(marketId, trader)), 0);
        assertEq(market.unclaimedSettlementCount(marketId, trader), 0);
        assertTrue(market.epochSettlementClaimed(marketId, 1, trader));

        (uint128 yesShares, uint128 noShares, bool redeemed) = market.positions(marketId, trader);
        assertEq(uint256(yesShares), 100_000_000);
        assertEq(uint256(noShares), 0);
        assertTrue(!redeemed);
    }

    function testAutomationRequestsMarketResolutionAfterTradingEnd() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 100_000_000, 0, 0, int128(100_000_000), 0);
        _finalizeOracleSettlement(1, 700_000, settlements);

        vm.warp(block.timestamp + 600);
        (bool upkeepNeeded, bytes memory performData) = market.checkUpkeep(abi.encode(_singleMarketArray(marketId)));
        assertTrue(upkeepNeeded);

        (uint64 upkeepMarketId, uint64 upkeepEpoch) = abi.decode(performData, (uint64, uint64));
        assertEq(uint256(upkeepMarketId), uint256(marketId));
        assertEq(uint256(upkeepEpoch), 0);

        vm.prank(automationForwarder);
        market.performUpkeep(performData);

        (,,,, bool resolutionRequested) = market.getMarketResolutionData(marketId);
        assertTrue(resolutionRequested);
    }

    function testCREForwarderResolutionReportResolvesMarket() public {
        vm.prank(owner);
        market.setCREForwarder(creForwarder);

        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 100_000_000, 0, 0, int128(100_000_000), 0);
        PrivatePredictionMarket.SettlementReport memory settlementReport = _settlementReport(1, 700_000, settlements);

        vm.prank(creForwarder);
        market.onReport(hex"1234", abi.encode(_settlementEnvelope(settlementReport)));

        vm.warp(block.timestamp + 600);
        vm.prank(automationForwarder);
        market.requestMarketResolution(marketId);

        PrivatePredictionMarket.ResolutionReport memory resolutionReport =
            _resolutionReport(PrivatePredictionMarket.Outcome.Yes, bytes32(uint256(456)));

        vm.prank(creForwarder);
        market.onReport(hex"5678", abi.encode(_resolutionEnvelope(resolutionReport)));

        (, , PrivatePredictionMarket.MarketStatus status, PrivatePredictionMarket.Outcome outcome, bool resolutionRequested) =
            market.getMarketResolutionData(marketId);
        assertEq(uint256(uint8(status)), uint256(uint8(PrivatePredictionMarket.MarketStatus.Resolved)));
        assertEq(uint256(uint8(outcome)), uint256(uint8(PrivatePredictionMarket.Outcome.Yes)));
        assertTrue(!resolutionRequested);
    }

    function testRedeemAfterResolutionRequiresClaimedSettlement() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 100_000_000, 0, 0, int128(100_000_000), 0);
        _finalizeOracleSettlement(1, 700_000, settlements);

        vm.warp(block.timestamp + 600);
        vm.prank(resolutionOracle);
        market.resolveMarket(marketId, PrivatePredictionMarket.Outcome.Yes);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidState.selector));
        vm.prank(trader);
        market.redeem(marketId);

        _claimSettlement(1, settlements, 0, trader);

        vm.prank(trader);
        market.redeem(marketId);

        assertEq(market.freeCollateral(trader), 500_000_000);
        (uint128 yesShares, uint128 noShares, bool redeemed) = market.positions(marketId, trader);
        assertEq(uint256(yesShares), 0);
        assertEq(uint256(noShares), 0);
        assertTrue(redeemed);
    }

    function testClaimRevertsForInvalidProof() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);
        _finalizeOracleSettlement(1, 600_000, settlements);

        bytes32[] memory wrongProof = new bytes32[](1);
        wrongProof[0] = bytes32(uint256(123));

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidSettlement.selector));
        vm.prank(trader);
        market.claimEpochSettlement(marketId, 1, settlements[0], wrongProof);
    }

    function testClaimRevertsForTraderWithoutReservedCollateral() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(traderTwo, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);
        _finalizeOracleSettlement(1, 600_000, settlements);

        bytes32[] memory proof = _proofForSettlement(1, settlements, 0);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidEpoch.selector));
        vm.prank(traderTwo);
        market.claimEpochSettlement(marketId, 1, settlements[0], proof);
    }

    function testClaimRevertsWhenReplayed() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);
        _finalizeOracleSettlement(1, 600_000, settlements);

        _claimSettlement(1, settlements, 0, trader);

        bytes32[] memory proof = _proofForSettlement(1, settlements, 0);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidEpoch.selector));
        vm.prank(trader);
        market.claimEpochSettlement(marketId, 1, settlements[0], proof);
    }

    function testCheckUpkeepSkipsEmptyEpochs() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 71);
        _lockAndSubmitCurrentEpoch(trader, hex"BB", 100_000_000);

        vm.warp(block.timestamp + 60);

        assertEq(uint256(market.getNextSettlementEpoch(marketId)), 2);

        (bool upkeepNeeded, bytes memory performData) = market.checkUpkeep(abi.encode(_singleMarketArray(marketId)));
        assertTrue(upkeepNeeded);

        (uint64 upkeepMarketId, uint64 upkeepEpoch) = abi.decode(performData, (uint64, uint64));
        assertEq(uint256(upkeepMarketId), uint256(marketId));
        assertEq(uint256(upkeepEpoch), 2);
    }

    function testCREForwarderReportSettlementAndClaimsUpdateBalancesAndPositions() public {
        vm.prank(owner);
        market.setCREForwarder(creForwarder);

        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 80_000_000, 20_000_000, 0, int128(100_000_000), 0);

        PrivatePredictionMarket.SettlementReport memory report = _settlementReport(1, 800_000, settlements);

        vm.prank(creForwarder);
        market.onReport(hex"1234", abi.encode(_settlementEnvelope(report)));

        _claimSettlement(1, settlements, 0, trader);

        assertEq(market.freeCollateral(trader), 420_000_000);
        assertEq(market.reservedCollateral(trader), 0);

        (uint128 yesShares, uint128 noShares, bool redeemed) = market.positions(marketId, trader);
        assertEq(uint256(yesShares), 100_000_000);
        assertEq(uint256(noShares), 0);
        assertTrue(!redeemed);
    }

    function testClaimEnforcesSequentialEpochOrderAndSupportsCollateralCredit() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory openSettlements = new PrivatePredictionMarket.TraderSettlement[](1);
        openSettlements[0] = _settlement(trader, 100_000_000, 0, 0, int128(100_000_000), 0);
        _finalizeOracleSettlement(1, 600_000, openSettlements);

        _lockAndSubmitCurrentEpoch(trader, hex"BB", 25_000_000);

        _requestSettlement(2);

        PrivatePredictionMarket.TraderSettlement[] memory closeSettlements = new PrivatePredictionMarket.TraderSettlement[](1);
        closeSettlements[0] = _settlement(trader, 0, 25_000_000, 15_000_000, -25_000_000, 0);
        _finalizeOracleSettlement(2, 650_000, closeSettlements);

        bytes32[] memory closeProof = _proofForSettlement(2, closeSettlements, 0);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidEpoch.selector));
        vm.prank(trader);
        market.claimEpochSettlement(marketId, 2, closeSettlements[0], closeProof);

        _claimSettlement(1, openSettlements, 0, trader);
        assertEq(uint256(market.nextClaimEpoch(marketId, trader)), 2);

        _claimSettlement(2, closeSettlements, 0, trader);

        assertEq(market.freeCollateral(trader), 415_000_000);
        assertEq(market.reservedCollateral(trader), 0);
        assertEq(market.unclaimedSettlementCount(marketId, trader), 0);

        (uint128 yesShares, uint128 noShares, bool redeemed) = market.positions(marketId, trader);
        assertEq(uint256(yesShares), 75_000_000);
        assertEq(uint256(noShares), 0);
        assertTrue(!redeemed);
    }

    function testBatchClaimEpochSettlementsClaimsMultipleEpochs() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory openSettlements = new PrivatePredictionMarket.TraderSettlement[](1);
        openSettlements[0] = _settlement(trader, 100_000_000, 0, 0, int128(100_000_000), 0);
        _finalizeOracleSettlement(1, 600_000, openSettlements);

        _lockAndSubmitCurrentEpoch(trader, hex"BB", 25_000_000);

        _requestSettlement(2);

        PrivatePredictionMarket.TraderSettlement[] memory closeSettlements = new PrivatePredictionMarket.TraderSettlement[](1);
        closeSettlements[0] = _settlement(trader, 0, 25_000_000, 15_000_000, -25_000_000, 0);
        _finalizeOracleSettlement(2, 650_000, closeSettlements);

        uint64[] memory epochs = new uint64[](2);
        epochs[0] = 1;
        epochs[1] = 2;

        PrivatePredictionMarket.TraderSettlement[] memory traderSettlements = new PrivatePredictionMarket.TraderSettlement[](2);
        traderSettlements[0] = openSettlements[0];
        traderSettlements[1] = closeSettlements[0];

        bytes32[][] memory merkleProofs = new bytes32[][](2);
        merkleProofs[0] = _proofForSettlement(1, openSettlements, 0);
        merkleProofs[1] = _proofForSettlement(2, closeSettlements, 0);

        vm.prank(trader);
        (uint256 claimedCount, uint64 nextEpochAfterBatch) = market.batchClaimEpochSettlements(
            marketId,
            epochs,
            traderSettlements,
            merkleProofs
        );

        assertEq(claimedCount, 2);
        assertEq(uint256(nextEpochAfterBatch), 0);
        assertEq(market.freeCollateral(trader), 415_000_000);
        assertEq(market.reservedCollateral(trader), 0);
        assertEq(market.unclaimedSettlementCount(marketId, trader), 0);
        assertTrue(market.epochSettlementClaimed(marketId, 1, trader));
        assertTrue(market.epochSettlementClaimed(marketId, 2, trader));

        (uint128 yesShares, uint128 noShares, bool redeemed) = market.positions(marketId, trader);
        assertEq(uint256(yesShares), 75_000_000);
        assertEq(uint256(noShares), 0);
        assertTrue(!redeemed);
    }

    function testBatchClaimEpochSettlementsRevertsForMismatchedArrayLengths() public {
        uint64[] memory epochs = new uint64[](1);
        epochs[0] = 1;

        PrivatePredictionMarket.TraderSettlement[] memory traderSettlements = new PrivatePredictionMarket.TraderSettlement[](0);
        bytes32[][] memory merkleProofs = new bytes32[][](1);
        merkleProofs[0] = new bytes32[](0);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidArrayLength.selector));
        vm.prank(trader);
        market.batchClaimEpochSettlements(marketId, epochs, traderSettlements, merkleProofs);
    }

    function testMarketShareSupplyTracksPendingAndClaimedOpenInterest() public {
        _depositFor(trader, 500_000_000);
        _depositFor(traderTwo, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);
        _lockAndSubmitCurrentEpoch(traderTwo, hex"BB", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](2);
        settlements[0] = _settlement(trader, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);
        settlements[1] = _settlement(traderTwo, 40_000_000, 60_000_000, 0, 0, int128(100_000_000));
        _finalizeOracleSettlement(1, 600_000, settlements);

        (int256 claimedYesBefore, int256 claimedNoBefore, int256 pendingYesBefore, int256 pendingNoBefore) =
            market.getMarketShareSupply(marketId);
        assertTrue(claimedYesBefore == 0);
        assertTrue(claimedNoBefore == 0);
        assertTrue(pendingYesBefore == 100_000_000);
        assertTrue(pendingNoBefore == 100_000_000);

        _claimSettlement(1, settlements, 0, trader);

        (int256 claimedYesMid, int256 claimedNoMid, int256 pendingYesMid, int256 pendingNoMid) =
            market.getMarketShareSupply(marketId);
        assertTrue(claimedYesMid == 100_000_000);
        assertTrue(claimedNoMid == 0);
        assertTrue(pendingYesMid == 0);
        assertTrue(pendingNoMid == 100_000_000);

        _claimSettlement(1, settlements, 1, traderTwo);

        (int256 claimedYesAfter, int256 claimedNoAfter, int256 pendingYesAfter, int256 pendingNoAfter) =
            market.getMarketShareSupply(marketId);
        assertTrue(claimedYesAfter == 100_000_000);
        assertTrue(claimedNoAfter == 100_000_000);
        assertTrue(pendingYesAfter == 0);
        assertTrue(pendingNoAfter == 0);
    }

    function testOracleSettlementRevertsForNegativeAggregateOpenInterest() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 0, 100_000_000, 0, -1, 0);

        PrivatePredictionMarket.SettlementReport memory report = PrivatePredictionMarket.SettlementReport({
            marketId: marketId,
            epoch: 1,
            clearingPrice: 600_000,
            settlementRoot: _settlementRoot(1, settlements),
            totalYesSharesDelta: -1,
            totalNoSharesDelta: 0,
            settlementHash: bytes32(0)
        });
        report.settlementHash = _settlementHash(report);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidSettlement.selector));
        vm.prank(resolutionOracle);
        market.settleEpoch(
            marketId,
            1,
            report.clearingPrice,
            report.settlementRoot,
            report.totalYesSharesDelta,
            report.totalNoSharesDelta,
            report.settlementHash
        );
    }

    function testManualResolutionDisabledWhenCREForwarderConfigured() public {
        vm.prank(owner);
        market.setCREForwarder(creForwarder);

        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 100_000_000, 0, 0, int128(100_000_000), 0);
        PrivatePredictionMarket.SettlementReport memory report = _settlementReport(1, 700_000, settlements);

        vm.prank(creForwarder);
        market.onReport(hex"1234", abi.encode(_settlementEnvelope(report)));

        vm.warp(block.timestamp + 600);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidState.selector));
        vm.prank(resolutionOracle);
        market.resolveMarket(marketId, PrivatePredictionMarket.Outcome.Yes);
    }

    function testClaimEpochSettlementRevertsWhenReentered() public {
        NonReentrantClaimMarketHarness harness = new NonReentrantClaimMarketHarness(address(usdc), owner);
        PrivatePredictionMarket.TraderSettlement memory settlement = _settlement(address(harness), 0, 0, 0, 0, 0);
        bytes32[] memory proof = new bytes32[](0);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.Reentrancy.selector));
        harness.reenterClaim(1, 1, settlement, proof);
    }

    function testBatchClaimEpochSettlementsRevertsWhenReentered() public {
        NonReentrantClaimMarketHarness harness = new NonReentrantClaimMarketHarness(address(usdc), owner);
        uint64[] memory epochs = new uint64[](1);
        epochs[0] = 1;
        PrivatePredictionMarket.TraderSettlement[] memory traderSettlements = new PrivatePredictionMarket.TraderSettlement[](1);
        traderSettlements[0] = _settlement(address(harness), 0, 0, 0, 0, 0);
        bytes32[][] memory merkleProofs = new bytes32[][](1);
        merkleProofs[0] = new bytes32[](0);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.Reentrancy.selector));
        harness.reenterBatchClaim(1, epochs, traderSettlements, merkleProofs);
    }

    function testClaimHelpersExposePendingQueueState() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        vm.warp(block.timestamp + 71);
        _lockAndSubmitCurrentEpoch(trader, hex"BB", 25_000_000);

        (uint64 nextEpochBefore, uint256 pendingCountBefore) = market.getClaimQueueState(marketId, trader);
        assertEq(uint256(nextEpochBefore), 1);
        assertEq(pendingCountBefore, 2);

        uint64[] memory pendingEpochsBefore = market.getPendingClaimEpochs(marketId, trader, 4);
        assertEq(uint256(pendingEpochsBefore.length), 2);
        assertEq(uint256(pendingEpochsBefore[0]), 1);
        assertEq(uint256(pendingEpochsBefore[1]), 2);

        (bool queuedBefore, bool readyBefore, bool claimedBefore, uint256 reservedBefore, uint96 clearingBefore, bytes32 rootBefore)
        = market.getClaimStatus(marketId, 1, trader);
        assertTrue(queuedBefore);
        assertTrue(!readyBefore);
        assertTrue(!claimedBefore);
        assertEq(reservedBefore, 100_000_000);
        assertEq(uint256(clearingBefore), 0);
        assertEq(rootBefore, bytes32(0));

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory epochOneSettlements = new PrivatePredictionMarket.TraderSettlement[](1);
        epochOneSettlements[0] = _settlement(trader, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);
        PrivatePredictionMarket.SettlementReport memory epochOneReport = _finalizeOracleSettlement(1, 600_000, epochOneSettlements);

        (bool queuedAfter, bool readyAfter, bool claimedAfter, uint256 reservedAfter, uint96 clearingAfter, bytes32 rootAfter) =
            market.getClaimStatus(marketId, 1, trader);
        assertTrue(queuedAfter);
        assertTrue(readyAfter);
        assertTrue(!claimedAfter);
        assertEq(reservedAfter, 100_000_000);
        assertEq(uint256(clearingAfter), 600_000);
        assertEq(rootAfter, epochOneReport.settlementRoot);

        _claimSettlement(1, epochOneSettlements, 0, trader);

        (uint64 nextEpochAfter, uint256 pendingCountAfter) = market.getClaimQueueState(marketId, trader);
        assertEq(uint256(nextEpochAfter), 2);
        assertEq(pendingCountAfter, 1);

        uint64[] memory pendingEpochsAfter = market.getPendingClaimEpochs(marketId, trader, 4);
        assertEq(uint256(pendingEpochsAfter.length), 1);
        assertEq(uint256(pendingEpochsAfter[0]), 2);

        (bool queuedClaimed, bool readyClaimed, bool claimedClaimed, uint256 reservedClaimed,,) =
            market.getClaimStatus(marketId, 1, trader);
        assertTrue(!queuedClaimed);
        assertTrue(!readyClaimed);
        assertTrue(claimedClaimed);
        assertEq(reservedClaimed, 0);
    }

    function testOracleSettlementRevertsForMismatchedSettlementHash() public {
        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);
        bytes32 settlementRoot = _settlementRoot(1, settlements);
        (int256 totalYesSharesDelta, int256 totalNoSharesDelta) = _aggregateShareDeltas(settlements);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidSettlement.selector));
        vm.prank(resolutionOracle);
        market.settleEpoch(marketId, 1, 600_000, settlementRoot, totalYesSharesDelta, totalNoSharesDelta, bytes32(uint256(123)));
    }

    function testOracleSettlementDisabledWhenCREForwarderConfigured() public {
        vm.prank(owner);
        market.setCREForwarder(creForwarder);

        _depositFor(trader, 500_000_000);

        vm.warp(block.timestamp + 11);
        _lockAndSubmitCurrentEpoch(trader, hex"AA", 100_000_000);

        _requestSettlement(1);

        PrivatePredictionMarket.TraderSettlement[] memory settlements = new PrivatePredictionMarket.TraderSettlement[](1);
        settlements[0] = _settlement(trader, 60_000_000, 40_000_000, 0, int128(100_000_000), 0);
        PrivatePredictionMarket.SettlementReport memory report = _settlementReport(1, 600_000, settlements);

        vm.expectRevert(abi.encodeWithSelector(PrivatePredictionMarket.InvalidState.selector));
        vm.prank(resolutionOracle);
        market.settleEpoch(
            marketId,
            1,
            600_000,
            report.settlementRoot,
            report.totalYesSharesDelta,
            report.totalNoSharesDelta,
            report.settlementHash
        );
    }

    function _depositFor(address user, uint256 amount) internal {
        vm.startPrank(user);
        usdc.approve(address(market), amount);
        market.deposit(amount);
        vm.stopPrank();
    }

    function _lockEpochCollateral(address user, uint64 epoch, uint128 amount) internal {
        vm.prank(user);
        market.lockEpochCollateral(marketId, epoch, amount);
    }

    function _lockAndSubmitCurrentEpoch(address user, bytes memory ciphertext, uint128 amount)
        internal
        returns (uint256 orderId)
    {
        uint64 epoch = market.getCurrentEpoch(marketId);
        _lockEpochCollateral(user, epoch, amount);
        vm.prank(user);
        orderId = market.submitEncryptedOrder(marketId, ciphertext);
    }

    function _requestSettlement(uint64 expectedEpoch) internal {
        vm.warp(block.timestamp + 60);
        (bool upkeepNeeded, bytes memory performData) = market.checkUpkeep(abi.encode(_singleMarketArray(marketId)));
        assertTrue(upkeepNeeded);

        (uint64 upkeepMarketId, uint64 upkeepEpoch) = abi.decode(performData, (uint64, uint64));
        assertEq(uint256(upkeepMarketId), uint256(marketId));
        assertEq(uint256(upkeepEpoch), uint256(expectedEpoch));

        vm.prank(automationForwarder);
        market.performUpkeep(performData);
    }

    function _finalizeOracleSettlement(uint64 epoch, uint96 clearingPrice, PrivatePredictionMarket.TraderSettlement[] memory settlements)
        internal
        returns (PrivatePredictionMarket.SettlementReport memory report)
    {
        report = _settlementReport(epoch, clearingPrice, settlements);

        vm.prank(resolutionOracle);
        market.settleEpoch(
            marketId,
            epoch,
            clearingPrice,
            report.settlementRoot,
            report.totalYesSharesDelta,
            report.totalNoSharesDelta,
            report.settlementHash
        );
    }

    function _settlementReport(
        uint64 epoch,
        uint96 clearingPrice,
        PrivatePredictionMarket.TraderSettlement[] memory settlements
    ) internal view returns (PrivatePredictionMarket.SettlementReport memory report) {
        (int256 totalYesSharesDelta, int256 totalNoSharesDelta) = _aggregateShareDeltas(settlements);
        report = PrivatePredictionMarket.SettlementReport({
            marketId: marketId,
            epoch: epoch,
            clearingPrice: clearingPrice,
            settlementRoot: _settlementRoot(epoch, settlements),
            totalYesSharesDelta: totalYesSharesDelta,
            totalNoSharesDelta: totalNoSharesDelta,
            settlementHash: bytes32(0)
        });
        report.settlementHash = _settlementHash(report);
    }

    function _resolutionReport(PrivatePredictionMarket.Outcome outcome, bytes32 evidenceHash)
        internal
        view
        returns (PrivatePredictionMarket.ResolutionReport memory report)
    {
        report = PrivatePredictionMarket.ResolutionReport({
            marketId: marketId,
            outcome: outcome,
            evidenceHash: evidenceHash,
            resolutionHash: bytes32(0)
        });
        report.resolutionHash = market.hashResolutionReport(report);
    }

    function _settlementEnvelope(PrivatePredictionMarket.SettlementReport memory report)
        internal
        pure
        returns (PrivatePredictionMarket.CREReportEnvelope memory)
    {
        return PrivatePredictionMarket.CREReportEnvelope({reportType: 1, payload: abi.encode(report)});
    }

    function _resolutionEnvelope(PrivatePredictionMarket.ResolutionReport memory report)
        internal
        pure
        returns (PrivatePredictionMarket.CREReportEnvelope memory)
    {
        return PrivatePredictionMarket.CREReportEnvelope({reportType: 2, payload: abi.encode(report)});
    }

    function _claimSettlement(
        uint64 epoch,
        PrivatePredictionMarket.TraderSettlement[] memory settlements,
        uint256 index,
        address claimant
    ) internal {
        bytes32[] memory proof = _proofForSettlement(epoch, settlements, index);
        vm.prank(claimant);
        market.claimEpochSettlement(marketId, epoch, settlements[index], proof);
    }

    function _settlement(
        address traderAddress,
        uint128 reservedCollateralSpent,
        uint128 reservedCollateralRefunded,
        uint128 collateralCredit,
        int128 yesSharesDelta,
        int128 noSharesDelta
    ) internal pure returns (PrivatePredictionMarket.TraderSettlement memory) {
        return PrivatePredictionMarket.TraderSettlement({
            trader: traderAddress,
            reservedCollateralSpent: reservedCollateralSpent,
            reservedCollateralRefunded: reservedCollateralRefunded,
            collateralCredit: collateralCredit,
            yesSharesDelta: yesSharesDelta,
            noSharesDelta: noSharesDelta
        });
    }

    function _aggregateShareDeltas(PrivatePredictionMarket.TraderSettlement[] memory settlements)
        internal
        pure
        returns (int256 totalYesSharesDelta, int256 totalNoSharesDelta)
    {
        uint256 length = settlements.length;
        for (uint256 i = 0; i < length; ++i) {
            totalYesSharesDelta += settlements[i].yesSharesDelta;
            totalNoSharesDelta += settlements[i].noSharesDelta;
        }
    }

    function _settlementRoot(uint64 epoch, PrivatePredictionMarket.TraderSettlement[] memory settlements)
        internal
        view
        returns (bytes32 root)
    {
        bytes32[] memory level = _settlementLeaves(epoch, settlements);
        uint256 length = level.length;
        while (length > 1) {
            uint256 nextLength = (length + 1) / 2;
            bytes32[] memory nextLevel = new bytes32[](nextLength);
            for (uint256 i = 0; i < nextLength; ++i) {
                uint256 leftIndex = i * 2;
                uint256 rightIndex = leftIndex + 1;
                if (rightIndex < length) {
                    nextLevel[i] = _hashPair(level[leftIndex], level[rightIndex]);
                } else {
                    nextLevel[i] = level[leftIndex];
                }
            }
            level = nextLevel;
            length = nextLength;
        }

        root = level[0];
    }

    function _proofForSettlement(
        uint64 epoch,
        PrivatePredictionMarket.TraderSettlement[] memory settlements,
        uint256 targetIndex
    ) internal view returns (bytes32[] memory proof) {
        bytes32[] memory level = _settlementLeaves(epoch, settlements);
        bytes32[] memory scratch = new bytes32[](settlements.length);
        uint256 proofLength;
        uint256 index = targetIndex;
        uint256 length = level.length;

        while (length > 1) {
            uint256 siblingIndex = index ^ 1;
            if (siblingIndex < length) {
                scratch[proofLength] = level[siblingIndex];
                proofLength += 1;
            }

            uint256 nextLength = (length + 1) / 2;
            bytes32[] memory nextLevel = new bytes32[](nextLength);
            for (uint256 i = 0; i < nextLength; ++i) {
                uint256 leftIndex = i * 2;
                uint256 rightIndex = leftIndex + 1;
                if (rightIndex < length) {
                    nextLevel[i] = _hashPair(level[leftIndex], level[rightIndex]);
                } else {
                    nextLevel[i] = level[leftIndex];
                }
            }

            level = nextLevel;
            length = nextLength;
            index /= 2;
        }

        proof = new bytes32[](proofLength);
        for (uint256 i = 0; i < proofLength; ++i) {
            proof[i] = scratch[i];
        }
    }

    function _settlementLeaves(uint64 epoch, PrivatePredictionMarket.TraderSettlement[] memory settlements)
        internal
        view
        returns (bytes32[] memory leaves)
    {
        uint256 length = settlements.length;
        leaves = new bytes32[](length);
        for (uint256 i = 0; i < length; ++i) {
            leaves[i] = market.hashSettlementLeaf(marketId, epoch, settlements[i]);
        }
    }

    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return left <= right ? keccak256(abi.encodePacked(left, right)) : keccak256(abi.encodePacked(right, left));
    }

    function _singleMarketArray(uint64 value) internal pure returns (uint64[] memory values) {
        values = new uint64[](1);
        values[0] = value;
    }

    function _settlementHash(PrivatePredictionMarket.SettlementReport memory report) internal view returns (bytes32) {
        return market.hashSettlementReport(report);
    }
}

contract NonReentrantClaimMarketHarness is PrivatePredictionMarket {
    constructor(address collateralToken_, address owner_) PrivatePredictionMarket(collateralToken_, owner_) {}

    function reenterClaim(
        uint64 marketId,
        uint64 epoch,
        TraderSettlement calldata traderSettlement,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        this.claimEpochSettlement(marketId, epoch, traderSettlement, merkleProof);
    }

    function reenterBatchClaim(
        uint64 marketId,
        uint64[] calldata epochs,
        TraderSettlement[] calldata traderSettlements,
        bytes32[][] calldata merkleProofs
    ) external nonReentrant returns (uint256 claimedCount, uint64 nextEpochAfterBatch) {
        return this.batchClaimEpochSettlements(marketId, epochs, traderSettlements, merkleProofs);
    }
}
