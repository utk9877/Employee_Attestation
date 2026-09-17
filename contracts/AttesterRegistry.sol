// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AttesterRegistry
/// @notice Employers stake collateral to become "Attesters" who can issue employment
///         attestations elsewhere in the VeriRef system. Staking creates economic
///         accountability: a slashing-authorized contract (DisputeResolution) can
///         punish attesters found to have issued fraudulent attestations.
contract AttesterRegistry is Ownable, ReentrancyGuard {
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant STARTING_REPUTATION = 100;

    struct Attester {
        uint256 stake;
        uint256 reputation;
        bool registered;
    }

    mapping(address => Attester) public attesters;

    /// @notice The only contract allowed to slash stake / adjust reputation
    ///         (set once DisputeResolution is deployed).
    address public slasher;

    event AttesterRegistered(address indexed attester, uint256 stake);
    event StakeAdded(address indexed attester, uint256 amount, uint256 newStake);
    event StakeWithdrawn(address indexed attester, uint256 amount, uint256 newStake);
    event AttesterDeregistered(address indexed attester);
    event AttesterSlashed(address indexed attester, uint256 amount, uint256 newStake);
    event ReputationChanged(address indexed attester, int256 delta, uint256 newReputation);
    event SlasherUpdated(address indexed newSlasher);

    modifier onlySlasher() {
        require(msg.sender == slasher, "AttesterRegistry: caller is not the slasher");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /// @notice One-time wiring of the DisputeResolution contract address after deployment.
    function setSlasher(address _slasher) external onlyOwner {
        require(_slasher != address(0), "AttesterRegistry: zero address");
        slasher = _slasher;
        emit SlasherUpdated(_slasher);
    }

    function registerAttester() external payable {
        require(!attesters[msg.sender].registered, "AttesterRegistry: already registered");
        require(msg.value >= MIN_STAKE, "AttesterRegistry: stake below minimum");

        attesters[msg.sender] = Attester({
            stake: msg.value,
            reputation: STARTING_REPUTATION,
            registered: true
        });

        emit AttesterRegistered(msg.sender, msg.value);
    }

    function addStake() external payable {
        require(attesters[msg.sender].registered, "AttesterRegistry: not registered");
        require(msg.value > 0, "AttesterRegistry: zero stake");

        attesters[msg.sender].stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, attesters[msg.sender].stake);
    }

    /// @notice Withdraw stake. Either a partial withdrawal that keeps the attester
    ///         above MIN_STAKE, or a full withdrawal that also deregisters them.
    function withdrawStake(uint256 amount) external nonReentrant {
        Attester storage a = attesters[msg.sender];
        require(a.registered, "AttesterRegistry: not registered");
        require(amount > 0 && amount <= a.stake, "AttesterRegistry: invalid amount");

        uint256 remaining = a.stake - amount;
        require(
            remaining == 0 || remaining >= MIN_STAKE,
            "AttesterRegistry: remaining stake below minimum, withdraw full stake instead"
        );

        a.stake = remaining;
        if (remaining == 0) {
            a.registered = false;
            emit AttesterDeregistered(msg.sender);
        }

        emit StakeWithdrawn(msg.sender, amount, remaining);

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "AttesterRegistry: transfer failed");
    }

    /// @notice Called only by DisputeResolution when an attester loses a dispute.
    function slash(address attester, uint256 amount) external onlySlasher nonReentrant {
        Attester storage a = attesters[attester];
        require(a.registered, "AttesterRegistry: not registered");

        uint256 slashed = amount > a.stake ? a.stake : amount;
        a.stake -= slashed;

        if (a.stake < MIN_STAKE) {
            a.registered = false;
            emit AttesterDeregistered(attester);
        }

        emit AttesterSlashed(attester, slashed, a.stake);

        // Slashed funds are burned (sent to address(0) is disallowed for ETH transfer,
        // so they're sent to the contract owner as a protocol treasury stand-in).
        (bool ok, ) = owner().call{value: slashed}("");
        require(ok, "AttesterRegistry: slash transfer failed");
    }

    /// @notice Called only by DisputeResolution to reward/punish reputation after a dispute.
    function adjustReputation(address attester, int256 delta) external onlySlasher {
        Attester storage a = attesters[attester];
        require(a.registered || delta < 0, "AttesterRegistry: not registered");

        if (delta >= 0) {
            a.reputation += uint256(delta);
        } else {
            uint256 dec = uint256(-delta);
            a.reputation = dec >= a.reputation ? 0 : a.reputation - dec;
        }

        emit ReputationChanged(attester, delta, a.reputation);
    }

    function isRegistered(address attester) external view returns (bool) {
        return attesters[attester].registered;
    }

    function stakeOf(address attester) external view returns (uint256) {
        return attesters[attester].stake;
    }

    function reputationOf(address attester) external view returns (uint256) {
        return attesters[attester].reputation;
    }
}
