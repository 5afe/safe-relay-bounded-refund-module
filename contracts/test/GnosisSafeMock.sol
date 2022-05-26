// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

import "hardhat/console.sol";

contract GnosisSafeMock {
    address public owner;
    address public module;
    uint256 public nonce;

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
        if (v > 30) {
            require(
                owner == ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v - 4, r, s),
                "GnosisSafeMock: Invalid signature"
            );
        } else {
            require(owner == ecrecover(dataHash, v, r, s), "GnosisSafeMock: Invalid signature");
        }
    }

    function checkNSignatures(
        bytes32 dataHash,
        bytes memory,
        bytes memory signature,
        uint256
    ) public view {
        uint8 v;
        bytes32 r;
        bytes32 s;
        (v, r, s) = signatureSplit(signature);
        if (v > 30) {
            require(
                owner == ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v - 4, r, s),
                "GnosisSafeMock: Invalid signature"
            );
        } else {
            require(owner == ecrecover(dataHash, v, r, s), "GnosisSafeMock: Invalid signature");
        }
    }

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory
    ) external payable returns (bool success) {
        exec(payable(to), value, data, operation);
        ++nonce;

        return true;
    }

    function exec(
        address payable to,
        uint256 value,
        bytes calldata data,
        uint256 operation
    ) public {
        bool success;
        bytes memory response;
        if (operation == 0) (success, response) = to.call{value: value}(data);
        else (success, response) = to.delegatecall(data);
        if (!success) {
            assembly {
                revert(add(response, 0x20), mload(response))
            }
        }
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

    fallback() external payable {}
}
