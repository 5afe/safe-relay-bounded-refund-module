import { expect } from 'chai'
import { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { getTestSafe, getRelayModuleInstance, getTestRevertoor } from '../utils/setup'

import { getRandomAddresses, sortAddresses } from '../utils/addresses'

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

    it('emits an event when the boundary is set', async () => {
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

    it('does not allow setting the boundary twice (if not unset)', async () => {
      const { relayModule } = await setupTests()

      // Set refund boundary
      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      await expect(
        relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address])),
      ).to.be.revertedWith('BoundaryAlreadySet()')
    })

    it('allows setting up a boundary second time if the boundary was unset', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      await relayModule.updateGasBoundaries(0, 0)
      await relayModule.removeRefundReceivers([user2.address, user3.address])

      await expect(relayModule.setupRefundBoundary(8586, 10997, sortAddresses([user3.address])))
        .to.emit(relayModule, 'RefundBoundarySet')
        .withArgs(user1.address, 8586, 10997, sortAddresses([user3.address]))
    })
  })

  describe('updateGasBoundaries', () => {
    it('updates the gas boundaries for the given token', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))
      await relayModule.updateGasBoundaries(8586, 10997)

      const refundBoundary = await relayModule.safeRefundBoundaries(user1.address)
      expect(refundBoundary.maxFeePerGas).to.equal('8586')
      expect(refundBoundary.maxGasLimit).to.equal('10997')
    })
  })

  describe('addRefundReceivers', () => {
    it('adds refund receivers to the list in the boundary and increases the counter', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      let refundBoundary = await relayModule.safeRefundBoundaries(user1.address)
      expect(refundBoundary.allowedRefundReceiversCount).to.equal(2)

      const newReceiver = `0x${'42'.repeat(20)}`
      await relayModule.addRefundReceivers([newReceiver])
      refundBoundary = await relayModule.safeRefundBoundaries(user1.address)
      expect(refundBoundary.allowedRefundReceiversCount).to.equal(3)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, newReceiver)).to.eq(true)
    })

    it('does not allow adding the same owner twice', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      let refundBoundary = await relayModule.safeRefundBoundaries(user1.address)
      expect(refundBoundary.allowedRefundReceiversCount).to.equal(2)

      const newReceivers = [user2.address]
      await expect(relayModule.addRefundReceivers(newReceivers)).to.be.revertedWith('DuplicateRefundReceiver()')
    })

    it('reverts in case of uint16 receivers list overflow', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      const newReceivers = getRandomAddresses((1 << 16) + 1)
      await expect(relayModule.addRefundReceivers(newReceivers)).to.be.revertedWith(`Uint16Overflow(${newReceivers.length}, ${2 ** 16 - 1}`)
    })
  })

  describe('removeRefundReceivers', () => {
    it('removes refund receivers from the list in the boundary and decreases the counter', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      let refundBoundary = await relayModule.safeRefundBoundaries(user1.address)
      expect(refundBoundary.allowedRefundReceiversCount).to.equal(2)

      const receiverToRemove = user3.address
      await relayModule.removeRefundReceivers([receiverToRemove])
      refundBoundary = await relayModule.safeRefundBoundaries(user1.address)
      expect(refundBoundary.allowedRefundReceiversCount).to.equal(1)
      expect(await relayModule.isAllowedRefundReceiver(user1.address, receiverToRemove)).to.eq(false)
    })

    it('does not allow removing the same owner twice', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      let refundBoundary = await relayModule.safeRefundBoundaries(user1.address)
      expect(refundBoundary.allowedRefundReceiversCount).to.equal(2)

      const receiversToRemove = [user2.address, user2.address]
      await expect(relayModule.removeRefundReceivers(receiversToRemove)).to.be.revertedWith('InvalidRefundReceiver()')
    })

    it('reverts in case of uint16 receivers list overflow', async () => {
      const { relayModule } = await setupTests()

      await relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user2.address, user3.address]))

      const receiversToRemove = getRandomAddresses((1 << 16) + 1)
      await expect(relayModule.removeRefundReceivers(receiversToRemove)).to.be.revertedWith(
        `Uint16Overflow(${receiversToRemove.length}, ${2 ** 16 - 1}`,
      )
    })
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
