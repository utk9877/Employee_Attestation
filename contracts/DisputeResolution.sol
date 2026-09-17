// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AttesterRegistry.sol";
import "./AttestationRegistry.sol";

/// @title DisputeResolution
/// @notice Decentralized jury for disputed attestations. Any staked attester other
///         than the two parties may serve as a juror. Voting uses commit-reveal
///         (commit a hash now, reveal the vote+salt later) so jurors can't see and
///         copy the emerging majority before casting their own vote. The losing
///         party is slashed / loses its bond, and jurors are rewarded or mildly
///         penalized based on whether they voted with the majority or failed to
///         reveal at all.
contract DisputeResolution is ReentrancyGuard {
    enum Outcome {
        Pending,
        Dismissed, // tie, or no juror turnout -> attestation stands, disputer's bond forfeited
        AttesterWon, // attestation upheld -> disputer's bond forfeited to attester
        DisputerWon // attestation fraudulent -> attester slashed, disputer refunded
    }

    struct Dispute {
        uint256 attestationId;
        address attester;
        address disputer;
        uint256 bond;
        uint256 commitDeadline;
        uint256 revealDeadline;
        bool resolved;
        uint256 votesForAttester;
        uint256 votesForDisputer;
    }

    uint256 public constant DISPUTE_BOND = 0.02 ether;
    uint256 public constant SLASH_AMOUNT = 0.05 ether;
    uint256 public constant COMMIT_DURATION = 1 hours;
    uint256 public constant REVEAL_DURATION = 1 hours;
    uint256 public constant REPUTATION_REWARD = 10;
    uint256 public constant REPUTATION_PENALTY = 20;
    uint256 public constant JUROR_NONREVEAL_PENALTY = 5;

    AttesterRegistry public immutable attesterRegistry;
    AttestationRegistry public immutable attestationRegistry;

    uint256 public nextDisputeId;
    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => mapping(address => bytes32)) public commitments;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;
    mapping(uint256 => mapping(address => bool)) public revealedVote;
    mapping(uint256 => address[]) internal jurors;

    event DisputeRaised(uint256 indexed disputeId, uint256 indexed attestationId, address indexed disputer, address attester);
    event VoteCommitted(uint256 indexed disputeId, address indexed juror);
    event VoteRevealed(uint256 indexed disputeId, address indexed juror, bool vote);
    event DisputeResolved(uint256 indexed disputeId, Outcome outcome, uint256 votesForAttester, uint256 votesForDisputer);

    constructor(address _attesterRegistry, address _attestationRegistry) {
        require(_attesterRegistry != address(0) && _attestationRegistry != address(0), "DisputeResolution: zero address");
        attesterRegistry = AttesterRegistry(_attesterRegistry);
        attestationRegistry = AttestationRegistry(_attestationRegistry);
    }

    function raiseDispute(uint256 attestationId) external payable returns (uint256 disputeId) {
        require(msg.value == DISPUTE_BOND, "DisputeResolution: incorrect bond");

        AttestationRegistry.Attestation memory a = attestationRegistry.getAttestation(attestationId);
        require(a.attester != address(0), "DisputeResolution: unknown attestation");
        require(a.status == AttestationRegistry.Status.Active, "DisputeResolution: attestation not active");
        require(msg.sender != a.attester, "DisputeResolution: attester cannot dispute themselves");

        disputeId = nextDisputeId++;
        disputes[disputeId] = Dispute({
            attestationId: attestationId,
            attester: a.attester,
            disputer: msg.sender,
            bond: msg.value,
            commitDeadline: block.timestamp + COMMIT_DURATION,
            revealDeadline: block.timestamp + COMMIT_DURATION + REVEAL_DURATION,
            resolved: false,
            votesForAttester: 0,
            votesForDisputer: 0
        });

        attestationRegistry.setStatus(attestationId, AttestationRegistry.Status.Disputed);

        emit DisputeRaised(disputeId, attestationId, msg.sender, a.attester);
    }

    /// @notice Commit a vote: `commitHash = keccak256(abi.encodePacked(vote, salt, msg.sender))`.
    ///         Including msg.sender prevents a juror from copying another juror's commit.
    function commitVote(uint256 disputeId, bytes32 commitHash) external {
        Dispute storage d = disputes[disputeId];
        require(d.disputer != address(0), "DisputeResolution: unknown dispute");
        require(block.timestamp <= d.commitDeadline, "DisputeResolution: commit phase over");
        require(msg.sender != d.attester && msg.sender != d.disputer, "DisputeResolution: party cannot serve as juror");
        require(attesterRegistry.isRegistered(msg.sender), "DisputeResolution: juror must be a registered attester");
        require(commitments[disputeId][msg.sender] == bytes32(0), "DisputeResolution: already committed");

        commitments[disputeId][msg.sender] = commitHash;
        jurors[disputeId].push(msg.sender);

        emit VoteCommitted(disputeId, msg.sender);
    }

    function revealVote(uint256 disputeId, bool vote, bytes32 salt) external {
        Dispute storage d = disputes[disputeId];
        require(d.disputer != address(0), "DisputeResolution: unknown dispute");
        require(block.timestamp > d.commitDeadline, "DisputeResolution: commit phase not over");
        require(block.timestamp <= d.revealDeadline, "DisputeResolution: reveal phase over");
        require(commitments[disputeId][msg.sender] != bytes32(0), "DisputeResolution: no commitment found");
        require(!hasRevealed[disputeId][msg.sender], "DisputeResolution: already revealed");

        bytes32 expected = keccak256(abi.encodePacked(vote, salt, msg.sender));
        require(expected == commitments[disputeId][msg.sender], "DisputeResolution: reveal does not match commitment");

        hasRevealed[disputeId][msg.sender] = true;
        revealedVote[disputeId][msg.sender] = vote;

        if (vote) {
            d.votesForAttester++;
        } else {
            d.votesForDisputer++;
        }

        emit VoteRevealed(disputeId, msg.sender, vote);
    }

    function resolveDispute(uint256 disputeId) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        require(d.disputer != address(0), "DisputeResolution: unknown dispute");
        require(block.timestamp > d.revealDeadline, "DisputeResolution: reveal phase not over");
        require(!d.resolved, "DisputeResolution: already resolved");
        d.resolved = true;

        Outcome outcome;
        if (d.votesForAttester == d.votesForDisputer) {
            outcome = Outcome.Dismissed;
        } else if (d.votesForAttester > d.votesForDisputer) {
            outcome = Outcome.AttesterWon;
        } else {
            outcome = Outcome.DisputerWon;
        }

        _settleParties(d, outcome);
        _settleJurors(disputeId, outcome);

        emit DisputeResolved(disputeId, outcome, d.votesForAttester, d.votesForDisputer);
    }

    function _settleParties(Dispute storage d, Outcome outcome) internal {
        if (outcome == Outcome.DisputerWon) {
            attestationRegistry.setStatus(d.attestationId, AttestationRegistry.Status.Revoked);
            attesterRegistry.slash(d.attester, SLASH_AMOUNT);
            attesterRegistry.adjustReputation(d.attester, -int256(REPUTATION_PENALTY));
            _pay(d.disputer, d.bond); // bond refunded to the vindicated disputer
        } else {
            // Dismissed (tie / no turnout) or AttesterWon: attestation stands, attester's
            // stake and reputation are untouched (or nudged up), disputer's bond is forfeit.
            attestationRegistry.setStatus(d.attestationId, AttestationRegistry.Status.Active);
            if (outcome == Outcome.AttesterWon) {
                attesterRegistry.adjustReputation(d.attester, int256(REPUTATION_REWARD));
            }
            _pay(d.attester, d.bond); // forfeited bond compensates the falsely-accused attester
        }
    }

    function _settleJurors(uint256 disputeId, Outcome outcome) internal {
        bool attesterMajority = outcome == Outcome.AttesterWon;
        bool disputerMajority = outcome == Outcome.DisputerWon;

        address[] storage jury = jurors[disputeId];
        for (uint256 i = 0; i < jury.length; i++) {
            address juror = jury[i];

            if (!hasRevealed[disputeId][juror]) {
                // Committed but never revealed: small reputation penalty discourages
                // strategic non-reveal (e.g. abstaining once the outcome looks unfavorable).
                attesterRegistry.adjustReputation(juror, -int256(JUROR_NONREVEAL_PENALTY));
                continue;
            }

            bool votedForAttester = revealedVote[disputeId][juror];
            bool votedWithMajority = (votedForAttester && attesterMajority) || (!votedForAttester && disputerMajority);

            if (votedWithMajority) {
                attesterRegistry.adjustReputation(juror, int256(REPUTATION_REWARD));
            }
            // Dissenting-but-revealed jurors and jurors in a Dismissed (tie) outcome
            // are left untouched — voting honestly is never itself punished.
        }
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "DisputeResolution: transfer failed");
    }

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    function jurorsOf(uint256 disputeId) external view returns (address[] memory) {
        return jurors[disputeId];
    }
}
