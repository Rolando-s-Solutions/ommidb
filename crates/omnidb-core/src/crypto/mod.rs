use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::prelude::*;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption failed")]
    EncryptionError,
    #[error("Decryption failed: invalid key or corrupted payload")]
    DecryptionError,
    #[error("Invalid base64 payload")]
    Base64Error(#[from] base64::DecodeError),
    #[error("Invalid payload format")]
    PayloadFormatError,
}

pub struct KeyDerivation;

impl KeyDerivation {
    pub const SALT_LEN: usize = 16;
    pub const KEY_LEN: usize = 32;
    pub const ITERATIONS: u32 = 100_000;

    pub fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; Self::KEY_LEN] {
        let mut key = [0u8; Self::KEY_LEN];
        pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, Self::ITERATIONS, &mut key);
        key
    }
}

pub struct EncryptionEngine;

impl EncryptionEngine {
    pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, CryptoError> {
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::EncryptionError)?;
        
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| CryptoError::EncryptionError)?;

        // Payload format: [12 bytes nonce] + [ciphertext + tag]
        let mut combined = Vec::with_capacity(12 + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        Ok(BASE64_STANDARD.encode(combined))
    }

    pub fn decrypt(encrypted_b64: &str, key: &[u8; 32]) -> Result<String, CryptoError> {
        let combined = BASE64_STANDARD.decode(encrypted_b64)?;
        if combined.len() < 12 {
            return Err(CryptoError::PayloadFormatError);
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::DecryptionError)?;
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| CryptoError::DecryptionError)?;

        String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptionError)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_roundtrip() {
        let salt = [42u8; 16];
        let key = KeyDerivation::derive_key("super-secret-master-pass", &salt);
        let secret = "postgres_super_password_123!";

        let encrypted = EncryptionEngine::encrypt(secret, &key).expect("encryption works");
        assert_ne!(encrypted, secret);

        let decrypted = EncryptionEngine::decrypt(&encrypted, &key).expect("decryption works");
        assert_eq!(decrypted, secret);
    }
}
