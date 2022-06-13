import { BigNumber } from 'ethers'
import { AddressZero } from '@ethersproject/constants'
import { expect } from 'chai'
import hre, { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { getTestSafe, getRelayModuleInstance, getTestRevertoor } from '../utils/setup'
import {
  buildSafeTransaction,
  buildContractCall,
  calculateRefundParamsHash,
  signRefundParamsTypedData,
  executeModuleTx,
  buildRefundParams,
  executeModuleTxWithSigners,
  executeModuleContractCallWithSigners,
  execSafeTransaction,
  SignedRefundParams,
} from '../../src/utils/execution'
import { parseEther } from '@ethersproject/units'
import { chainId } from '../utils/encoding'

describe('SafeRelayBoundedRefund', async () => {
  const [user1, user2] = waffle.provider.getWallets()

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture()

    const relayModule = await getRelayModuleInstance()
    const safe = await getTestSafe(user1, relayModule.address)
    const revertooor = await getTestRevertoor(user1)

    return {
      safe,
      relayModule,
      revertooor,
    }
  })

  describe('getRefundParamsHash', () => {
    it('should correctly calculate EIP-712 hash of the refund params', async () => {
      const { safe, relayModule } = await setupTests()

      const refundParamsHash = await relayModule.getRefundParamsHash(safe.address, 0, 1000000, 1000000, user1.address)

      expect(refundParamsHash).to.eq(
        calculateRefundParamsHash(
          relayModule,
          {
            safeAddress: safe.address,
            nonce: 0,
            maxFeePerGas: 1000000,
            gasLimit: 1000000,
            refundReceiver: user1.address,
          },
          await chainId(),
        ),
      )
    })
  })

  describe('relayAndRefund', () => {
    it('should revert when trying to relay method other than execTransaction', async () => {
      const { safe, relayModule } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const contractInterface = new hre.ethers.utils.Interface(['function enableModule(address module)'])
      const encodedCall = contractInterface.encodeFunctionData('enableModule', [user2.address])

      const refundParams = buildRefundParams(safe.address, '1', 500000, 10000000000, user1.address)
      const signedRefundParams: SignedRefundParams = {
        ...refundParams,
        signature: (await signRefundParamsTypedData(user1, relayModule, refundParams)).data,
      }

      const EXEC_TRANSACTION_SIG = '0x6a761202'
      await expect(relayModule.relayAndRefund(encodedCall, signedRefundParams)).to.be.revertedWith(
        `InvalidMethodSignature("${encodedCall.slice(0, 10)}", "${EXEC_TRANSACTION_SIG}")`,
      )
    })

    it('should revert if the refund params nonce does not match the safe nonce', async () => {
      const { safe, relayModule } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const safeTransaction = buildSafeTransaction({
        to: user1.address,
        value: '1000000000000000000',
        nonce: '2',
      })

      const refundParams = buildRefundParams(safe.address, '2', 500000, 10000000000, user1.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        'GnosisSafeMock: Invalid signature',
      )
    })

    it('should revert if refund message signature is not present', async () => {
      const { safe, relayModule } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const safeTransaction = buildSafeTransaction({
        to: user1.address,
        value: '1000000000000000000',
        nonce: '1',
      })

      const refundParams = {
        ...buildRefundParams(safe.address, '1', 500000, 10000000000, user1.address),
        signature: '0x',
      }

      await expect(executeModuleTx(safe.address, relayModule, safeTransaction, refundParams)).to.be.revertedWith(
        'GnosisSafeMock: Invalid signature',
      )
    })

    it('should revert if supplied gas is less than signed gas limit', async () => {
      const { safe, relayModule } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      await user1.sendTransaction({ to: safe.address, value: parseEther('1.5') })

      const safeTransaction = buildSafeTransaction({
        to: user1.address,
        value: '1000000000000000000',
        nonce: '1',
      })
      const refundParams = buildRefundParams(safe.address, '1', 500000, 10000000000, user1.address)

      await expect(
        executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1, { gasLimit: 300000 }),
      ).to.be.revertedWith('NotEnoughGas')
    })

    it('should send native token refund', async () => {
      const { safe, relayModule } = await setupTests()
      const provider = hre.ethers.provider

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const transferAmountWei = parseEther('1.5')
      const maxGasRefund = BigNumber.from('10000000000').mul('120000')

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei.add(maxGasRefund) })

      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })

      const refundParams = buildRefundParams(safe.address, '1', 120000, 10000000000, user2.address)

      const user2BalanceBeforeTransfer = await provider.getBalance(user2.address)
      const tx = executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)

      await expect(tx).to.emit(relayModule, 'SuccessfulExecution')

      const txReceipt = await (await tx).wait(1)

      const successEvent = relayModule.interface.decodeEventLog('SuccessfulExecution', txReceipt.logs[0].data, txReceipt.logs[0].topics)
      const user2BalanceAfterTransfer = await provider.getBalance(user2.address)
      expect(user2BalanceAfterTransfer).to.be.equal(user2BalanceBeforeTransfer.add(successEvent.payment))
    })

    it('should fail if native token refund fails', async () => {
      const { safe, relayModule } = await setupTests()
      const provider = hre.ethers.provider

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )
      const transferAmountWei = parseEther('1')

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei })
      expect(await provider.getBalance(safe.address)).to.eq(transferAmountWei)

      // The safe doesnt have enough balance to cover the gas refund
      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })
      const refundParams = buildRefundParams(safe.address, '1', 120000, 10000000000, user2.address)
      const queueConnectedToUser2 = await relayModule.connect(user2)

      await expect(
        executeModuleTxWithSigners(safe.address, queueConnectedToUser2, safeTransaction, refundParams, user1),
      ).to.be.revertedWith('RefundFailure()')
    })

    it('should revert if the relayed call fails', async () => {
      const { safe, relayModule, revertooor } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )
      const maxGasRefund = BigNumber.from('10000000000').mul('150000')

      await user1.sendTransaction({ to: safe.address, value: maxGasRefund })

      const refundParams = buildRefundParams(safe.address, '1', 150000, 10000000000, user2.address)

      await expect(
        executeModuleContractCallWithSigners(
          safe.address,
          relayModule,
          revertooor,
          'setStorage',
          [],
          {
            nonce: '1',
            value: '0',
            operation: 0,
          },
          refundParams,
          user1,
        ),
      ).to.be.revertedWith('ExecutionFailure()')
    })

    it('should respect the refund receiver allowlist', async () => {
      const { safe, relayModule } = await setupTests()
      const provider = hre.ethers.provider

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user1.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const transferAmountWei = parseEther('1.5')
      const maxGasRefund = BigNumber.from('10000000000').mul('120000')

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei.add(maxGasRefund) })
      expect(await provider.getBalance(safe.address)).to.eq(transferAmountWei.add(maxGasRefund))

      const safeTransaction = buildSafeTransaction({
        to: user1.address,
        value: transferAmountWei,
        nonce: '1',
      })
      const refundParams = buildRefundParams(safe.address, '1', 120000, 10000000000, user2.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        'RefundReceiverNotAllowed()',
      )
    })

    it('should respect maxFeePerGas refund boundary', async () => {
      const { safe, relayModule } = await setupTests()
      const MAX_GASPRICE_REFUND = BigNumber.from('10000000000')
      const MAX_GAS_LIMIT = 10000000

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [MAX_GASPRICE_REFUND, MAX_GAS_LIMIT, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )
      const provider = hre.ethers.provider
      const transferAmountWei = parseEther('1.5')
      const OUT_OF_BOUND_GASPRICE = MAX_GASPRICE_REFUND.add(1)
      const TX_GAS_LIMIT = 120000
      const maxRefund = OUT_OF_BOUND_GASPRICE.mul(TX_GAS_LIMIT)

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei.add(maxRefund) })
      expect(await provider.getBalance(safe.address)).to.eq(transferAmountWei.add(maxRefund))

      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })
      const refundParams = buildRefundParams(safe.address, '1', TX_GAS_LIMIT, OUT_OF_BOUND_GASPRICE, user2.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        `RefundGasBoundariesNotMet(${TX_GAS_LIMIT}, ${OUT_OF_BOUND_GASPRICE}, ${MAX_GAS_LIMIT}, ${MAX_GASPRICE_REFUND})`,
      )
    })

    it('should respect maxGasLimit refund boundary', async () => {
      const { safe, relayModule } = await setupTests()
      const provider = hre.ethers.provider

      const MAX_GAS_LIMIT = BigNumber.from('1000000')
      const transferAmountWei = parseEther('1.5')
      const maxGasRefund = BigNumber.from('10000000000').mul('120000')
      const GAS_PRICE = 10000000000

      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [GAS_PRICE, MAX_GAS_LIMIT, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei.add(maxGasRefund) })
      expect(await provider.getBalance(safe.address)).to.eq(transferAmountWei.add(maxGasRefund))

      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })
      const refundParams = buildRefundParams(safe.address, '1', MAX_GAS_LIMIT.add(1), GAS_PRICE, user2.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        `RefundGasBoundariesNotMet(${MAX_GAS_LIMIT.add(1)}, ${GAS_PRICE}, ${MAX_GAS_LIMIT}, ${GAS_PRICE})`,
      )
    })
  })
})
