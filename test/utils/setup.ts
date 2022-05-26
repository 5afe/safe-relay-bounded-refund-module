import { AddressZero } from '@ethersproject/constants'
import hre, { deployments } from 'hardhat'
import { Signer, Contract } from 'ethers'
import solc from 'solc'

export async function getRelayModuleDeployment() {
  return await deployments.get('SafeRelayBoundedRefund')
}

export async function getRelayModuleContractFactory() {
  return await hre.ethers.getContractFactory('SafeRelayBoundedRefund')
}

export async function getRelayModuleInstance() {
  return (await getRelayModuleContractFactory()).attach((await getRelayModuleDeployment()).address)
}

export async function getRelayerTokenContract() {
  return await hre.ethers.getContractFactory('RelayerToken')
}

export async function getTestRelayerToken(deployer: Signer) {
  const tokenFactory = await getRelayerTokenContract()
  const factoryWithDeployer = tokenFactory.connect(deployer)
  const relayerToken = await factoryWithDeployer.deploy()

  return relayerToken
}

export async function getSafeAtAddress(address: string) {
  const safeMock = await hre.ethers.getContractFactory('GnosisSafeMock')

  return safeMock.attach(address)
}

export async function getTestSafe(deployer: Signer, moduleAddr?: string) {
  const safeFactory = await hre.ethers.getContractFactory('GnosisSafeMock')
  const factoryWithDeployer = safeFactory.connect(deployer)
  const safe = factoryWithDeployer.deploy(moduleAddr || AddressZero)

  return safe
}

export async function getTestRevertoor(signer: Signer) {
  const factory = await hre.ethers.getContractFactory('Revertooor')
  const factoryWithDeployer = factory.connect(signer)
  const revertooor = await factoryWithDeployer.deploy()

  return revertooor
}

export async function compile(source: string) {
  const input = JSON.stringify({
    language: 'Solidity',
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
    },
    sources: {
      'tmp.sol': {
        content: source,
      },
    },
  })
  const solcData = await solc.compile(input)
  const output = JSON.parse(solcData)
  if (!output['contracts']) {
    console.log(output)
    throw Error('Could not compile contract')
  }
  const fileOutput = output['contracts']['tmp.sol']
  const contractOutput = fileOutput[Object.keys(fileOutput)[0]]
  const abi = contractOutput['abi']
  const data = '0x' + contractOutput['evm']['bytecode']['object']
  return {
    data: data,
    interface: abi,
  }
}

export async function deployContract(deployer: Signer, source: string): Promise<Contract> {
  const output = await compile(source)
  const transaction = await deployer.sendTransaction({ data: output.data, gasLimit: 6000000 })
  const receipt = await transaction.wait()
  return new Contract(receipt.contractAddress, output.interface, deployer)
}
