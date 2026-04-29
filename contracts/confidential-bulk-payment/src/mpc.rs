//! Mirror of v1.signer types and a typed cross-contract proxy.

use near_sdk::json_types::Base64VecU8;
use near_sdk::serde::Serialize;
use near_sdk::{AccountId, ext_contract};

#[derive(Serialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: PayloadV2,
    pub domain_id: u32,
}

#[derive(Serialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum PayloadV2 {
    Eddsa(String),
}

#[ext_contract(ext_v1_signer)]
pub trait V1Signer {
    fn derived_public_key(&self, path: String, predecessor: AccountId, domain_id: u32) -> String;
    fn sign(&self, request: SignRequest) -> Base64VecU8;
}
