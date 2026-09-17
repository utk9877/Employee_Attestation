// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./AttesterRegistry.sol";

/// @title AttestationRegistry
/// @notice Anchors employment attestations as Merkle roots with full credential
///         lifecycle management (issuance, optional expiry, voluntary employer
///         revocation, on-chain encrypted vaulting, and query indexing).
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
        uint256 validUntil; // 0 = never expires, otherwise unix timestamp
        bool revokedByAttester;
        string revocationReason;
    }

    AttesterRegistry public immutable attesterRegistry;

    /// @notice Only DisputeResolution may flip status between Active/Disputed/Revoked.
    address public disputeResolver;
    address public immutable deployer;

    uint256 public nextAttestationId;
    mapping(uint256 => Attestation) public attestations;

    // Fast query indexes for subject and attester portfolios
    mapping(address => uint256[]) private _subjectAttestations;
    mapping(address => uint256[]) private _attesterAttestations;

    event AttestationIssued(
        uint256 indexed attestationId,
        address indexed attester,
        address indexed subject,
        bytes32 merkleRoot
    );
    event AttestationStatusChanged(uint256 indexed attestationId, Status newStatus);
    event AttestationRevokedByAttester(uint256 indexed attestationId, address indexed attester, string reason);
    event CredentialVaulted(
        uint256 indexed attestationId,
        address indexed subject,
        address indexed attester,
        string encryptedPayload
    );
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

    /// @notice Backward-compatible issuance without explicit expiry or vault payload.
    function issueAttestation(
        address subject,
        bytes32 merkleRoot,
        bytes calldata signature
    ) external returns (uint256 attestationId) {
        return _issueAttestation(subject, merkleRoot, signature, 0, "");
    }

    /// @notice Full lifecycle issuance with optional expiration timestamp and encrypted vault payload.
    function issueAttestationWithLifecycle(
        address subject,
        bytes32 merkleRoot,
        bytes calldata signature,
        uint256 validUntil,
        string calldata encryptedPayload
    ) external returns (uint256 attestationId) {
        return _issueAttestation(subject, merkleRoot, signature, validUntil, encryptedPayload);
    }

    function _issueAttestation(
        address subject,
        bytes32 merkleRoot,
        bytes calldata signature,
        uint256 validUntil,
        string memory encryptedPayload
    ) internal returns (uint256 attestationId) {
        require(attesterRegistry.isRegistered(msg.sender), "AttestationRegistry: attester not registered");
        require(subject != address(0), "AttestationRegistry: zero subject");
        if (validUntil > 0) {
            require(validUntil > block.timestamp, "AttestationRegistry: expiry must be in the future");
        }

        address recovered = merkleRoot.toEthSignedMessageHash().recover(signature);
        require(recovered == msg.sender, "AttestationRegistry: signature does not match attester");

        attestationId = nextAttestationId++;
        attestations[attestationId] = Attestation({
            attester: msg.sender,
            subject: subject,
            merkleRoot: merkleRoot,
            signature: signature,
            issuedAt: block.timestamp,
            status: Status.Active,
            validUntil: validUntil,
            revokedByAttester: false,
            revocationReason: ""
        });

        _subjectAttestations[subject].push(attestationId);
        _attesterAttestations[msg.sender].push(attestationId);

        emit AttestationIssued(attestationId, msg.sender, subject, merkleRoot);

        if (bytes(encryptedPayload).length > 0) {
            emit CredentialVaulted(attestationId, subject, msg.sender, encryptedPayload);
        }
    }

    /// @notice Voluntary revocation by the issuing employer.
    function revokeAttestation(uint256 attestationId, string calldata reason) external {
        Attestation storage a = attestations[attestationId];
        require(a.attester != address(0), "AttestationRegistry: unknown attestation");
        require(msg.sender == a.attester, "AttestationRegistry: only issuing attester can revoke");
        require(a.status == Status.Active, "AttestationRegistry: attestation not active");
        require(!a.revokedByAttester, "AttestationRegistry: already revoked");

        a.revokedByAttester = true;
        a.revocationReason = reason;
        a.status = Status.Revoked;

        emit AttestationRevokedByAttester(attestationId, msg.sender, reason);
        emit AttestationStatusChanged(attestationId, Status.Revoked);
    }

    /// @notice Comprehensive validity check: active status, not revoked, and not expired.
    function isAttestationValid(uint256 attestationId) public view returns (bool) {
        Attestation storage a = attestations[attestationId];
        if (a.attester == address(0)) return false;
        if (a.status != Status.Active) return false;
        if (a.revokedByAttester) return false;
        if (a.validUntil > 0 && block.timestamp >= a.validUntil) return false;
        return true;
    }

    /// @notice Verify a selective-disclosure proof against the anchored Merkle root.
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

    function getSubjectAttestations(address subject) external view returns (uint256[] memory) {
        return _subjectAttestations[subject];
    }

    function getAttesterAttestations(address attester) external view returns (uint256[] memory) {
        return _attesterAttestations[attester];
    }
}

