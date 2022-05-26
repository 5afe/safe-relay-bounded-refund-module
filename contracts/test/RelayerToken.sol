// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

import "@rari-capital/solmate/src/tokens/ERC20.sol";

contract RelayerToken is ERC20 {
    constructor() ERC20("RelayerToken", "Relay", 18) {
        _mint(msg.sender, 1000000000000000);
    }
}
