import { Contract, Wallet, utils, BigNumber, BigNumberish, Signer, PopulatedTransaction } from 'ethers'
import { TypedDataSigner } from '@ethersproject/abstract-signer'
import { AddressZero } from '@ethersproject/constants'

const EIP_DOMAIN = {
  EIP712Domain: [
    { type: 'uint256', name: 'chainId' },
    { type: 'address', name: 'verifyingContract' },
  ],
}

const EIP712_SAFE_TX_TYPE = {
  // "SafeTx(address safe,address to,uint256 value,bytes data,uint8 operation,uint256 nonce)"
  SafeTx: [
    { type: 'address', name: 'safe' },
    { type: 'address', name: 'to' },
    { type: 'uint256', name: 'value' },
    { type: 'bytes', name: 'data' },
    { type: 'uint8', name: 'operation' },
    { type: 'uint256', name: 'nonce' },
  ],
}

const EIP712_RELAY_MESSAGE_TYPE = {
  // "RelayMsg(bytes32 safeTxHash,address gasToken,uint120 gasLimit,uint120 maxFeePerGas,address refundReceiver)"
  SafeMessage: [
    { type: 'bytes32', name: 'safeTxHash' },
    { type: 'address', name: 'gasToken' },
    { type: 'uint120', name: 'gasLimit' },
    { type: 'uint120', name: 'maxFeePerGas' },
    { type: 'address', name: 'refundReceiver' },
  ],
}

interface SafeTransaction {
  safe: string
  to: string
  value: BigNumberish
  data: string
  operation: number
  nonce: string
}

interface RelayMessage {
  safeTxHash: string
  gasToken: string
  gasLimit: string | number | BigNumber
  maxFeePerGas: string | number | BigNumber
  refundReceiver: string
}

interface SafeSignature {
  signer: string
  data: string
}

const calculateSafeDomainSeparator = (safe: Contract, chainId: BigNumberish): string => {
  return utils._TypedDataEncoder.hashDomain({ verifyingContract: safe.address, chainId })
}

const preimageSafeTransactionHash = (safe: Contract, safeTx: SafeTransaction, chainId: BigNumberish): string => {
  return utils._TypedDataEncoder.encode({ verifyingContract: safe.address, chainId }, EIP712_SAFE_TX_TYPE, safeTx)
}

const calculateSafeTransactionHash = (transactionQueue: Contract, safeTx: SafeTransaction, chainId: BigNumberish): string => {
  return utils._TypedDataEncoder.hash({ verifyingContract: transactionQueue.address, chainId }, EIP712_SAFE_TX_TYPE, safeTx)
}

const calculateRelayMessageHash = (transactionQueue: Contract, relayMessage: RelayMessage, chainId: BigNumberish): string => {
  return utils._TypedDataEncoder.hash({ verifyingContract: transactionQueue.address, chainId }, EIP712_RELAY_MESSAGE_TYPE, relayMessage)
}

const safeApproveHash = async (
  signer: Signer,
  safe: Contract,
  safeTx: SafeTransaction,
  skipOnChainApproval?: boolean,
): Promise<SafeSignature> => {
  if (!skipOnChainApproval) {
    if (!signer.provider) throw Error('Provider required for on-chain approval')
    const chainId = (await signer.provider.getNetwork()).chainId
    const typedDataHash = utils.arrayify(calculateSafeTransactionHash(safe, safeTx, chainId))
    const signerSafe = safe.connect(signer)
    await signerSafe.approveHash(typedDataHash)
  }
  const signerAddress = await signer.getAddress()
  return {
    signer: signerAddress,
    data: '0x000000000000000000000000' + signerAddress.slice(2) + '0000000000000000000000000000000000000000000000000000000000000000' + '01',
  }
}

const safeSignTypedData = async (
  signer: Signer & TypedDataSigner,
  safe: Contract,
  safeTx: SafeTransaction,
  chainId?: BigNumberish,
): Promise<SafeSignature> => {
  if (!chainId && !signer.provider) throw Error('Provider required to retrieve chainId')
  const cid = chainId || (await signer.provider!!.getNetwork()).chainId
  const signerAddress = await signer.getAddress()
  return {
    signer: signerAddress,
    data: await signer._signTypedData({ verifyingContract: safe.address, chainId: cid }, EIP712_SAFE_TX_TYPE, safeTx),
  }
}

const signHash = async (signer: Signer, hash: string): Promise<SafeSignature> => {
  const typedDataHash = utils.arrayify(hash)
  const signerAddress = await signer.getAddress()
  return {
    signer: signerAddress,
    data: await signer.signMessage(typedDataHash),
  }
}

const safeSignMessage = async (signer: Signer, safe: Contract, safeTx: SafeTransaction, chainId?: BigNumberish): Promise<SafeSignature> => {
  const cid = chainId || (await signer.provider!!.getNetwork()).chainId
  return signHash(signer, calculateSafeTransactionHash(safe, safeTx, cid))
}

const buildSignatureBytes = (signatures: SafeSignature[]): string => {
  signatures.sort((left, right) => left.signer.toLowerCase().localeCompare(right.signer.toLowerCase()))
  let signatureBytes = '0x'
  for (const sig of signatures) {
    signatureBytes += sig.data.slice(2)
  }
  return signatureBytes
}

const logGas = async (message: string, tx: Promise<any>, skip?: boolean): Promise<any> => {
  return tx.then(async (result) => {
    const receipt = await result.wait()
    if (!skip) console.log('           Used', receipt.gasUsed.toNumber(), `gas for >${message}<`)
    return result
  })
}

const buildSafeTransaction = (
  safe: string,
  to: string,
  value: BigNumberish,
  data: string,
  operation: number,
  nonce: string,
): SafeTransaction => ({
  safe,
  to,
  value,
  data,
  operation,
  nonce,
})

const executeTx = async (
  transactionQueue: Contract,
  safeTx: SafeTransaction,
  signatures: SafeSignature[],
  overrides?: any,
): Promise<any> => {
  const signatureBytes = buildSignatureBytes(signatures)
  return transactionQueue.execTransaction(
    {
      safe: safeTx.safe,
      to: safeTx.to,
      value: safeTx.value,
      data: safeTx.data,
      operation: safeTx.operation,
    },
    signatureBytes,
    overrides || {},
  )
}

const buildContractCall = (
  contract: Contract,
  method: string,
  params: any[],
  transactionParams: Omit<SafeTransaction, 'data'>,
): SafeTransaction => {
  const data = contract.interface.encodeFunctionData(method, params)
  return buildSafeTransaction(
    transactionParams.safe,
    contract.address,
    transactionParams.value,
    data,
    transactionParams.operation,
    transactionParams.nonce,
  )
}

const executeTxWithSigners = async (safe: Contract, tx: SafeTransaction, signers: Wallet[], overrides?: any) => {
  const sigs = await Promise.all(signers.map((signer) => safeSignTypedData(signer, safe, tx)))
  return executeTx(safe, tx, sigs, overrides)
}

const executeContractCallWithSigners = async (
  safe: Contract,
  contract: Contract,
  method: string,
  params: any[],
  signers: Wallet[],
  delegateCall?: boolean,
  overrides?: Partial<SafeTransaction>,
) => {
  const tx = buildContractCall(contract, method, params, await safe.nonce(), delegateCall, overrides)
  return executeTxWithSigners(safe, tx, signers)
}

export {
  RelayMessage,
  SafeTransaction,
  SafeSignature,
  EIP_DOMAIN,
  EIP712_SAFE_TX_TYPE,
  EIP712_RELAY_MESSAGE_TYPE,
  calculateSafeDomainSeparator,
  preimageSafeTransactionHash,
  calculateSafeTransactionHash,
  calculateRelayMessageHash,
  buildSafeTransaction,
  safeApproveHash,
  safeSignTypedData,
  signHash,
  safeSignMessage,
  buildSignatureBytes,
  logGas,
  executeTx,
  buildContractCall,
  executeTxWithSigners,
  executeContractCallWithSigners,
}
