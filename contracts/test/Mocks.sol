// SPDX-License-Identifier: MIT
// Test-only contracts. Not deployed.
pragma solidity ^0.8.20;

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "Mock USD";
    string public symbol = "USDX";
    uint8 public decimals = 6;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address t, uint256 a) external virtual returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// USDT-style: transferFrom returns nothing.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external { allowance[msg.sender][s] = a; }
    function transferFrom(address f, address t, uint256 a) external {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a;
    }
}

/// Returns false instead of reverting.
contract FalseToken {
    function transferFrom(address, address, uint256) external pure returns (bool) { return false; }
}

contract Rejecter {
    receive() external payable { revert("no thanks"); }
}

interface IMultisend {
    function sendNative(address[] calldata, uint256[] calldata, string calldata) external payable returns (uint256);
}

/// Tries to re-enter sendNative when it receives BOT.
contract Reenterer {
    IMultisend public ms;
    constructor(address m) { ms = IMultisend(m); }
    receive() external payable {
        address[] memory to = new address[](1);
        uint256[] memory a = new uint256[](1);
        to[0] = address(this);
        a[0] = 0;
        ms.sendNative(to, a, "");
    }
}
