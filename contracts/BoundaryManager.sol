// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0 <0.9.0;

/// ERRORS ///

/// @notice Thrown when trying to add duplicate refund receiver
error DuplicateRefundReceiver();

/// @notice Thrown when the refund receiver was not allowlisted
error InvalidRefundReceiver();

/**
 * @title BoundaryManager
 * @author @mikhailxyz
 * @notice BoundaryManager is a contract
 */
contract BoundaryManager {
    // safeAddress -> tokenAddress -> RefundBoundary
    mapping(address => mapping(address => RefundBoundary)) public safeRefundBoundaries;

    event BoundarySet(address safe, address token, uint120 maxGasLimit, uint120 maxFeePerGas, address[] allowlist);
    event GasBoundaryUpdated(address safe, address token, uint120 maxGasLimit, uint120 maxFeePerGas);

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

    /**  @notice Sets up refund boundary for a given safe and gas token.
     *           Can only be set once. To update the boundary use narrow-scoped functions:
     *           updateGasBoundaries, addRefundReceivers, addRefundReceivers
     *           To the boundary cna be disabled by setting maxGasLimit or maxFeePerGas to 0.
     * @param tokenAddress Refund token address
     * @param maxFeePerGas Maximum gas price to refund
     * @param maxGasLimit Maximum gas limit that can be refunded
     * @param refundReceiverAllowlist Sorted addresses of allowed refund receivers
     */
    function setupRefundBoundary(
        address tokenAddress,
        uint120 maxFeePerGas,
        uint120 maxGasLimit,
        address[] calldata refundReceiverAllowlist
    ) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender][tokenAddress];
        safeRefundBoundary.maxFeePerGas = maxFeePerGas;
        safeRefundBoundary.maxGasLimit = maxGasLimit;
        safeRefundBoundary.allowedRefundReceiversCount = uint16(refundReceiverAllowlist.length);

        address prevOwner = address(0);
        unchecked {
            for (uint16 i = 0; i < safeRefundBoundary.allowedRefundReceiversCount; i++) {
                
                // COMMENT: will this handle the case when there are 2 duplicate addresses?
                // refundReciever[i] = 1 and prevOwner = 1 should pass this <if statement>'s conditional
                // i.e. it will not revert if two addresses are the same.
                
                // We require the list to be sorted to prevent duplicate addresses
                if (refundReceiverAllowlist[i] < prevOwner) {
                    revert DuplicateRefundReceiver();
                }

                safeRefundBoundary.refundReceiverAllowlist[refundReceiverAllowlist[i]] = true;
                prevOwner = refundReceiverAllowlist[i];
            }
        }

        emit BoundarySet(msg.sender, tokenAddress, maxGasLimit, maxFeePerGas, refundReceiverAllowlist);
    }

    /**  @notice Updates the gas boundaries for msg.sender and provided gas token.
     * @param tokenAddress Refund token address
     * @param maxFeePerGas Maximum gas price to refund
     * @param maxGasLimit Maximum gas limit that can be refunded
     */
    function updateGasBoundaries(
        address tokenAddress,
        uint120 maxFeePerGas,
        uint120 maxGasLimit
    ) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender][tokenAddress];
        safeRefundBoundary.maxFeePerGas = maxFeePerGas;
        safeRefundBoundary.maxGasLimit = maxGasLimit;

        emit GasBoundaryUpdated(msg.sender, tokenAddress, maxGasLimit, maxFeePerGas);
    }

    function addRefundReceivers(address tokenAddress, address[] calldata refundReceivers) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender][tokenAddress];
        
        // COMMENT: can this overflow the uint16 type and thus start the count from 0?
        safeRefundBoundary.allowedRefundReceiversCount = safeRefundBoundary.allowedRefundReceiversCount + uint16(refundReceivers.length);

        // COMMENT: it would be good to add comment / intention of what's happening here. 
        // Do I understand right that the code checks if the flag is already set to true (in which case it reverts). 
        // Should it revert? Why not ignore?
      
        for (uint16 i = 0; i < refundReceivers.length; i++) {
            if (safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]]) {
                revert InvalidRefundReceiver();
            }

            safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]] = true;
        }
    }

    function removeRefundReceivers(address tokenAddress, address[] calldata refundReceivers) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender][tokenAddress];

        // COMMENT: Can it overflow? i.e. if the left side is less than the right side in the subtraction?
        safeRefundBoundary.allowedRefundReceiversCount = safeRefundBoundary.allowedRefundReceiversCount - uint16(refundReceivers.length);

        for (uint16 i = 0; i < refundReceivers.length; i++) {
            // COMMENT: again, here, what is the reason for reverting here instead of ignoring?
            if (!safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]]) {
                revert InvalidRefundReceiver();
            }

            safeRefundBoundary.refundReceiverAllowlist[refundReceivers[i]] = false;
        }
    }

    function isBoundarySet(address safe, address tokenAddress) public view returns (bool) {
        return
            safeRefundBoundaries[safe][tokenAddress].maxFeePerGas != 0 ||
            safeRefundBoundaries[safe][tokenAddress].maxGasLimit != 0 ||
            safeRefundBoundaries[safe][tokenAddress].allowedRefundReceiversCount != 0;
    }
}
