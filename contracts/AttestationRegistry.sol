// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./AttesterRegistry.sol";

/// @title AttestationRegistry
/// @notice Anchors employment attestations as Merkle roots. The full credential
///         (employer, role, dates, rating, ...) never touches the chain — only a
///         commitment to it does. Holders later prove individual fields via
///         Merkle proofs without revealing the rest of the record (see
///         verifyDisclosure). Only addresses registered in AttesterRegistry may
///         issue attestations, and the attester must have signed the root
///         themselves, so an attestation can always be tied back to a staked,
///         accountable identity.
contract AttestationRegistry {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    enum Status {
        Active,
        Disputed,
        Revoked
    }

    struct Attestation {
        address attester;
        address subject; // the employee this attestation is about
        bytes32 merkleRoot; // root over the individual credential fields
        bytes signature; // attester's signature over merkleRoot
        uint256 issuedAt;
        Status status;
    }

    AttesterRegistry public immutable attesterRegistry;

    /// @notice Only DisputeResolution may flip status between Active/Disputed/Revoked.
    address public disputeResolver;
    address public immutable deployer;

    uint256 public nextAttestationId;
    mapping(uint256 => Attestation) public attestations;

    event AttestationIssued(
        uint256 indexed attestationId,
        address indexed attester,
        address indexed subject,
        bytes32 merkleRoot
    );
    event AttestationStatusChanged(uint256 indexed attestationId, Status newStatus);
    event DisputeResolverUpdated(address indexed newResolver);

    modifier onlyDisputeResolver() {
        require(msg.sender == disputeResolver, "AttestationRegistry: caller is not the dispute resolver");
        _;
    }

    constructor(address _attesterRegistry) {
        require(_attesterRegistry != address(0), "AttestationRegistry: zero address");
        attesterRegistry = AttesterRegistry(_attesterRegistry);
        deployer = msg.sender;
    }

    /// @notice One-time wiring of the DisputeResolution contract after deployment.
    function setDisputeResolver(address _resolver) external {
        require(msg.sender == deployer, "AttestationRegistry: only deployer");
        require(_resolver != address(0), "AttestationRegistry: zero address");
        disputeResolver = _resolver;
        emit DisputeResolverUpdated(_resolver);
    }

    /// @notice Issue a new attestation. `signature` must be the attester's ECDSA
    ///         signature over the EIP-191-prefixed `merkleRoot`, proving the
    ///         registered attester (not merely whoever sent the tx) authored it.
    function issueAttestation(
        address subject,
        bytes32 merkleRoot,
        bytes calldata signature
    ) external returns (uint256 attestationId) {
        require(attesterRegistry.isRegistered(msg.sender), "AttestationRegistry: attester not registered");
        require(subject != address(0), "AttestationRegistry: zero subject");

        address recovered = merkleRoot.toEthSignedMessageHash().recover(signature);
        require(recovered == msg.sender, "AttestationRegistry: signature does not match attester");

        attestationId = nextAttestationId++;
        attestations[attestationId] = Attestation({
            attester: msg.sender,
            subject: subject,
            merkleRoot: merkleRoot,
            signature: signature,
            issuedAt: block.timestamp,
            status: Status.Active
        });

        emit AttestationIssued(attestationId, msg.sender, subject, merkleRoot);
    }

    /// @notice Verify a selective-disclosure proof: does `leaf` belong to the
    ///         Merkle tree committed to by this attestation? The verifier learns
    ///         nothing about any other field in the underlying credential.
    function verifyDisclosure(
        uint256 attestationId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        Attestation storage a = attestations[attestationId];
        require(a.attester != address(0), "AttestationRegistry: unknown attestation");
        return MerkleProof.verify(proof, a.merkleRoot, leaf);
    }

    function setStatus(uint256 attestationId, Status newStatus) external onlyDisputeResolver {
        Attestation storage a = attestations[attestationId];
        require(a.attester != address(0), "AttestationRegistry: unknown attestation");
        a.status = newStatus;
        emit AttestationStatusChanged(attestationId, newStatus);
    }

    function getAttestation(uint256 attestationId) external view returns (Attestation memory) {
        return attestations[attestationId];
    }
}
