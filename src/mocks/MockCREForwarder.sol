pragma solidity 0.8.26;

import {IReceiver} from "../interfaces/IReceiver.sol";

contract MockCREForwarder {
    uint256 private constant REPORT_METADATA_HEADER_LENGTH = 109;

    error InvalidReceiver();
    error InvalidMetadata();
    error InvalidRawReport();
    error InvalidSignatures();
    error UnsupportedSelector(bytes4 selector);

    event Forwarded(address indexed receiver, bytes metadata, bytes payload);

    function report(address receiver, bytes calldata rawReport, bytes calldata metadata, bytes[] calldata signatures)
        external
    {
        if (receiver == address(0) || receiver.code.length == 0) revert InvalidReceiver();
        if (metadata.length == 0) revert InvalidMetadata();
        if (signatures.length == 0) revert InvalidSignatures();
        for (uint256 i = 0; i < signatures.length; ++i) {
            if (signatures[i].length == 0) revert InvalidSignatures();
        }
        _forward(receiver, metadata, _extractPayload(rawReport));
    }

    fallback() external payable {
        revert UnsupportedSelector(msg.sig);
    }

    receive() external payable {
        revert UnsupportedSelector(0x00000000);
    }

    function _forward(address receiver, bytes memory metadata, bytes memory payload) internal {
        if (payload.length == 0) revert InvalidRawReport();
        IReceiver(receiver).onReport(metadata, payload);
        emit Forwarded(receiver, metadata, payload);
    }

    function _extractPayload(bytes calldata rawReport) internal pure returns (bytes memory payload) {
        if (rawReport.length <= REPORT_METADATA_HEADER_LENGTH) revert InvalidRawReport();

        uint256 payloadLength = rawReport.length - REPORT_METADATA_HEADER_LENGTH;
        payload = new bytes(payloadLength);
        for (uint256 i = 0; i < payloadLength; ++i) {
            payload[i] = rawReport[REPORT_METADATA_HEADER_LENGTH + i];
        }
    }
}
