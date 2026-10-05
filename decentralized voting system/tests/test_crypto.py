from openballot.crypto import (
    generate_keypair,
    sign_message,
    verify_signature,
    public_key_to_hex,
    public_key_from_hex,
    private_key_to_hex,
    private_key_from_hex
)


def test_keypair_generation():
    priv, pub = generate_keypair()
    assert priv is not None
    assert pub is not None


def test_signature_verification():
    priv, pub = generate_keypair()
    msg = b"election-2026-ballot"
    sig = sign_message(priv, msg)

    assert verify_signature(pub, sig, msg) is True
    assert verify_signature(pub, sig, b"tampered-message") is False


def test_hex_serialization():
    priv, pub = generate_keypair()
    pub_hex = public_key_to_hex(pub)
    priv_hex = private_key_to_hex(priv)

    recovered_pub = public_key_from_hex(pub_hex)
    recovered_priv = private_key_from_hex(priv_hex)

    msg = b"test payload"
    sig = sign_message(recovered_priv, msg)
    assert verify_signature(recovered_pub, sig, msg) is True
