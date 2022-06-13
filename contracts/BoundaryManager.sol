// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0 <0.9.0;

/// ERRORS ///

/// @notice Thrown when trying to set a boundary that has already been set
error BoundaryAlreadySet();

/// @notice Thrown when trying to add duplicate refund receiver
error DuplicateRefundReceiver();

/// @notice Thrown when the refund receiver was not allowlisted
error InvalidRefundReceiver();

/// @notice Thrown when the number does not fit in the range of uint16
error Uint16Overflow(uint256 number, uint256 max);

import "hardhat/console.sol";

/**
 * @title BoundaryManager
 * @author @mikhailxyz
 * @notice BoundaryManager is a contract
 */
contract BoundaryManager {
    // safeAddress -> RefundBoundary
    mapping(address => RefundBoundary) public safeRefundBoundaries;

    event RefundBoundarySet(address indexed safe, uint120 maxFeePerGas, uint120 maxGasLimit, address[] allowlist);
    event GasBoundaryUpdated(address indexed safe, uint120 maxFeePerGas, uint120 maxGasLimit);
    event AddedRefundReceivers(address indexed safe, address[] receivers);
    event RemovedRefundReceivers(address indexed safe, address[] receivers);

    /** @dev RefundBoundary struct represents the boundary for refunds
     * @param maxFeePerGas - Maximim gas price that can be refunded, includes basefee and priority fee
     * @param maxGasLimit - Maximum gas limit for a transaction, returned is the minimum of gas spend and transaction gas limit
     * @param allowedRefundReceiversCount - Count of allowed refund receivers, we use it to track if the allowlist is enforced. Maximum 65,535 addresses
     * @param refundReceiverAllowlist - Mapping of allowed refund receivers, address -> bool
     */
    struct RefundBoundary {
        // First storage slot (32 bytes)
        uint120 maxFeePerGas; // 120 bits - 15 bytes. Max 1.32e18 tokens, including decimals
        uint120 maxGasLimit; // 120 bits - 15 bytes. Max 1.32e36 gas
        uint16 allowedRefundReceiversCount; // 16 bits - 2 bytes. Max 65,535 receivers
        // End of first storage slot
        mapping(address => bool) refundReceiverAllowlist;
    }

    /**  @notice Sets up refund boundary for a given safe.
     *           Can only be set once. To update the boundary use narrow-scoped functions:
     *           updateGasBoundaries, addRefundReceivers, addRefundReceivers
     *           The boundary can be disabled by setting maxGasLimit or maxFeePerGas to 0.
     *           To reset the boundary, it has to be cleaned up first: gas parameters set to 0, and refund receivers removed.
     * @param maxFeePerGas Maximum gas price to refund
     * @param maxGasLimit Maximum gas limit that can be refunded
     * @param refundReceiverAllowlist Sorted addresses of allowed refund receivers
     */
    function setupRefundBoundary(
        uint120 maxFeePerGas,
        uint120 maxGasLimit,
        address[] calldata refundReceiverAllowlist
    ) public {
        if (isBoundarySet(msg.sender)) {
            revert BoundaryAlreadySet();
        }

        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender];
        safeRefundBoundary.maxFeePerGas = maxFeePerGas;
        safeRefundBoundary.maxGasLimit = maxGasLimit;
        safeRefundBoundary.allowedRefundReceiversCount = uint16(refundReceiverAllowlist.length);

        address prevReceiver = address(0);
        unchecked {
            for (uint16 i = 0; i < safeRefundBoundary.allowedRefundReceiversCount; i++) {
                // We require the list to be sorted to prevent duplicate addresses
                if (refundReceiverAllowlist[i] <= prevReceiver) {
                    revert DuplicateRefundReceiver();
                }

                safeRefundBoundary.refundReceiverAllowlist[refundReceiverAllowlist[i]] = true;
                prevReceiver = refundReceiverAllowlist[i];
            }
        }

        emit RefundBoundarySet(msg.sender, maxFeePerGas, maxGasLimit, refundReceiverAllowlist);
    }

    /**  @notice Updates the gas boundaries for msg.sender and provided gas token.
     * @param maxFeePerGas Maximum gas price to refund
     * @param maxGasLimit Maximum gas limit that can be refunded
     */
    function updateGasBoundaries(uint120 maxFeePerGas, uint120 maxGasLimit) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender];
        safeRefundBoundary.maxFeePerGas = maxFeePerGas;
        safeRefundBoundary.maxGasLimit = maxGasLimit;

        emit GasBoundaryUpdated(msg.sender, maxFeePerGas, maxGasLimit);
    }

    function addRefundReceivers(address[] calldata refundReceivers) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender];
        safeRefundBoundary.allowedRefundReceiversCount =
            safeRefundBoundary.allowedRefundReceiversCount +
            safeCastToUint16(refundReceivers.length);

        for (uint16 i = 0; i < refundReceivers.length; i++) {
            if (safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]]) {
                revert InvalidRefundReceiver();
            }

            safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]] = true;
        }

        emit AddedRefundReceivers(msg.sender, refundReceivers);
    }

    function removeRefundReceivers(address[] calldata refundReceivers) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender];
        safeRefundBoundary.allowedRefundReceiversCount =
            safeRefundBoundary.allowedRefundReceiversCount -
            safeCastToUint16(refundReceivers.length);

        for (uint16 i = 0; i < refundReceivers.length; i++) {
            if (!safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]]) {
                revert InvalidRefundReceiver();
            }

            safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]] = false;
        }

        emit RemovedRefundReceivers(msg.sender, refundReceivers);
    }

    function isBoundarySet(address safe) public view returns (bool) {
        return
            safeRefundBoundaries[safe].maxFeePerGas != 0 ||
            safeRefundBoundaries[safe].maxGasLimit != 0 ||
            safeRefundBoundaries[safe].allowedRefundReceiversCount != 0;
    }

    /** @dev A function to check if a given address is a valid refund receiver for a given Safe and token
     * @param safe Safe address
     * @param refundReceiver Refund receiver address
     * @return Boolean indicating if the address is a valid refund receiver
     */
    function isAllowedRefundReceiver(address safe, address refundReceiver) public view returns (bool) {
        // The prerequisite is a set boundary (maxFeePerGas != 0 or maxGasLimit != 0)
        // Receiver is allowed to be refunded if:
        // 1. No allowlist is set (counter is 0). Therefore, we say it's not enforced
        // 2. The receiver address is in the list of allowed receivers for that safe address and gas token combination
        return
            // Check that the boundary was set
            (safeRefundBoundaries[safe].maxFeePerGas != 0 && safeRefundBoundaries[safe].maxGasLimit != 0) &&
            // Now check if the receiver is allowed
            (safeRefundBoundaries[safe].allowedRefundReceiversCount == 0 ||
                safeRefundBoundaries[safe].refundReceiverAllowlist[refundReceiver]);
    }

    /** @dev Safely casts uint256 numbers to uint16. Reverts if the number is too large.
     * @param x uint256 number
     * @return numba uint16 number
     */
    function safeCastToUint16(uint256 x) internal pure returns (uint16 numba) {
        if (x > type(uint16).max) {
            revert Uint16Overflow(x, type(uint16).max);
        }

        numba = uint16(x);
    }
}
