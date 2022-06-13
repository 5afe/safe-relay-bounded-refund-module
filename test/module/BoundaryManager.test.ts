import { expect } from 'chai'
import { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { getTestSafe, getRelayModuleInstance, getTestRevertoor } from '../utils/setup'

import { sortAddresses } from '../utils/addresses'

describe('SafeRelayBoundedRefund', async () => {
  const [user1, user2, user3] = waffle.provider.getWallets()

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

  describe('setupRefundBoundary', () => {
    it('sets refund boundary for msg.sender', async () => {
      const { relayModule } = await setupTests()

      // Set refund boundary
      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      const refundBoundary = await relayModule.safeRefundBoundaries(user1.address)

      expect(refundBoundary.maxFeePerGas).to.equal('10000000000')
      expect(refundBoundary.maxGasLimit).to.equal('10000000')
      expect(refundBoundary.allowedRefundReceiversCount).to.equal(2)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, user2.address)).to.eq(true)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, user3.address)).to.eq(true)
    })

    it('emits an event if the boundary was set', async () => {
      const { relayModule } = await setupTests()

      await expect(relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address])))
        .to.emit(relayModule, 'RefundBoundarySet')
        .withArgs(user1.address, 10000000000, 10000000, sortAddresses([user2.address, user3.address]))
    })

    it('does not allow duplicated refund receivers', async () => {
      const { relayModule } = await setupTests()

      await expect(relayModule.setupRefundBoundary(10000000000, 10000000, [user2.address, user2.address])).to.be.revertedWith(
        'DuplicateRefundReceiver()',
      )
    })

    it('does not allow setting the boundary for the same token twice (if not unset)', async () => {
      const { relayModule } = await setupTests()
    })

    it('allows setting up a boundary second time if the boundary was unset', async () => {
      const { relayModule } = await setupTests()

      await expect(relayModule.setupRefundBoundary(10000000000, 10000000, [user2.address, user2.address])).to.be.revertedWith(
        'DuplicateRefundReceiver()',
      )
    })
  })

  describe('updateGasBoundaries', () => {
    it('updates the gas boundaries for the given token', async () => {})
  })

  describe('addRefundReceivers', () => {
    it('adds refund receivers to the list in the boundary and increases the counter', async () => {})

    it('does not allow duplicated addresses', async () => {})

    it('reverts in case of uint16 receivers list overflow', async () => {})
  })

  describe('removeRefundReceivers', () => {
    it('removes refund receivers from the list in the boundary and decreases the counter', async () => {})

    it('does not allow duplicated addresses', async () => {})

    it('reverts in case of uint16 receivers list overflow', async () => {})
  })

  describe('isAllowedRefundReceiver', () => {
    it('should return false when no boundary is set for an address', async () => {
      const { relayModule } = await setupTests()

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, user2.address)

      expect(isAllowed).to.equal(false)
    })

    it('should return false when a boundary is set for an address but the receiver is not allowlisted', async () => {
      const { relayModule, safe } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, [user2.address])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, safe.address)
      expect(isAllowed).to.equal(false)
    })

    it('should return true when a boundary is set for an address and the receiver is allowlisted', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, [user2.address])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, user2.address)
      expect(isAllowed).to.equal(true)
    })

    it('should return true when no allowlist is enforced', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, [])

      const isAllowed = await relayModule.isAllowedRefundReceiver(user1.address, user2.address)
      expect(isAllowed).to.equal(true)
    })
  })
})
