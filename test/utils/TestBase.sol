pragma solidity 0.8.26;

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes calldata) external;
}

contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 left, uint256 right) internal pure {
        require(left == right, "ASSERT_EQ_UINT");
    }

    function assertEq(address left, address right) internal pure {
        require(left == right, "ASSERT_EQ_ADDRESS");
    }

    function assertEq(bytes32 left, bytes32 right) internal pure {
        require(left == right, "ASSERT_EQ_BYTES32");
    }

    function assertTrue(bool value) internal pure {
        require(value, "ASSERT_TRUE");
    }
}
