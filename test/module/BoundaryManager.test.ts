import { AddressZero } from '@ethersproject/constants'
import { expect } from 'chai'
import { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { getTestSafe, getRelayModuleInstance, getTestRevertoor, getTestRelayerToken } from '../utils/setup'

import { CONTRACT_NATIVE_TOKEN_ADDRESS } from '../../src/utils/constants'
import { sortAddresses } from '../utils/addresses'

describe('SafeRelayBoundedRefund', async () => {
  const [user1, user2, user3] = waffle.provider.getWallets()

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

  describe('setupRefundBoundary', () => {
    it('sets refund conditions for msg.sender and token address', async () => {
      const { relayModule } = await setupTests()
      const tokenAddress = `0x${'42'.repeat(20)}`

      // Set refund boundary
      await relayModule.setupRefundBoundary(tokenAddress, 10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      const refundConditionToken = await relayModule.safeRefundBoundaries(user1.address, tokenAddress)
      const refundConditionETH = await relayModule.safeRefundBoundaries(user1.address, CONTRACT_NATIVE_TOKEN_ADDRESS)

      expect(refundConditionETH.maxFeePerGas).to.eq(0)
      expect(refundConditionETH.maxGasLimit).to.eq(0)
      expect(refundConditionETH.allowedRefundReceiversCount).to.eq(0)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, CONTRACT_NATIVE_TOKEN_ADDRESS, user2.address)).to.eq(false)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, CONTRACT_NATIVE_TOKEN_ADDRESS, user3.address)).to.eq(false)

      expect(refundConditionToken.maxFeePerGas).to.equal('10000000000')
      expect(refundConditionToken.maxGasLimit).to.equal('10000000')
      expect(refundConditionToken.allowedRefundReceiversCount).to.equal(2)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, tokenAddress, user2.address)).to.eq(true)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, tokenAddress, user3.address)).to.eq(true)
    })

    it('emits an event if the boundary was set', async () => {
      const { relayModule } = await setupTests()
      const tokenAddress = `0x${'42'.repeat(20)}`

      await expect(relayModule.setupRefundBoundary(tokenAddress, 10000000000, 10000000, sortAddresses([user2.address, user3.address])))
        .to.emit(relayModule, 'RefundBoundarySet')
        .withArgs(user1.address, tokenAddress, 10000000000, 10000000, sortAddresses([user2.address, user3.address]))
    })

    it('does not allow duplicated refund receivers', async () => {
      const { relayModule } = await setupTests()
      const tokenAddress = `0x${'42'.repeat(20)}`

      await expect(relayModule.setupRefundBoundary(tokenAddress, 10000000000, 10000000, [user2.address, user2.address])).to.be.revertedWith(
        'DuplicateRefundReceiver()',
      )
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

      await relayModule.setupRefundBoundary(CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, CONTRACT_NATIVE_TOKEN_ADDRESS, safe.address)
      expect(isAllowed).to.equal(false)
    })

    it('should return true when a boundary is set for an address and the receiver is allowlisted', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(CONTRACT_NATIVE_TOKEN_ADDRESS, 10000000000, 10000000, [user2.address])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, CONTRACT_NATIVE_TOKEN_ADDRESS, user2.address)
      expect(isAllowed).to.equal(true)
    })

    it('should return true when no allowlist is enforced', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(AddressZero, 10000000000, 10000000, [])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, AddressZero, user2.address)
      expect(isAllowed).to.equal(true)
    })
  })
})
