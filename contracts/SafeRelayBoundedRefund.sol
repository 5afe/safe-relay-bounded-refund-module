// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0 <0.9.0;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@rari-capital/solmate/src/utils/ReentrancyGuard.sol";
import "hardhat/console.sol";

/// ERRORS ///

/// @notice Thrown when the transaction reverts during the execution
error ExecutionFailure();

/// @notice Thrown when the refund receiver was not allowlisted
error InvalidRefundReceiver();

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
 * @notice SafeRelayBoundedRefund is a module for the Gnosis Safe that relays execTransaction call and pays refund to the specified address.
 *         The built-in refund mechanism of the Gnosis Safe does not work well for refunds in multi-sig scenarios. For example, the refund
 *         gas price is a part of the transaction that has to be signed by the owners. Since the gas price is volatile on some networks,
 *         if the network gas price is higher than the refund gas price at the execution, the relayer doesn't have an economic motivation
 *         to pick up the transaction. Therefore, the owners must either wait for the price to decrease or regather transaction signatures
 *         with a higher gas price. This contract separates the transaction and refund parameters (Gas Price, Gas Limit, Refund Receiver, Gas Token).
 *         The refund parameters have to be signed only by one owner. Safe owners can set boundaries for each param to protect from unreasonably high gas prices.
 */
contract SafeRelayBoundedRefund is Enum, ReentrancyGuard {
    string public constant VERSION = "0.0.1";

    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH = keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    bytes32 private constant REFUND_PARAMS_TYPEHASH =
        keccak256(
            "RefundParams(address safeAddress,uint256 nonce,address gasToken,uint120 gasLimit,uint120 maxFeePerGas,address refundReceiver)"
        );

    // keccak256(execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes))
    bytes4 private constant EXEC_TRANSACTION_SIGNATURE = 0x6a761202;

    address private constant NATIVE_TOKEN = address(0);

    event SuccessfulExecution(bytes32 relayedDataHash, uint256 payment);

    /** @dev RefundBoundary struct represents the boundary for refunds
     * @param maxFeePerGas - Maximim gas price that can be refunded, includes basefee and priority fee
     * @param maxGasLimit - Maximum gas limit for a transaction, returned is the minimum of gas spend and transaction gas limit
     * @param allowedRefundReceiversCount - Count of allowed refund receivers, we use it to track if the allowlist is enforced. Maximum 65,535 addresses
     * @param refundReceiverAllowlist - Mapping of allowed refund receivers, address -> bool
     */
    struct RefundBoundary {
        uint120 maxFeePerGas;
        uint120 maxGasLimit;
        uint16 allowedRefundReceiversCount;
        mapping(address => bool) refundReceiverAllowlist;
    }

    /** @dev RefundParams struct represents the transaction refund params. Signed params also include safe transaction nonce.
     * @param safe - Safe address to pay the refund from
     * @param gasToken - Refund gas token, 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for a native token
     * @param gasLimit - Maximum gas limit for a transaction, returned is the minimum of gas spend and transaction gas limit
     * @param maxFeePerGas - Maximim gas price that can be refunded, includes basefee and priority fee
     * @param allowedRefundReceiversCount - Count of allowed refund receivers, we use it to track if the allowlist is enforced
     * @param refundReceiverAllowlist - Capping of allowed refund receivers, address -> bool
     */
    struct RefundParams {
        address payable safeAddress;
        address gasToken;
        uint120 gasLimit;
        uint120 maxFeePerGas;
        address payable refundReceiver;
        bytes signature;
    }

    // safeAddress -> tokenAddress -> RefundBoundary
    mapping(address => mapping(address => RefundBoundary)) public safeRefundBoundaries;

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this));
    }

    /**  @dev Sets refund boundary for a given safe and gas token
     * @param tokenAddress Refund token address
     * @param maxFeePerGas Maximum gas price to refund
     * @param maxGasLimit Maximum gas limit that can be refunded
     * @param refundReceiverAllowlist Addresses of allowed refund receivers
     */
    function setRefundBoundary(
        address tokenAddress,
        uint120 maxFeePerGas,
        uint120 maxGasLimit,
        address[] calldata refundReceiverAllowlist
    ) public {
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[msg.sender][tokenAddress];
        safeRefundBoundary.maxFeePerGas = maxFeePerGas;
        safeRefundBoundary.maxGasLimit = maxGasLimit;
        safeRefundBoundary.allowedRefundReceiversCount = uint16(refundReceiverAllowlist.length);

        unchecked {
            for (uint16 i = 0; i < safeRefundBoundary.allowedRefundReceiversCount; i++)
                safeRefundBoundary.refundReceiverAllowlist[refundReceiverAllowlist[i]] = true;
        }
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
        address gasToken = transactionRefundParams.gasToken;

        bytes memory encodedRefundParamsData = encodeRefundParamsData(
            safeAddress,
            GnosisSafe(safeAddress).nonce(),
            gasToken,
            transactionRefundParams.gasLimit,
            transactionRefundParams.maxFeePerGas,
            transactionRefundParams.refundReceiver
        );
        bytes32 refundParamsHash = keccak256(encodedRefundParamsData);
        GnosisSafe(safeAddress).checkNSignatures(refundParamsHash, encodedRefundParamsData, transactionRefundParams.signature, 1);

        /*                      BOUNDARY CHECKS                      */
        RefundBoundary storage safeRefundBoundary = safeRefundBoundaries[safeAddress][gasToken];
        /*                      REFUND RECEIVER CHECK                      */
        if (!isAllowedRefundReceiver(safeAddress, gasToken, transactionRefundParams.refundReceiver)) {
            revert InvalidRefundReceiver();
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
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundParams.refundReceiver == address(0) ? payable(tx.origin) : refundParams.refundReceiver;
        // 23k as an upper bound to cover the rest of refund logic
        uint256 gasConsumed = startGas - gasleft() + 23000;
        payment = min(gasConsumed, refundParams.gasLimit) * refundParams.maxFeePerGas;

        if (refundParams.gasToken == NATIVE_TOKEN) {
            if (!execute(refundParams.safeAddress, receiver, payment, "0x")) {
                revert RefundFailure();
            }
        } else {
            // 0xa9059cbb - keccack("transfer(address,uint256)")
            bytes memory data = abi.encodeWithSelector(0xa9059cbb, receiver, payment);
            if (!execute(refundParams.safeAddress, refundParams.gasToken, 0, data)) {
                revert RefundFailure();
            }
        }
    }

    /**  @dev Returns the refund params hash to be signed by owners.
     * @param safeAddress Safe address
     * @param nonce Safe transaction nonce
     * @param gasToken Gas Token address
     * @param gasLimit Transaction gas limit
     * @param maxFeePerGas Maximum gas price
     * @param refundReceiver Refund recipient address
     * @return Refund params bytes
     */
    function encodeRefundParamsData(
        address safeAddress,
        uint256 nonce,
        address gasToken,
        uint120 gasLimit,
        uint120 maxFeePerGas,
        address refundReceiver
    ) public view returns (bytes memory) {
        bytes32 safeOperationHash = keccak256(
            abi.encode(REFUND_PARAMS_TYPEHASH, safeAddress, nonce, gasToken, gasLimit, maxFeePerGas, refundReceiver)
        );

        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeOperationHash);
    }

    /**  @dev Returns the refund params hash to be signed by owners.
     * @param safeAddress Safe address
     * @param nonce Safe transaction nonce
     * @param gasToken Gas Token address
     * @param gasLimit Transaction gas limit
     * @param maxFeePerGas Maximum gas price
     * @param refundReceiver Refund recipient address
     * @return Refund params hash
     */
    function getRefundParamsHash(
        address safeAddress,
        uint256 nonce,
        address gasToken,
        uint120 gasLimit,
        uint120 maxFeePerGas,
        address refundReceiver
    ) public view returns (bytes32) {
        return keccak256(encodeRefundParamsData(safeAddress, nonce, gasToken, gasLimit, maxFeePerGas, refundReceiver));
    }

    /** @dev Internal function to execute a transaction from the Safe
     * @param safeAddress Safe address
     * @param to Destination address of transaction
     * @param value Native token value of transaction
     * @param data Data payload of transaction
     * @return success Boolean indicating success of the transaction
     */
    function execute(
        address payable safeAddress,
        address to,
        uint256 value,
        bytes memory data
    ) internal returns (bool success) {
        success = GnosisSafe(safeAddress).execTransactionFromModule(to, value, data, Operation.Call);
    }

    /** @dev A function to check if a given address is a valid refund receiver for a given Safe and token
     * @param safeAddress Safe address
     * @param gasToken Gas Token address
     * @param refundReceiver Refund receiver address
     * @return Boolean indicating if the address is a valid refund receiver
     */
    function isAllowedRefundReceiver(
        address safeAddress,
        address gasToken,
        address refundReceiver
    ) public view returns (bool) {
        // First we check if the boundary is set by checking that maxFeePerGas is not 0
        // Then, if `allowedRefundReceiversCount` is not 0, we check if the address is in the allowlist
        return
            safeRefundBoundaries[safeAddress][gasToken].maxFeePerGas != 0 &&
            (safeRefundBoundaries[safeAddress][gasToken].allowedRefundReceiversCount == 0 ||
                safeRefundBoundaries[safeAddress][gasToken].refundReceiverAllowlist[refundReceiver]);
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
