// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

import "hardhat/console.sol";

contract GnosisSafeMock {
    address public owner;
    address public module;

    constructor(address _module) {
        owner = msg.sender;
        module = _module;
    }

    function signatureSplit(bytes memory signature)
        internal
        pure
        returns (
            uint8 v,
            bytes32 r,
            bytes32 s
        )
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
    }

    function checkSignatures(
        bytes32 dataHash,
        bytes memory,
        bytes memory signature
    ) public view {
        uint8 v;
        bytes32 r;
        bytes32 s;
        (v, r, s) = signatureSplit(signature);
        require(
            owner == ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v, r, s),
            "Invalid signature"
        );
    }

    function execTransactionFromModule(
        address payable to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success) {
        require(module != address(0) && msg.sender == module, "GnosisSafeMock: Only the module can call this function");

        if (operation == 1) (success, ) = to.delegatecall(data);
        else (success, ) = to.call{value: value}(data);
    }

    receive() external payable {}
}
