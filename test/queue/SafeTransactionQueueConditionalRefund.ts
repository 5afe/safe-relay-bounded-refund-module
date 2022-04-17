import { BigNumber } from 'ethers'
import { AddressZero } from '@ethersproject/constants'
import { expect } from 'chai'
import hre, { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { deployContract, getTestSafe, getTransactionQueueInstance } from '../utils/setup'
import { buildSignatureBytes, calculateSafeTransactionHash, buildSafeTransaction } from '../../src/utils/execution'
import { parseEther } from '@ethersproject/units'
import { chainId } from '../utils/encoding'

describe('SafeTransactionQueueConditionalRefund', async () => {
  const [user1, user2] = waffle.provider.getWallets()

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture()

    const transactionQueueInstance = await getTransactionQueueInstance()
    const safe = await getTestSafe(user1, undefined, transactionQueueInstance.address)

    const setterSource = `
        contract StorageSetter {
            function setStorage(bytes3 data) public {
                bytes32 slot = 0x7373737373737373737373737373737373737373737373737373737373737373;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    sstore(slot, data)
                }
            }
        }`
    const storageSetter = await deployContract(user1, setterSource)

    return {
      safe,
      transactionQueueInstance,
      storageSetter,
    }
  })

  describe('getTransactionHash', () => {
    it('should correctly calculate EIP-712 hash of the transaction', async () => {
      const { safe, transactionQueueInstance } = await setupTests()

      const safeTransaction = buildSafeTransaction(safe.address, user1.address, 1_000_000_000_000_000_000, '0x', 0, '0')
      const transactionHash = transactionQueueInstance.getTransactionHash()

      expect(transactionHash).to.eq(calculateSafeTransactionHash(transactionQueueInstance, safeTransaction, await chainId()))
    })
  })

  describe('getRelayMessageHash', () => {
    it('should correctly calculate EIP-712 hash of the relay message', async () => {})
  })

  describe('execTransaction', () => {
    it('should revert if signature data is not present', async () => {})

    it('should revert if signatures are invalid', async () => {})

    it("should revert if the transaction nonce doesn't match current safe nonce", async () => {})

    it('should increase the nonce', async () => {})
  })

  describe('execTransactionWithRefund', () => {
    it('should revert if signature data is not present', async () => {})

    it('should revert if signatures are invalid', async () => {})

    it("should revert if the transaction nonce doesn't match current safe nonce", async () => {})

    it('should increase the nonce', async () => {})

    it('should execute native token transfers', async () => {})

    it('should execute contract calls', async () => {})

    it('should send ether refund', async () => {})

    it('should send token refund', async () => {})
  })
})
