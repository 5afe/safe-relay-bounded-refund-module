import { parseEther } from '@ethersproject/units'
import { AddressZero } from '@ethersproject/constants'
import { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { getTestSafe, getRelayModuleInstance, getTestRevertoor } from '../utils/setup'
import {
  buildSafeTransaction,
  buildContractCall,
  buildRefundParams,
  executeModuleTxWithSigners,
  execSafeTransaction,
} from '../../src/utils/execution'

import { logGas } from '../../src/utils/gas'
import { sortAddresses } from '../utils/addresses'

describe('RelayModuleFixedReward', async () => {
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

  describe('Log gas difference', async () => {
    it('gas consumption for setting a boundary', async () => {
      const { relayModule } = await setupTests()
      const tokenAddress = `0x${'42'.repeat(20)}`

      await logGas(
        'calling setBoundary',
        relayModule.setupRefundBoundary(10000000000, 10000000, sortAddresses([user1.address, user2.address])),
      )
    })

    it('gas consumptions without relay', async () => {
      const { safe } = await setupTests()

      await logGas(
        'executing a transaction directly',
        safe.execTransaction(user2.address, 0, '0xbaddad42', 0, 0, 0, 0, AddressZero, AddressZero, '0x'),
      )
    })

    it('gas consumptions with relay', async () => {
      const { safe, relayModule } = await setupTests()

      // Supply safe with ether
      await user2.sendTransaction({ to: safe.address, value: parseEther('0.5') })
      // Set refund boundary
      await execSafeTransaction(
        safe,
        buildContractCall(relayModule, 'setupRefundBoundary', [10000000000, 10000000, [user1.address]], {
          nonce: 0,
          operation: 0,
        }),
      )

      const safeTransaction = buildSafeTransaction({ to: user1.address, value: 0, nonce: '1', data: '0xbaddad42' })

      const refundParams = buildRefundParams(safe.address, '1', 120000, 10000000000, user1.address)

      await logGas(
        'executing a transaction via relay module',
        executeModuleTxWithSigners(safe.address, relayModule, safeTransaction, refundParams, user1),
      )
    })
  })
})

export {}
