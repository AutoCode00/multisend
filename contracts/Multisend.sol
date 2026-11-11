// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BOT Multisend
/// @notice Send BOT (native) or any ERC-20 to many wallets in one transaction.
///         No fees, no stored funds: every wei/token that comes in goes straight out.
///         If any single transfer fails, the whole batch reverts.
interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract Multisend {
    uint256 public constant MAX_RECIPIENTS = 300;
    uint256 public constant MAX_NAME_BYTES = 64;

    /// @notice Number of batches sent so far (also the next batch id).
    uint256 public batches;
    /// @notice Recipients paid across all batches (native + tokens).
    uint256 public totalRecipients;
    /// @notice Total BOT (wei) sent through sendNative.
    uint256 public totalNativeSent;

    /// @notice Block each batch was mined in, so a receipt can find its log in one call.
    mapping(uint256 => uint256) public batchBlock;
    mapping(address => uint256[]) private _batchesOf;

    uint256 private _lock = 1;

    event BatchSent(
        uint256 indexed id,
        address indexed sender,
        address indexed token,
        uint256 total,
        uint256 count,
        string name
    );

    error LengthMismatch();
    error NoRecipients();
    error TooManyRecipients(uint256 count, uint256 max);
    error NameTooLong();
    error ZeroRecipient(uint256 index);
    error ValueMismatch(uint256 expected, uint256 sent);
    error NativeSendFailed(uint256 index, address to);
    error NotAToken(address token);
    error TokenTransferFailed(uint256 index, address to);
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice Send BOT to every address in `to`. msg.value must equal the sum of `amounts`.
    function sendNative(address[] calldata to, uint256[] calldata amounts, string calldata name)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        uint256 n = _checkInputs(to, amounts, name);
        uint256 total;
        for (uint256 i; i < n; ++i) total += amounts[i];
        if (msg.value != total) revert ValueMismatch(total, msg.value);

        for (uint256 i; i < n; ++i) {
            (bool ok, ) = to[i].call{value: amounts[i]}("");
            if (!ok) revert NativeSendFailed(i, to[i]);
        }

        totalNativeSent += total;
        id = _record(address(0), total, n, name);
    }

    /// @notice Send an ERC-20 from the caller to every address in `to`.
    ///         The caller must first approve this contract for exactly the sum of `amounts`.
    function sendToken(address token, address[] calldata to, uint256[] calldata amounts, string calldata name)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (token.code.length == 0) revert NotAToken(token);
        uint256 n = _checkInputs(to, amounts, name);
        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += amounts[i];
            // SafeERC20-style: the call must succeed and return nothing or `true`.
            (bool ok, bytes memory ret) =
                token.call(abi.encodeCall(IERC20Minimal.transferFrom, (msg.sender, to[i], amounts[i])));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenTransferFailed(i, to[i]);
        }
        id = _record(token, total, n, name);
    }

    /// @notice Batch ids sent by `sender`, oldest first.
    function batchesOf(address sender) external view returns (uint256[] memory) {
        return _batchesOf[sender];
    }

    /// @notice Totals for the website in one call.
    function stats() external view returns (uint256 batchCount, uint256 recipients, uint256 nativeSent) {
        return (batches, totalRecipients, totalNativeSent);
    }

    function _checkInputs(address[] calldata to, uint256[] calldata amounts, string calldata name)
        private
        pure
        returns (uint256 n)
    {
        n = to.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n == 0) revert NoRecipients();
        if (n > MAX_RECIPIENTS) revert TooManyRecipients(n, MAX_RECIPIENTS);
        if (bytes(name).length > MAX_NAME_BYTES) revert NameTooLong();
        for (uint256 i; i < n; ++i) {
            if (to[i] == address(0)) revert ZeroRecipient(i);
        }
    }

    function _record(address token, uint256 total, uint256 n, string calldata name) private returns (uint256 id) {
        id = batches++;
        totalRecipients += n;
        batchBlock[id] = block.number;
        _batchesOf[msg.sender].push(id);
        emit BatchSent(id, msg.sender, token, total, n, name);
    }
}
