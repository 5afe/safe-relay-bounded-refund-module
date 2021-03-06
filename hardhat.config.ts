import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-ethers'
import 'hardhat-gas-reporter'
import 'hardhat-deploy'
import 'solidity-coverage'
import dotenv from 'dotenv'
import type { HardhatUserConfig, HttpNetworkUserConfig } from 'hardhat/types'
import yargs from 'yargs/yargs'
import { getSingletonFactoryInfo } from '@gnosis.pm/safe-singleton-factory'
import { BigNumber } from '@ethersproject/bignumber'

const argv = yargs(process.argv.slice(2))
  .options({ network: { type: 'string', default: 'hardhat' } })
  .help(false)
  .version(false)
  .parseSync()

// Load environment variables.
dotenv.config()
const { NODE_URL, INFURA_KEY, MNEMONIC, ETHERSCAN_API_KEY, PK, SOLIDITY_VERSION, USE_SAFE_SINGLETON_FACTORY } = process.env

const DEFAULT_MNEMONIC = 'candy maple cake sugar pudding cream honey rich smooth crumble sweet treat'

const sharedNetworkConfig: HttpNetworkUserConfig = {}
if (PK) {
  sharedNetworkConfig.accounts = [PK]
} else {
  sharedNetworkConfig.accounts = {
    mnemonic: MNEMONIC || DEFAULT_MNEMONIC,
  }
}

if (['mainnet', 'rinkeby', 'kovan', 'goerli', 'ropsten', 'mumbai', 'polygon'].includes(argv.network) && INFURA_KEY === undefined) {
  throw new Error(`Could not find Infura key in env, unable to connect to network ${argv.network}`)
}

import './src/tasks/local_verify'
import './src/tasks/deploy_contracts'
import './src/tasks/show_codesize'

const primarySolidityVersion = SOLIDITY_VERSION || '0.8.15'

const deterministicDeployment =
  USE_SAFE_SINGLETON_FACTORY === 'true'
    ? (network: string) => {
        const info = getSingletonFactoryInfo(parseInt(network))
        if (!info) throw Error(`Singleton Factory not found for network ${network}`)
        return {
          factory: info.address,
          deployer: info.signerAddress,
          funding: BigNumber.from(info.gasLimit).mul(BigNumber.from(info.gasPrice)).toString(),
          signedTx: info.transaction,
        }
      }
    : undefined

const userConfig: HardhatUserConfig = {
  paths: {
    artifacts: 'build/artifacts',
    cache: 'build/cache',
    deploy: 'src/deploy',
    sources: 'contracts',
  },
  solidity: {
    compilers: [
      {
        version: primarySolidityVersion,
        settings: {
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
        },
      },
      { version: '0.6.12' },
      { version: '0.5.17' },
    ],
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      blockGasLimit: 200000000,
      gas: 100000000,
      gasPrice: 10000000000,
    },
    mainnet: {
      ...sharedNetworkConfig,
      url: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    },
    xdai: {
      ...sharedNetworkConfig,
      url: 'https://xdai.poanetwork.dev',
    },
    ewc: {
      ...sharedNetworkConfig,
      url: `https://rpc.energyweb.org`,
    },
    rinkeby: {
      ...sharedNetworkConfig,
      url: `https://rinkeby.infura.io/v3/${INFURA_KEY}`,
    },
    goerli: {
      ...sharedNetworkConfig,
      url: `https://rpc.goerli.mudit.blog`,
    },
    ropsten: {
      ...sharedNetworkConfig,
      url: `https://ropsten.infura.io/v3/${INFURA_KEY}`,
    },
    kovan: {
      ...sharedNetworkConfig,
      url: `https://kovan.infura.io/v3/${INFURA_KEY}`,
    },
    mumbai: {
      ...sharedNetworkConfig,
      url: `https://polygon-mumbai.infura.io/v3/${INFURA_KEY}`,
    },
    polygon: {
      ...sharedNetworkConfig,
      url: `https://polygon-mainnet.infura.io/v3/${INFURA_KEY}`,
    },
    volta: {
      ...sharedNetworkConfig,
      url: `https://volta-rpc.energyweb.org`,
    },
  },
  namedAccounts: {
    deployer: 0,
  },
  mocha: {
    timeout: 2000000,
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
}

if (NODE_URL) {
  userConfig.networks!!.custom = {
    ...sharedNetworkConfig,
    url: NODE_URL,
  }
}

export default userConfig
