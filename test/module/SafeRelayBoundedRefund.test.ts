import { BigNumber } from 'ethers'
import { AddressZero } from '@ethersproject/constants'
import { expect } from 'chai'
import hre, { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { getTestSafe, getRelayModuleInstance, getTestRevertoor, getTestRelayerToken } from '../utils/setup'
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
import { CONTRACT_NATIVE_TOKEN_ADDRESS } from '../../src/utils/constants'

describe('SafeRelayBoundedRefund', async () => {
  const [user1, user2] = waffle.provider.getWallets()

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture()

    const relayModule = await getRelayModuleInstance()
    const safe = await getTestSafe(user1, relayModule.address)
    const revertooor = await getTestRevertoor(user1)
    const erc20 = await getTestRelayerToken(user1)

    return {
      safe,
      relayModule,
      revertooor,
      erc20,
    }
  })

  describe('getRefundParamsHash', () => {
    it('should correctly calculate EIP-712 hash of the refund params', async () => {
      const { safe, relayModule } = await setupTests()

      const refundParamsHash = await relayModule.getRefundParamsHash(safe.address, 0, AddressZero, 1000000, 1000000, user1.address)

      expect(refundParamsHash).to.eq(
        calculateRefundParamsHash(
          relayModule,
          {
            safeAddress: safe.address,
            nonce: 0,
            gasToken: AddressZero,
            maxFeePerGas: 1000000,
            gasLimit: 1000000,
            refundReceiver: user1.address,
          },
          await chainId(),
        ),
      )
    })
  })

  describe('setRefundBoundary', () => {
    it('sets refund conditions for msg.sender and token address', async () => {
      const { relayModule } = await setupTests()
      const tokenAddress = `0x${'42'.repeat(20)}`

      // Set refund boundary
      await relayModule.setRefundBoundary(tokenAddress, 10000000000, 10000000, [user2.address])

      const refundConditionToken = await relayModule.safeRefundBoundaries(user1.address, tokenAddress)
      const refundConditionETH = await relayModule.safeRefundBoundaries(user1.address, AddressZero)

      expect(refundConditionETH.maxFeePerGas).to.eq(0)
      expect(refundConditionETH.maxGasLimit).to.eq(0)
      expect(refundConditionETH.allowedRefundReceiversCount).to.eq(0)

      expect(refundConditionToken.maxFeePerGas).to.equal('10000000000')
      expect(refundConditionToken.maxGasLimit).to.equal('10000000')
      expect(refundConditionToken.allowedRefundReceiversCount).to.equal(1)
    })
  })

  describe('isAllowedRefundReceiver', () => {
    it('should return false when no boundary is set for an address', async () => {
      const { relayModule } = await setupTests()

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, AddressZero, user2.address)

      expect(isAllowed).to.equal(false)
    })

    it('should return false when a boundary is set for an address but the receiver is not allowlisted', async () => {
      const { relayModule, safe } = await setupTests()

      await relayModule.setRefundBoundary(CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, CONTRACT_NATIVE_TOKEN_ADDRESS, safe.address)
      expect(isAllowed).to.equal(false)
    })

    it('should return true when a boundary is set for an address and the receiver is allowlisted', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setRefundBoundary(CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, CONTRACT_NATIVE_TOKEN_ADDRESS, user2.address)
      expect(isAllowed).to.equal(true)
    })

    it('should return true when no allowlist is enforced', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setRefundBoundary(AddressZero, 10000000000, 10000000, [])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, AddressZero, user2.address)
      expect(isAllowed).to.equal(true)
    })
  })

  describe('relayAndRefund', () => {
    it('should revert when trying to relay method other than execTransaction', async () => {
      const { safe, relayModule } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const contractInterface = new hre.ethers.utils.Interface(['function enableModule(address module)'])
      const encodedCall = contractInterface.encodeFunctionData('enableModule', [user2.address])

      const refundParams = buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 500000, 10000000000, user1.address)
      const signedRefundParams: SignedRefundParams = {
        ...refundParams,
        signature: (await signRefundParamsTypedData(user1, relayModule, refundParams)).data,
      }

      await expect(relayModule.relayAndRefund(encodedCall, signedRefundParams)).to.be.revertedWith('InvalidMethodSignature')
    })

    it('should revert if the refund params nonce does not match the safe nonce', async () => {
      const { safe, relayModule } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const safeTransaction = buildSafeTransaction({
        to: user1.address,
        value: '1000000000000000000',
        nonce: '2',
      })

      const refundParams = buildRefundParams(safe.address, '2', CONTRACT_NATIVE_TOKEN_ADDRESS, 500000, 10000000000, user1.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        'GnosisSafeMock: Invalid signature',
      )
    })

    it('should revert if refund message signature is not present', async () => {
      const { safe, relayModule } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address]], {
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
        ...buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 500000, 10000000000, user1.address),
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
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address]], {
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
      const refundParams = buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 500000, 10000000000, user1.address)

      await expect(
        executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1, { gasLimit: 300000 }),
      ).to.be.revertedWith('NotEnoughGas')
    })

    it('should send ether refund', async () => {
      const { safe, relayModule } = await setupTests()
      const provider = hre.ethers.provider

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const transferAmountWei = parseEther('1.5')
      const maxGasRefund = BigNumber.from('10000000000').mul('120000')

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei.add(maxGasRefund) })

      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })

      const refundParams = buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 120000, 10000000000, user2.address)

      const user2BalanceBeforeTransfer = await provider.getBalance(user2.address)
      const tx = executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)

      await expect(tx).to.emit(relayModule, 'SuccessfulExecution')

      const txReceipt = await (await tx).wait(1)

      const successEvent = relayModule.interface.decodeEventLog('SuccessfulExecution', txReceipt.logs[0].data, txReceipt.logs[0].topics)
      const user2BalanceAfterTransfer = await provider.getBalance(user2.address)
      expect(user2BalanceAfterTransfer).to.be.equal(user2BalanceBeforeTransfer.add(successEvent.payment))
    })

    it('should fail if ether refund fails', async () => {
      const { safe, relayModule } = await setupTests()
      const provider = hre.ethers.provider

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )
      const transferAmountWei = parseEther('1')

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei })
      expect(await provider.getBalance(safe.address)).to.eq(transferAmountWei)

      // The safe doesnt have enough balance to cover the gas refund
      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })
      const refundParams = buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 120000, 10000000000, user2.address)
      const queueConnectedToUser2 = await relayModule.connect(user2)

      await expect(
        executeModuleTxWithSigners(safe.address, queueConnectedToUser2, safeTransaction, refundParams, user1),
      ).to.be.revertedWith('RefundFailure()')
    })

    it('should send token refund', async () => {
      const { safe, relayModule, erc20 } = await setupTests()
      const gasPrice = BigNumber.from('1000000000')
      const gasLimit = BigNumber.from('150000')
      const maxGasRefund = gasLimit.mul(gasPrice)

      await user1.sendTransaction({ to: safe.address, value: parseEther('0.1') })
      await erc20.transfer(safe.address, maxGasRefund)

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [erc20.address, 10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const safeTx = buildSafeTransaction({ to: user1.address, value: parseEther('0.1'), nonce: '1' })
      const refundParams = buildRefundParams(safe.address, '1', erc20.address, gasLimit.toString(), gasPrice.toString(), user2.address)
      expect(await erc20.balanceOf(user2.address)).to.eq(0)
      const tx = executeModuleTxWithSigners(safe.address, relayModule, safeTx, refundParams, user1)

      await expect(tx).to.emit(relayModule, 'SuccessfulExecution')
      const txReceipt = await (await tx).wait(1)
      const successEvent = relayModule.interface.decodeEventLog('SuccessfulExecution', txReceipt.logs[1].data, txReceipt.logs[1].topics)
      const user2BalanceAfterTransfer = await erc20.balanceOf(user2.address)

      expect(user2BalanceAfterTransfer).to.be.equal(successEvent.payment)
    })

    it('should fail if token transfer fails', async () => {
      const { safe, relayModule, erc20 } = await setupTests()
      const gasPrice = BigNumber.from('1000000000')
      const gasLimit = BigNumber.from('150000')

      await user1.sendTransaction({ to: safe.address, value: parseEther('0.1') })

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [erc20.address, 10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const safeTx = buildSafeTransaction({ to: user1.address, value: parseEther('0.1'), nonce: '1' })
      const refundParams = buildRefundParams(safe.address, '1', erc20.address, gasLimit, gasPrice, user2.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTx, refundParams, user1)).to.be.revertedWith('RefundFailure()')
    })

    it('should revert if the internal transaction fails', async () => {
      const { safe, relayModule, revertooor } = await setupTests()

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )
      const maxGasRefund = BigNumber.from('10000000000').mul('150000')

      await user1.sendTransaction({ to: safe.address, value: maxGasRefund })

      const refundParams = buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 150000, 10000000000, user2.address)

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
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user1.address]], {
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
      const refundParams = buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 120000, 10000000000, user2.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        'InvalidRefundReceiver()',
      )
    })

    it('should respect maxFeePerGas refund boundary', async () => {
      const { safe, relayModule } = await setupTests()
      const MAX_GASPRICE_REFUND = BigNumber.from('10000000000')

      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(
          relayModule,
          'setRefundBoundary',
          [CONTRACT_NATIVE_TOKEN_ADDRESS, MAX_GASPRICE_REFUND, 10000000, [user2.address]],
          {
            nonce: 0,
            operation: 0,
          },
        ),
      )
      const provider = hre.ethers.provider
      const transferAmountWei = parseEther('1.5')
      const OUT_OF_BOUND_GASPRICE = MAX_GASPRICE_REFUND.add(1)
      const maxRefund = OUT_OF_BOUND_GASPRICE.mul('120000')

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei.add(maxRefund) })
      expect(await provider.getBalance(safe.address)).to.eq(transferAmountWei.add(maxRefund))

      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })
      const refundParams = buildRefundParams(safe.address, '1', CONTRACT_NATIVE_TOKEN_ADDRESS, 120000, 100000000000, user2.address)

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        'RefundGasBoundariesNotMet()',
      )
    })

    it('should respect maxGasLimit refund boundary', async () => {
      const { safe, relayModule } = await setupTests()
      const provider = hre.ethers.provider

      const MAX_GAS_LIMIT = BigNumber.from('1000000')
      const transferAmountWei = parseEther('1.5')
      const maxGasRefund = BigNumber.from('10000000000').mul('120000')

      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setRefundBoundary', [CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, MAX_GAS_LIMIT, [user2.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      await user1.sendTransaction({ to: safe.address, value: transferAmountWei.add(maxGasRefund) })
      expect(await provider.getBalance(safe.address)).to.eq(transferAmountWei.add(maxGasRefund))

      const safeTransaction = buildSafeTransaction({ to: user1.address, value: transferAmountWei, nonce: '1' })
      const refundParams = buildRefundParams(
        safe.address,
        '1',
        CONTRACT_NATIVE_TOKEN_ADDRESS,
        MAX_GAS_LIMIT.add(1),
        10000000000,
        user2.address,
      )

      await expect(executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1)).to.be.revertedWith(
        'RefundGasBoundariesNotMet()',
      )
    })
  })
})
