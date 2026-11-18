use std::{sync::Arc, time::Duration};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use near_api::{PublicKey as ApiPublicKey, SecretKey as ApiSecretKey};
use near_crypto::{PublicKey, SecretKey};
use near_primitives::transaction::{SignedTransaction, Transaction};
use rand::Rng;

/// One sponsor access key. NEAR accepts a key's transactions in nonce order,
/// so a lane carries one unresolved transaction at a time.
pub struct SponsorLane {
    /// `ed25519:…`, the identity stored on `relay_transactions.public_key`.
    pub public_key: String,
    pub api_public_key: ApiPublicKey,
    secret: SecretKey,
}

impl SponsorLane {
    fn from_api_key(key: &ApiSecretKey) -> Result<Self, String> {
        let secret: SecretKey = key
            .to_string()
            .parse()
            .map_err(|error| format!("sponsor lane key: {error}"))?;
        let public_key = secret.public_key().to_string();
        let api_public_key = public_key
            .parse()
            .map_err(|error| format!("sponsor lane public key: {error}"))?;
        Ok(Self {
            public_key,
            api_public_key,
            secret,
        })
    }

    pub fn protocol_public_key(&self) -> PublicKey {
        self.secret.public_key()
    }

    pub fn sign(&self, transaction: Transaction) -> SignedTransaction {
        let (hash, _) = transaction.get_hash_and_size();
        SignedTransaction::new(self.secret.sign(hash.as_ref()), transaction)
    }
}

/// Every access key the relay engine signs with. `SPONSOR_LANE_KEYS` should
/// be keys nobody else uses: then a nonce the chain reports as consumed can
/// only mean our own transaction landed. Without them the shared `SIGNER_KEY`
/// is the single lane, and other senders on that key can invalidate a relay
/// in flight.
pub struct SponsorLanes {
    lanes: Vec<SponsorLane>,
    /// One turn per lane, handed out first come, first served. Signers in
    /// this process line up here before they look for a free lane, so an
    /// operation that has waited longest signs next instead of whichever
    /// asked last.
    turns: Arc<Semaphore>,
}

impl SponsorLanes {
    pub fn from_keys(shared: &ApiSecretKey, dedicated: &[ApiSecretKey]) -> Result<Self, String> {
        let keys: Vec<&ApiSecretKey> = if dedicated.is_empty() {
            vec![shared]
        } else {
            dedicated.iter().collect()
        };
        let mut lanes: Vec<SponsorLane> = Vec::with_capacity(keys.len());
        for key in keys {
            let lane = SponsorLane::from_api_key(key)?;
            if lanes
                .iter()
                .all(|known| known.public_key != lane.public_key)
            {
                lanes.push(lane);
            }
        }
        let turns = Arc::new(Semaphore::new(lanes.len()));
        Ok(Self { lanes, turns })
    }

    /// Wait in line for a signing turn; `None` when the wait ran out.
    pub async fn turn(&self, wait: Duration) -> Option<OwnedSemaphorePermit> {
        tokio::time::timeout(wait, self.turns.clone().acquire_owned())
            .await
            .ok()?
            .ok()
    }

    pub fn len(&self) -> usize {
        self.lanes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lanes.is_empty()
    }

    pub fn get(&self, public_key: &str) -> Option<&SponsorLane> {
        self.lanes.iter().find(|lane| lane.public_key == public_key)
    }

    /// Public keys starting at a random lane, so concurrent signers spread
    /// over the key set instead of all contending for lane zero.
    pub fn rotation(&self) -> Vec<String> {
        let offset = rand::rng().random_range(0..self.lanes.len().max(1));
        self.lanes
            .iter()
            .cycle()
            .skip(offset)
            .take(self.lanes.len())
            .map(|lane| lane.public_key.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(seed: &str) -> ApiSecretKey {
        SecretKey::from_seed(near_crypto::KeyType::ED25519, seed)
            .to_string()
            .parse()
            .unwrap()
    }

    #[tokio::test]
    async fn signing_turns_are_one_per_lane_and_first_come_first_served() {
        let lanes = Arc::new(SponsorLanes::from_keys(&key("a"), &[key("b")]).unwrap());
        let first = lanes.turn(Duration::from_millis(50)).await.expect("free");
        assert!(
            lanes.turn(Duration::from_millis(50)).await.is_none(),
            "one lane, one turn"
        );

        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut waiters = Vec::new();
        for name in ["second", "third"] {
            let (lanes, order) = (lanes.clone(), order.clone());
            waiters.push(tokio::spawn(async move {
                let turn = lanes.turn(Duration::from_secs(5)).await.expect("in line");
                order.lock().unwrap().push(name);
                drop(turn);
            }));
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        drop(first);
        for waiter in waiters {
            waiter.await.unwrap();
        }
        assert_eq!(*order.lock().unwrap(), ["second", "third"]);
    }

    #[test]
    fn dedicated_keys_replace_the_shared_signer_and_dedupe() {
        let lanes = SponsorLanes::from_keys(&key("a"), &[key("b"), key("b"), key("c")]).unwrap();
        assert_eq!(lanes.len(), 2);
        let shared = SponsorLane::from_api_key(&key("a")).unwrap();
        assert!(
            lanes.get(&shared.public_key).is_none(),
            "shared key is not a lane"
        );
        let rotation = lanes.rotation();
        assert_eq!(rotation.len(), 2);
        for public_key in &rotation {
            assert!(lanes.get(public_key).is_some());
        }

        let fallback = SponsorLanes::from_keys(&key("a"), &[]).unwrap();
        assert_eq!(fallback.len(), 1);
        assert!(fallback.get(&shared.public_key).is_some());
    }

    #[test]
    fn a_lane_signs_with_its_own_key() {
        let lanes = SponsorLanes::from_keys(&key("a"), &[]).unwrap();
        let lane = &lanes.lanes[0];
        let tx = Transaction::V0(near_primitives::transaction::TransactionV0 {
            signer_id: "sponsor.near".parse().unwrap(),
            public_key: lane.protocol_public_key(),
            nonce: 1,
            receiver_id: "dao.near".parse().unwrap(),
            block_hash: Default::default(),
            actions: vec![],
        });
        let signed = lane.sign(tx);
        assert!(
            signed
                .signature
                .verify(signed.get_hash().as_ref(), &lane.protocol_public_key())
        );
    }
}
