# Gnosis Safe Module with bounded refund mechanism

> :warning: \*\*This repo contains unaudited code that is not ready for the production use.

## Description

SafeRelayBoundedRefund is a module for the Gnosis Safe that relays execTransaction call, a method for executing a transaction in the Gnosis Safe Core contract, and sends gas refund using the chain's native token. Read more in [docs](/docs/refund-module.md).

## Usage

### Install requirements with yarn:

```bash
yarn
```

### Run all tests:

```bash
yarn build
yarn test
```

### Deploy

This will deploy the contracts deterministically and verify the contracts on etherscan using [Solidity 0.8.14](https://github.com/ethereum/solidity/releases/tag/v0.8.14) by default. Read more in [docs](/docs/deployment.md).

Preparation:

- Set `MNEMONIC` in `.env`
- Set `INFURA_KEY` in `.env`

```bash
yarn deploy-all <network>
```

This will perform the following steps

```bash
yarn build
yarn hardhat --network <network> deploy
yarn hardhat --network <network> etherscan-verify
yarn hardhat --network <network> local-verify
```

#### Custom Networks

It is possible to use the `NODE_URL` env var to connect to any EVM based network via an RPC endpoint. This connection then can be used with the `custom` network.

E.g. to deploy the Safe contract suite on that network you would run `yarn deploy-all custom`.

The resulting addresses should be on all networks the same.

Note: Address will vary if contract code is changed or a different Solidity version is used.

### Verify contract

This command will use the deployment artifacts to compile the contracts and compare them to the onchain code

```bash
yarn hardhat --network <network> local-verify
```

This command will upload the contract source to Etherescan

```bash
yarn hardhat --network <network> etherscan-verify
```

## Security and Liability

All contracts are WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

## License

All smart contracts are released under LGPL-3.0
