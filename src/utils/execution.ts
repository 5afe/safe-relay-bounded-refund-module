import { getSafeAtAddress } from '../../test/utils/setup'
import { AddressZero } from '@ethersproject/constants'
import { Contract, Wallet, utils, BigNumber, BigNumberish, Signer } from 'ethers'

const EIP_DOMAIN = {
  EIP712Domain: [
    { type: 'uint256', name: 'chainId' },
    { type: 'address', name: 'verifyingContract' },
  ],
}

const EIP712_REFUND_PARAMS_TYPE = {
  // "RefundParams(address safeAddress,uint256 nonce,address gasToken,uint120 gasLimit,uint120 maxFeePerGas,address refundReceiver)"
  RefundParams: [
    { type: 'address', name: 'safeAddress' },
    { type: 'uint256', name: 'nonce' },
    { type: 'address', name: 'gasToken' },
    { type: 'uint120', name: 'gasLimit' },
    { type: 'uint120', name: 'maxFeePerGas' },
    { type: 'address', name: 'refundReceiver' },
  ],
}

interface MetaTransaction {
  to: string
  value: BigNumberish
  data: string
  operation: number
}

// The relayer doesnt care about the gasToken, gasPrice, baseGas, safeTxGas, refundReceiver
// So they're removed them from the template
interface SafeTransaction extends MetaTransaction {
  nonce: BigNumberish
}

interface RefundParams {
  safeAddress: string
  nonce: BigNumberish
  gasToken: string
  gasLimit: BigNumberish
  maxFeePerGas: BigNumberish
  refundReceiver: string
}

interface SignedRefundParams extends RefundParams {
  signature: string
}

interface SafeSignature {
  signer: string
  data: string
}

function calculateModuleDomainSeparator(module: Contract, chainId: BigNumberish): string {
  return utils._TypedDataEncoder.hashDomain({ verifyingContract: module.address, chainId })
}

function preimageRefundParamsHash(transactionQueue: Contract, refundParams: RefundParams, chainId: BigNumberish): string {
  return utils._TypedDataEncoder.encode({ verifyingContract: transactionQueue.address, chainId }, EIP712_REFUND_PARAMS_TYPE, refundParams)
}

function calculateRefundParamsHash(transactionQueue: Contract, refundParams: RefundParams, chainId: BigNumberish): string {
  return utils._TypedDataEncoder.hash({ verifyingContract: transactionQueue.address, chainId }, EIP712_REFUND_PARAMS_TYPE, refundParams)
}

async function signHash(signer: Signer, hash: string): Promise<SafeSignature> {
  const uint8hash = utils.arrayify(hash)
  const signerAddress = await signer.getAddress()
  const sig = await signer.signMessage(uint8hash)
  const v = parseInt(sig.slice(-2), 16) + 4
  const signatureWithAdjustedV = `${sig.slice(0, -2)}${v.toString(16)}`

  return {
    signer: signerAddress,
    data: signatureWithAdjustedV,
  }
}

function buildSignatureBytes(signatures: SafeSignature[]): string {
  signatures.sort((left, right) => left.signer.toLowerCase().localeCompare(right.signer.toLowerCase()))
  let signatureBytes = '0x'
  for (const sig of signatures) {
    signatureBytes += sig.data.slice(2)
  }
  return signatureBytes
}

function execSafeTransaction(safe: Contract, safeTx: SafeTransaction): Promise<string> {
  return safe.execTransaction(safeTx.to, safeTx.value, safeTx.data, safeTx.operation, 0, 0, 0, AddressZero, AddressZero, '0x')
}

function encodeSafeExecTransactionCall(safe: Contract, safeTx: SafeTransaction): string {
  const execTransactionData = safe.interface.encodeFunctionData('execTransaction', [
    safeTx.to,
    safeTx.value,
    safeTx.data,
    safeTx.operation,
    0,
    0,
    0,
    AddressZero,
    AddressZero,
    '0x',
  ])

  return execTransactionData
}

async function signRefundParamsHash(
  signer: Wallet,
  transactionQueue: Contract,
  refundParams: RefundParams,
  chainId?: BigNumberish,
): Promise<SafeSignature> {
  const cid = chainId || (await signer.provider!!.getNetwork()).chainId
  return signHash(signer, calculateRefundParamsHash(transactionQueue, refundParams, cid))
}

async function signRefundParamsTypedData(
  signer: Wallet,
  transactionQueue: Contract,
  refundParams: RefundParams,
  chainId?: BigNumberish,
): Promise<SafeSignature> {
  const cid = chainId || (await signer.provider!!.getNetwork()).chainId
  const signerAddress = await signer.getAddress()
  return {
    signer: signerAddress,
    data: await signer._signTypedData(
      { verifyingContract: transactionQueue.address, chainId: cid },
      EIP712_REFUND_PARAMS_TYPE,
      refundParams,
    ),
  }
}

function buildRefundParams(
  safeAddress: string,
  nonce: BigNumberish,
  gasToken: string,
  gasLimit: BigNumberish,
  maxFeePerGas: BigNumberish,
  refundReceiver: string,
): RefundParams {
  return {
    safeAddress,
    nonce,
    gasToken,
    gasLimit,
    maxFeePerGas,
    refundReceiver,
  }
}

function buildSafeTransaction(template: {
  to: string
  value?: BigNumberish
  data?: string
  operation?: number
  nonce: BigNumberish
}): SafeTransaction {
  return {
    to: template.to,
    value: template.value || 0,
    data: template.data || '0x',
    operation: template.operation || 0,
    nonce: template.nonce,
  }
}

function buildContractCall(
  contract: Contract,
  method: string,
  params: any[],
  transactionParams: Partial<Omit<SafeTransaction, 'data' | 'to'>>,
): SafeTransaction {
  const data = contract.interface.encodeFunctionData(method, params)
  return buildSafeTransaction({
    to: contract.address,
    value: transactionParams.value || 0,
    data,
    operation: transactionParams.operation || 0,
    nonce: transactionParams.nonce || '0',
  })
}

async function executeModuleTx(
  safeAddress: string,
  relayModule: Contract,
  safeTx: SafeTransaction,
  refundParams: SignedRefundParams,
  overrides?: any,
): Promise<any> {
  const safeContract = await getSafeAtAddress(safeAddress)
  const execTransactionData = encodeSafeExecTransactionCall(safeContract, safeTx)

  return relayModule.relayAndRefund(execTransactionData, refundParams, overrides || {})
}

async function executeModuleTxWithSigners(
  safeAddress: string,
  relayModule: Contract,
  tx: SafeTransaction,
  refundParams: RefundParams,
  refundSigner: Wallet,
  overrides?: any,
) {
  const refundParamsSignature = await signRefundParamsTypedData(refundSigner, relayModule, refundParams)
  const signedRefundParams = {
    ...refundParams,
    signature: refundParamsSignature.data,
  }

  return executeModuleTx(safeAddress, relayModule, tx, signedRefundParams, overrides)
}

async function executeModuleContractCallWithSigners(
  safeAddress: string,
  relayModule: Contract,
  contract: Contract,
  method: string,
  params: any[],
  transactionParams: Omit<SafeTransaction, 'data' | 'to'>,
  refundParams: Omit<RefundParams, 'nonce'>,
  refundSigner: Wallet,
) {
  const tx = buildContractCall(contract, method, params, transactionParams)

  const refundParamsWithNonce = { ...refundParams, nonce: transactionParams.nonce }

  return executeModuleTxWithSigners(safeAddress, relayModule, tx, refundParamsWithNonce, refundSigner)
}

export {
  RefundParams,
  SignedRefundParams,
  SafeTransaction,
  SafeSignature,
  EIP_DOMAIN,
  EIP712_REFUND_PARAMS_TYPE,
  calculateModuleDomainSeparator,
  preimageRefundParamsHash,
  calculateRefundParamsHash,
  buildSafeTransaction,
  buildRefundParams,
  signHash,
  buildSignatureBytes,
  signRefundParamsHash,
  signRefundParamsTypedData,
  buildContractCall,
  execSafeTransaction,
  executeModuleTx,
  executeModuleTxWithSigners,
  executeModuleContractCallWithSigners,
}
