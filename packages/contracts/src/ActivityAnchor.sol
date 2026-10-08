// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ActivityAnchor
/// @notice Seals Grain's off-chain activity log -- the checks and forgeries
///         reported against creators' work -- so that history cannot be
///         quietly rewritten afterwards, by anyone, including Grain.
/// @dev    What a seal proves, and what it doesn't. Each seal commits to the
///         keccak256 of every event in a time window. Anyone can re-hash the
///         published log for that window and compare: if one event was added,
///         removed, edited or backdated after sealing, the hashes differ. It
///         does NOT prove each event was a real check -- that happens privately
///         in a visitor's browser and the chain cannot see it.
/// @dev    APPEND-ONLY. Windows are contiguous: each starts exactly where the
///         previous one ended, and nothing can be replaced or deleted. Only
///         the sealer can add a seal, and the sealer cannot be changed, so a
///         compromised web app cannot hand sealing to someone else.
contract ActivityAnchor {
    struct Seal {
        uint64 from; // exclusive, unix seconds
        uint64 until; // inclusive, unix seconds
        uint32 events;
        bytes32 root; // keccak256 of the window's canonical event log
    }

    address public immutable sealer;
    Seal[] private _seals;

    event Sealed(uint256 indexed index, uint64 from, uint64 until, uint32 events, bytes32 root);

    error NotSealer();
    error WindowNotAfterLastSeal(uint64 until, uint64 lastUntil);
    error WindowInFuture(uint64 until);

    /// @param sealer_ the only key that may add seals
    /// @param genesis the time the log starts; the first window begins here
    constructor(address sealer_, uint64 genesis) {
        sealer = sealer_;
        _seals.push(Seal({from: genesis, until: genesis, events: 0, root: keccak256("")}));
        emit Sealed(0, genesis, genesis, 0, keccak256(""));
    }

    /// @notice Seal every event after the last seal, up to and including `until`.
    function seal(uint64 until, uint32 events, bytes32 root) external {
        if (msg.sender != sealer) revert NotSealer();
        uint64 last = _seals[_seals.length - 1].until;
        if (until <= last) revert WindowNotAfterLastSeal(until, last);
        if (until > block.timestamp) revert WindowInFuture(until);
        _seals.push(Seal({from: last, until: until, events: events, root: root}));
        emit Sealed(_seals.length - 1, last, until, events, root);
    }

    function sealCount() external view returns (uint256) {
        return _seals.length;
    }

    function seals(uint256 index) external view returns (Seal memory) {
        return _seals[index];
    }

    /// @notice The most recent seal: how far the sealed history reaches.
    function latest() external view returns (Seal memory) {
        return _seals[_seals.length - 1];
    }
}
