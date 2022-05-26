// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

contract Revertooor {
    function setStorage() public pure {
        require(false, "Revert me!");
    }
}
