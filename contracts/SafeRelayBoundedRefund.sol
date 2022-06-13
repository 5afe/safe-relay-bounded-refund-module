// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0 <0.9.0;

import "@rari-capital/solmate/src/utils/ReentrancyGuard.sol";
import "./BoundaryManager.sol";
import "./interfaces/Safe.sol";

/// ERRORS ///

/// @notice Thrown when the transaction reverts during the execution
error ExecutionFailure();

/// @notice Thrown when the refund receiver was not allowlisted
error RefundReceiverNotAllowed();

/// @notice Thrown when refund conditions for gas limit or gas price were not met
error RefundGasBoundariesNotMet(uint120 gasLimit, uint120 gasPrice, uint120 maxGasLimit, uint120 maxGasPrice);

/// @notice Thrown when failed to pay the refund
error RefundFailure();

/// @notice Thrown when the gas supplied to the transaction is less than signed gas limit
error NotEnoughGas(uint120 suppliedGas, uint120 gasLimit);

/// @notice Thrown when trying to relay method call other than `execTransaction`
error InvalidMethodSignature(bytes4 relayedMethod, bytes4 expectedMethod);

/**
 * @title SafeRelayBoundedRefund
 * @author @mikhailxyz
 * @notice SafeRelayBoundedRefund is a module for the Gnosis Safe that relays execTransaction call, a method for executing a transaction in
 *         the Gnosis Safe Core contract, and sends gas refund using the chain's native token.
 *         The built-in refund mechanism of the Gnosis Safe does not work well for refunds in multi-sig scenarios. For example, the refund
 *         gas price is a part of the transaction that has to be signed by the owners. Since the gas price is volatile on some networks,
 *         if the network gas price is higher than the refund gas price at the execution, the relayer doesn't have an economic motivation
 *         to pick up the transaction. Therefore, the owners must either wait for the price to decrease or regather transaction signatures
 *         with a higher gas price. This contract separates the transaction and refund parameters (Gas Price, Limit, Refund Receiver).
 *         The refund parameters have to be signed only by one owner. Safe owners can set boundaries for each param to protect from unreasonably
 *         high gas prices (see BoundaryManager contract).
 */
contract SafeRelayBoundedRefund is BoundaryManager, ReentrancyGuard {
    string public constant VERSION = "0.0.1";

    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH = keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    bytes32 private constant REFUND_PARAMS_TYPEHASH =
        keccak256("RefundParams(address safeAddress,uint256 nonce,uint120 gasLimit,uint120 maxFeePerGas,address refundReceiver)");

    // keccak256(execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes))
    bytes4 private constant EXEC_TRANSACTION_SIGNATURE = 0x6a761202;

    uint16 private constant COVERED_REFUND_PAYMENT_GAS = 23000;
    address private constant TX_ORIGIN_REFUND_RECEIVER = address(0);

    event SuccessfulExecution(bytes32 relayedDataHash, uint256 payment);

    /** @dev RefundParams struct represents the transaction refund params. Signed params also include safe transaction nonce.
     * @param safe - Safe address to pay the refund from
     * @param gasLimit - Maximum gas limit for a transaction, returned is the minimum of gas spend and transaction gas limit
     * @param maxFeePerGas - Maximim gas price that can be refunded, includes basefee and priority fee
     * @param allowedRefundReceiversCount - Count of allowed refund receivers, we use it to track if the allowlist is enforced
     * @param refundReceiverAllowlist - Capping of allowed refund receivers, address -> bool
     */
    struct RefundParams {
        address payable safeAddress;
        uint120 gasLimit;
        uint120 maxFeePerGas;
        address payable refundReceiver;
        bytes signature;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this));
    }

    /** @notice Relays an execTransaction call to the safe and pays a refund. The call has to be successful
     * @param execTransactionCallData Call data of the execTransaction call to be relayed
     * @param transactionRefundParams Refund params. See the struct definition for more info
     */
    function relayAndRefund(bytes calldata execTransactionCallData, RefundParams calldata transactionRefundParams)
        external
        payable
        nonReentrant // Prevents reentrancy from the contract signature check
    {
        // The startGas variable below is based on @juniset's assumption
        // used in Argent Wallet that the calldata approximately consists of 1/3 non-zero bytes and 2/3 zero bytes
        // https://github.com/argentlabs/argent-contracts/blob/c80d3cb4e98af9a9e4eae9dc7fa01ea677bd6e3a/contracts/modules/RelayerManager.sol#L94-L96
        // initial gas = 21k + non_zero_bytes * 16 + zero_bytes * 4
        //            ~= 21k + calldata.length * [1/3 * 16 + 2/3 * 4]
        uint256 startGas = gasleft() + 21000 + msg.data.length * 8;
        if (startGas < transactionRefundParams.gasLimit) {
            revert NotEnoughGas(uint120(startGas), transactionRefundParams.gasLimit);
        }

        // Only allow relaying execTransaction method calls
        if (bytes4(execTransactionCallData) != EXEC_TRANSACTION_SIGNATURE) {
            revert InvalidMethodSignature(bytes4(execTransactionCallData), EXEC_TRANSACTION_SIGNATURE);
        }

        /*                      REFUND PARAMS SIGNATURE CHECK                      */
        address payable safeAddress = transactionRefundParams.safeAddress;

        bytes memory encodedRefundParamsData = encodeRefundParamsData(
            safeAddress,
            Safe(safeAddress).nonce(),
            transactionRefundParams.gasLimit,
            transactionRefundParams.maxFeePerGas,
            transactionRefundParams.refundReceiver
        );
        bytes32 refundParamsHash = keccak256(encodedRefundParamsData);
        Safe(safeAddress).checkNSignatures(refundParamsHash, encodedRefundParamsData, transactionRefundParams.signature, 1);

        /*                      BOUNDARY CHECKS                      */
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[safeAddress];
        /*                      REFUND RECEIVER CHECK                      */
        if (!isAllowedRefundReceiver(safeAddress, transactionRefundParams.refundReceiver)) {
            revert RefundReceiverNotAllowed();
        }

        /*                      GAS PRICE AND LIMIT CHECKS                      */
        if (
            transactionRefundParams.maxFeePerGas > safeRefundBoundary.maxFeePerGas ||
            transactionRefundParams.gasLimit > safeRefundBoundary.maxGasLimit
        ) {
            revert RefundGasBoundariesNotMet(
                transactionRefundParams.gasLimit,
                transactionRefundParams.maxFeePerGas,
                safeRefundBoundary.maxGasLimit,
                safeRefundBoundary.maxFeePerGas
            );
        }

        // We need to guarantee that the safe nonce gets increased
        // So the refund signature cannot be reused for another call
        (bool success, ) = safeAddress.call(execTransactionCallData);
        if (!success) {
            revert ExecutionFailure();
        }

        uint256 payment = handleRefund(transactionRefundParams, startGas);

        emit SuccessfulExecution(keccak256(execTransactionCallData), payment);
    }

    /**  @dev Internal method to handle the refund
     * @param refundParams Refund params. See the struct definition for more info
     * @param startGas Gas available at the start of the transaction
     * @return payment Amount of refunded gas
     */
    function handleRefund(RefundParams calldata refundParams, uint256 startGas) internal returns (uint256 payment) {
        address payable receiver = refundParams.refundReceiver == TX_ORIGIN_REFUND_RECEIVER // solhint-disable-next-line avoid-tx-origin
            ? payable(tx.origin)
            : refundParams.refundReceiver;

        uint256 gasConsumed = startGas - gasleft() + COVERED_REFUND_PAYMENT_GAS;
        payment = min(gasConsumed, refundParams.gasLimit) * refundParams.maxFeePerGas;

        if (!Safe(refundParams.safeAddress).execTransactionFromModule(receiver, payment, "", 0)) {
            revert RefundFailure();
        }
    }

    /**  @dev Returns the refund params hash to be signed by owners.
     * @param safeAddress Safe address
     * @param nonce Safe transaction nonce
     * @param gasLimit Transaction gas limit
     * @param maxFeePerGas Maximum gas price
     * @param refundReceiver Refund recipient address
     * @return Refund params bytes
     */
    function encodeRefundParamsData(
        address safeAddress,
        uint256 nonce,
        uint120 gasLimit,
        uint120 maxFeePerGas,
        address refundReceiver
    ) public view returns (bytes memory) {
        bytes32 safeOperationHash = keccak256(
            abi.encode(REFUND_PARAMS_TYPEHASH, safeAddress, nonce, gasLimit, maxFeePerGas, refundReceiver)
        );

        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeOperationHash);
    }

    /**  @dev Returns the refund params hash to be signed by owners.
     * @param safeAddress Safe address
     * @param nonce Safe transaction nonce
     * @param gasLimit Transaction gas limit
     * @param maxFeePerGas Maximum gas price
     * @param refundReceiver Refund recipient address
     * @return Refund params hash
     */
    function getRefundParamsHash(
        address safeAddress,
        uint256 nonce,
        uint120 gasLimit,
        uint120 maxFeePerGas,
        address refundReceiver
    ) public view returns (bytes32) {
        return keccak256(encodeRefundParamsData(safeAddress, nonce, gasLimit, maxFeePerGas, refundReceiver));
    }

    /** @dev Returns the smallest of two numbers.
     * @param a First number
     * @param b Second number
     * @return Smallest of a and b
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? b : a;
    }
}
