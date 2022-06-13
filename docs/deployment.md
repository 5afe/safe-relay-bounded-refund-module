# Deployment

## Dependencies

The module uses deterministic deployment per default. Therefore the address of the contract primarily depend on the `factory`, the `bytecode` (which is generated from the source and includes meta information such as import paths), the `constructor parameters` and a `salt`.

### Factory

The factory used for the deterministic deployment is https://github.com/safe-global/safe-singleton-factory

### Contract parameter

The contract has no constructor parameters, so they will not affect the address of the contract.
