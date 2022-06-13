# Relay Module with a bounded refund

## Purpose

SafeRelayBoundedRefund is a module for the Gnosis Safe that relays execTransaction call, a method for executing a transaction in the Gnosis Safe Core contract, and sends gas refund using the chain's native token.
The built-in refund mechanism of the Gnosis Safe does not work well for refunds in multi-sig scenarios. For example, the refund gas price is a part of the transaction that has to be signed by the owners. Since the gas price is volatile on some networks, if the network gas price is higher than the refund gas price at the execution, the relayer doesn't have an economic motivation to pick up the transaction. Therefore, the owners must either wait for the price to decrease or regather transaction signatures with a higher gas price. This contract separates the transaction and refund parameters (Gas Price, Limit, Refund Receiver). The refund parameters have to be signed only by one owner. Safe owners can set boundaries for each param to protect from unreasonably high gas prices.

## Specification

### Relay and refund mechanism

#### Relaying `execTransaction` call

The contract expects transaction bytes for the `execTransaction` method. Calls to other methods are not allowed. The module assumes that the Safe Core contract performs all the necessary security checks for executing the transaction. The relayed call has to be successful. It is enforced to ensure that the Safe nonce is always increased, and the executor can use the refund signature only once. The contract will relay the transaction to the Gnosis Safe Core contract and send the gas refund to the refund receiver.

#### Refund boundary

The contract has a boundary for the gas parameters to protect from a potentially hacked owner that can sign a transaction with an unnecessary high gas price or a limit. The boundary is set per wallet by executing a call from the wallet contract to the module contract. The boundary has to be set to activate the relaying mechanism. The contract will only relay the transaction if the gas price is lower than the boundary.

Boundary includes these parameters:

- Max Fee Per Gas
- Max Gas Limit
- (optional) Allowed Refund Receivers. If not set, the contract will allow any address to receive the refund.

#### Refund

Refund parameters are passed to the relaying method alongside the execTransaction call bytes. The contract checks if the parameters fit into the boundary and sends the refund to the receiver after the execution.

For the refund, the contract uses refund parameters signed by one of the Safe owner. The following EIP712 type defines params:

```js
{
  EIP712Domain: [
    { type: 'uint256', name: 'chainId' },
    { type: 'address', name: 'verifyingContract' },
  ],
  // "RefundParams(address safeAddress,uint256 nonce,uint120 gasLimit,uint120 maxFeePerGas,address refundReceiver)"
  RefundParams: [
    { type: 'address', name: 'safeAddress' },
    { type: 'uint256', name: 'nonce' },
    { type: 'uint120', name: 'gasLimit' },
    { type: 'uint120', name: 'maxFeePerGas' },
    { type: 'address', name: 'refundReceiver' },
  ],
}
```

The signature is checked with the Gnosis Safe Core contract's `checkNSignatures` method:

- method code: [link](https://github.com/safe-global/safe-contracts/blob/c36bcab46578a442862d043e12a83fec41143dec/contracts/GnosisSafe.sol#L240)
- supported type of signatures: [link](https://docs.gnosis-safe.io/contracts/signatures)

### Boundary Management

#### Setting a boundary

#### Removing a boundary

#### Managing refund receivers list

```

```
