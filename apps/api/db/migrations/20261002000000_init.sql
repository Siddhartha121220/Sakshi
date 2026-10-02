-- migrate:up

-- Registered phones. One row per app installation (one hardware key).
CREATE TABLE devices (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_key         bytea NOT NULL UNIQUE,                 -- SPKI DER, P-256
    key_hash           bytea NOT NULL UNIQUE CHECK (octet_length(key_hash) = 32), -- sha256(SPKI), on-chain revocation key
    security_level     text  NOT NULL CHECK (security_level IN ('strongbox', 'tee')),
    attestation_chain  bytea[] NOT NULL,                      -- DER certs, leaf first
    attestation_info   jsonb NOT NULL,                        -- parsed fields (os version, patch level, boot state) for debugging
    app_version        text  NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    -- revocation mirror of SakshiAnchor.deviceCompromisedAt (chain is the source of truth)
    compromised_at     timestamptz,
    revoke_reason      smallint,
    revoke_tx_hash     bytea CHECK (octet_length(revoke_tx_hash) = 32),
    CHECK ((compromised_at IS NULL) = (revoke_reason IS NULL))
);

-- One row per on-chain anchor transaction (a Merkle root over many captures).
CREATE TABLE anchor_batches (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    merkle_root        bytea   NOT NULL CHECK (octet_length(merkle_root) = 32),
    leaf_count         integer NOT NULL CHECK (leaf_count > 0),
    chain_id           integer NOT NULL,
    contract_address   bytea   NOT NULL CHECK (octet_length(contract_address) = 20),
    status             text    NOT NULL DEFAULT 'building'
                       CHECK (status IN ('building', 'submitted', 'confirmed', 'finalized', 'failed')),
    tx_hash            bytea UNIQUE CHECK (octet_length(tx_hash) = 32),
    tx_nonce           bigint,
    onchain_batch_id   bigint,                                -- index in SakshiAnchor.batches, known after receipt
    block_number       bigint,
    block_timestamp    timestamptz,                           -- proven "existed no later than" time
    error              text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    submitted_at       timestamptz,
    confirmed_at       timestamptz,
    finalized_at       timestamptz,
    UNIQUE (chain_id, contract_address, onchain_batch_id),
    CHECK (status NOT IN ('confirmed', 'finalized')
           OR (tx_hash IS NOT NULL AND onchain_batch_id IS NOT NULL
               AND block_number IS NOT NULL AND block_timestamp IS NOT NULL))
);

-- Anchoring is serial: at most one batch in flight at any time.
CREATE UNIQUE INDEX anchor_batches_one_inflight
    ON anchor_batches ((true)) WHERE status IN ('building', 'submitted');

-- A signed photo fingerprint. The photo itself is NOT stored here.
-- Anchoring status is derived: batch_id IS NULL → pending, else anchor_batches.status.
CREATE TABLE captures (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id            uuid  NOT NULL REFERENCES devices (id),
    sha256               bytea NOT NULL UNIQUE CHECK (octet_length(sha256) = 32),          -- image file hash
    manifest_bytes       bytea NOT NULL,                       -- exact signed JCS bytes; never re-serialise
    manifest_digest      bytea NOT NULL UNIQUE CHECK (octet_length(manifest_digest) = 32),
    signature            bytea NOT NULL,                       -- DER ECDSA P-256
    phash                bigint NOT NULL,                      -- 64-bit pHash as two's complement
    tile_hashes          bytea NOT NULL CHECK (octet_length(tile_hashes) = 128), -- 16 × 64-bit dHash, row-major
    width                integer NOT NULL CHECK (width > 0),
    height               integer NOT NULL CHECK (height > 0),
    captured_at_claimed  timestamptz NOT NULL,                 -- device clock; a claim, not a proof
    beacon_chain_id      integer,
    beacon_block_number  bigint,
    beacon_block_hash    bytea CHECK (octet_length(beacon_block_hash) = 32),
    batch_id             bigint REFERENCES anchor_batches (id),
    leaf_index           integer,
    merkle_proof         bytea[],                              -- sibling hashes, 32 bytes each
    original_object_key  text,                                 -- set only when the owner publishes the photo
    published_at         timestamptz,
    received_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, leaf_index),
    CHECK (num_nulls(beacon_chain_id, beacon_block_number, beacon_block_hash) IN (0, 3)),
    CHECK (num_nulls(batch_id, leaf_index, merkle_proof) IN (0, 3)),
    CHECK ((original_object_key IS NULL) = (published_at IS NULL))
);

CREATE INDEX captures_pending   ON captures (received_at) WHERE batch_id IS NULL;
CREATE INDEX captures_by_device ON captures (device_id, received_at DESC);
CREATE INDEX captures_by_batch  ON captures (batch_id);

-- A shareable group of captures, e.g. "Room 204 — move-in".
-- API enforces that every capture in an album belongs to the album owner's device.
CREATE TABLE albums (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_device_id  uuid NOT NULL REFERENCES devices (id),
    title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    description      text CHECK (char_length(description) <= 2000),
    share_slug       text NOT NULL UNIQUE CHECK (share_slug ~ '^[A-Za-z0-9]{12}$'),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX albums_by_owner ON albums (owner_device_id);

CREATE TABLE album_captures (
    album_id    uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    capture_id  uuid NOT NULL REFERENCES captures (id),
    position    integer NOT NULL,
    caption     text CHECK (char_length(caption) <= 500),
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (album_id, capture_id)
);

-- Anonymous verification outcomes for metrics. Deliberately no IP / user agent.
CREATE TABLE verification_events (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    capture_id        uuid REFERENCES captures (id) ON DELETE SET NULL,
    method            text NOT NULL CHECK (method IN ('exact', 'perceptual', 'bundle_file')),
    verdict           text NOT NULL CHECK (verdict IN ('authentic', 'authentic_pending', 'similar_to_authentic',
                                                       'device_revoked', 'invalid', 'no_provenance')),
    hamming_distance  smallint CHECK (hamming_distance BETWEEN 0 AND 64),
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_events_created ON verification_events (created_at);

-- migrate:down

DROP TABLE verification_events;
DROP TABLE album_captures;
DROP TABLE albums;
DROP TABLE captures;
DROP TABLE anchor_batches;
DROP TABLE devices;
