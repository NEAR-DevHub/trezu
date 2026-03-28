//! Integration tests for the confidential shield flow.
//!
//! Uses mock responses captured from a real near.com shield operation
//! (see examples/playwright/fixtures/shield_capture.json).
//!
//! The shield flow has 4 steps:
//! 1. Quote: get depositAddress and pricing
//! 2. Generate intent: get NEP-413 payload to sign
//! 3. Sign: sign the payload with wallet/MPC (tested separately)
//! 4. Submit: submit the signed intent for execution
//!
//! These tests validate our backend proxy handlers against the real API shapes.

#[cfg(test)]
mod tests {
    use crate::AppState;
    use crate::auth::AuthUser;
    use crate::handlers::intents::confidential::generate_intent::{
        GenerateIntentRequest, generate_intent,
    };
    use crate::handlers::intents::confidential::submit_intent::{
        SubmitIntentRequest, submit_intent,
    };
    use crate::handlers::intents::quote::{QuoteRequest, get_quote};
    use crate::utils::env::EnvVars;
    use axum::Json;
    use axum::extract::State;
    use std::sync::Arc;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn mock_auth_user() -> AuthUser {
        AuthUser {
            account_id: "test.near".to_string(),
        }
    }

    /// Create test AppState pointing at a mock server
    async fn create_test_state(mock_server_url: &str) -> Arc<AppState> {
        dotenvy::from_filename(".env").ok();
        dotenvy::from_filename(".env.test").ok();

        let mut env_vars = EnvVars::default();
        env_vars.oneclick_api_url = mock_server_url.to_string();
        env_vars.oneclick_jwt_token = Some("test-jwt-token".to_string());
        env_vars.oneclick_app_fee_bps = Some(35);
        env_vars.oneclick_app_fee_recipient = Some("trezu.sputnik-dao.near".to_string());
        env_vars.oneclick_referral = Some("trezu".to_string());

        let db_pool = sqlx::postgres::PgPool::connect_lazy(&env_vars.database_url)
            .expect("Failed to create lazy pool");

        Arc::new(
            AppState::builder()
                .db_pool(db_pool)
                .env_vars(env_vars)
                .build()
                .await
                .expect("Failed to build test AppState"),
        )
    }

    // ======================================================================
    // Mock responses based on real captured data from near.com shield flow
    // Source: examples/playwright/fixtures/shield_capture.json
    // ======================================================================

    /// Real quote response for 0.1 wNEAR shield
    fn mock_shield_quote_response() -> serde_json::Value {
        serde_json::json!({
            "quote": {
                "amountIn": "100000000000000000000000",
                "amountInFormatted": "0.1",
                "amountInUsd": "0.1320",
                "minAmountIn": "100000000000000000000000",
                "amountOut": "100000000000000000000000",
                "amountOutFormatted": "0.1",
                "amountOutUsd": "0.1320",
                "minAmountOut": "99000000000000000000000",
                "timeEstimate": 10,
                "deadline": "2026-03-22T14:17:56.778Z",
                "timeWhenInactive": "2026-03-22T14:17:56.778Z",
                "depositAddress": "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e"
            },
            "quoteRequest": {
                "dry": false,
                "depositMode": "SIMPLE",
                "swapType": "EXACT_INPUT",
                "slippageTolerance": 100,
                "originAsset": "nep141:wrap.near",
                "depositType": "INTENTS",
                "destinationAsset": "nep141:wrap.near",
                "amount": "100000000000000000000000",
                "refundTo": "petersalomonsendev.near",
                "refundType": "CONFIDENTIAL_INTENTS",
                "recipient": "petersalomonsendev.near",
                "recipientType": "CONFIDENTIAL_INTENTS",
                "deadline": "2026-03-21T14:22:56.605Z",
                "quoteWaitingTimeMs": 0
            },
            "signature": "ed25519:test_signature",
            "timestamp": "2026-03-21T14:17:56.740Z",
            "correlationId": "60926e37-aa14-4029-b06f-9665017c98a0"
        })
    }

    /// Real generate-intent response with NEP-413 payload
    fn mock_generate_intent_response() -> serde_json::Value {
        serde_json::json!({
            "intent": {
                "standard": "nep413",
                "payload": {
                    "message": "{\"deadline\":\"2026-03-22T14:17:56.778Z\",\"intents\":[{\"intent\":\"transfer\",\"receiver_id\":\"d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e\",\"tokens\":{\"nep141:wrap.near\":\"100000000000000000000000\"}}],\"signer_id\":\"petersalomonsendev.near\"}",
                    "nonce": "Vij2xgAlKBKzgB67tZAvnxgPVIiJkIBxtPcWOQPg6MM=",
                    "recipient": "intents.near"
                }
            },
            "correlationId": "60926e37-aa14-4029-b06f-9665017c98a0"
        })
    }

    /// Real submit-intent response
    fn mock_submit_intent_response() -> serde_json::Value {
        serde_json::json!({
            "intentHash": "9JXD3ae4yNeVY9LjdWMAzpQpGveZeUmMXfuG6ZjUkTjD",
            "correlationId": "fedd8c7d-5305-4647-9460-140b1d27f98c"
        })
    }

    // ======================================================================
    // Step 1: Shield Quote
    // ======================================================================

    #[tokio::test]
    async fn test_shield_quote_returns_deposit_address() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v0/quote"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_shield_quote_response()))
            .expect(1)
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;

        let request = QuoteRequest {
            dry: Some(false),
            swap_type: Some("EXACT_INPUT".to_string()),
            slippage_tolerance: Some(100),
            origin_asset: "nep141:wrap.near".to_string(),
            deposit_type: Some("INTENTS".to_string()),
            destination_asset: "nep141:wrap.near".to_string(),
            amount: "100000000000000000000000".to_string(),
            refund_to: Some("petersalomonsendev.near".to_string()),
            refund_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            recipient: Some("petersalomonsendev.near".to_string()),
            recipient_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            deadline: "2026-03-21T14:22:56.605Z".to_string(),
            quote_waiting_time_ms: Some(0),
        };

        let result = get_quote(State(state), Json(request)).await;
        assert!(result.is_ok(), "Quote should succeed");

        let response = result.unwrap().0;
        let quote = &response["quote"];

        // Verify key fields from real captured response
        assert_eq!(quote["amountIn"], "100000000000000000000000");
        assert_eq!(quote["amountOut"], "100000000000000000000000");
        assert_eq!(quote["timeEstimate"], 10);
        assert!(
            quote["depositAddress"].as_str().is_some(),
            "Shield quote must return a depositAddress"
        );
        assert_eq!(
            quote["depositAddress"],
            "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e"
        );
    }

    #[tokio::test]
    async fn test_shield_quote_same_token_in_and_out() {
        // Shield is a same-token operation (wNEAR → wNEAR confidential)
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v0/quote"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_shield_quote_response()))
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;

        let request = QuoteRequest {
            dry: Some(false),
            swap_type: Some("EXACT_INPUT".to_string()),
            slippage_tolerance: Some(100),
            origin_asset: "nep141:wrap.near".to_string(),
            deposit_type: Some("INTENTS".to_string()),
            destination_asset: "nep141:wrap.near".to_string(),
            amount: "100000000000000000000000".to_string(),
            refund_to: Some("petersalomonsendev.near".to_string()),
            refund_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            recipient: Some("petersalomonsendev.near".to_string()),
            recipient_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            deadline: "2026-03-21T14:22:56.605Z".to_string(),
            quote_waiting_time_ms: Some(0),
        };

        let result = get_quote(State(state), Json(request)).await.unwrap();
        let quote = &result.0["quote"];

        // For shield, amountIn == amountOut (same token, 1:1)
        assert_eq!(quote["amountIn"], quote["amountOut"]);
    }

    // ======================================================================
    // Step 2: Generate Intent
    // ======================================================================

    #[tokio::test]
    async fn test_generate_intent_returns_nep413_payload() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v0/generate-intent"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_generate_intent_response()))
            .expect(1)
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;

        let request = GenerateIntentRequest {
            r#type: "SWAP_TRANSFER".to_string(),
            standard: "nep413".to_string(),
            deposit_address: "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e"
                .to_string(),
            signer_id: "petersalomonsendev.near".to_string(),
        };

        let result = generate_intent(State(state), mock_auth_user(), Json(request)).await;
        assert!(result.is_ok(), "Generate intent should succeed");

        let response = result.unwrap().0;
        let intent = &response["intent"];

        // Verify NEP-413 structure
        assert_eq!(intent["standard"], "nep413");
        assert!(intent["payload"]["message"].is_string());
        assert!(intent["payload"]["nonce"].is_string());
        assert_eq!(intent["payload"]["recipient"], "intents.near");

        // Verify the message contains the transfer intent
        let message: serde_json::Value =
            serde_json::from_str(intent["payload"]["message"].as_str().unwrap()).unwrap();
        assert!(message["deadline"].is_string());
        assert_eq!(message["signer_id"], "petersalomonsendev.near");

        let intents = message["intents"].as_array().unwrap();
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0]["intent"], "transfer");
        assert_eq!(
            intents[0]["receiver_id"],
            "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e"
        );
        assert_eq!(
            intents[0]["tokens"]["nep141:wrap.near"],
            "100000000000000000000000"
        );
    }

    #[tokio::test]
    async fn test_generate_intent_deposit_address_becomes_receiver() {
        // Key insight: the depositAddress from the quote becomes
        // the receiver_id in the transfer intent (FAR chain address)
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v0/generate-intent"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_generate_intent_response()))
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;
        let deposit_addr = "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e";

        let request = GenerateIntentRequest {
            r#type: "SWAP_TRANSFER".to_string(),
            standard: "nep413".to_string(),
            deposit_address: deposit_addr.to_string(),
            signer_id: "petersalomonsendev.near".to_string(),
        };

        let result = generate_intent(State(state), mock_auth_user(), Json(request))
            .await
            .unwrap();
        let message_str = result.0["intent"]["payload"]["message"].as_str().unwrap();
        let message: serde_json::Value = serde_json::from_str(message_str).unwrap();

        // The depositAddress from quote == receiver_id in intent
        assert_eq!(message["intents"][0]["receiver_id"], deposit_addr);
    }

    // ======================================================================
    // Step 3: Submit Signed Intent
    // ======================================================================

    #[tokio::test]
    async fn test_submit_signed_intent() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v0/submit-intent"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_submit_intent_response()))
            .expect(1)
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;

        // Real signed intent captured from near.com
        let signed_data = serde_json::json!({
            "standard": "nep413",
            "payload": {
                "message": "{\"deadline\":\"2026-03-22T14:17:56.778Z\",\"intents\":[{\"intent\":\"transfer\",\"receiver_id\":\"d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e\",\"tokens\":{\"nep141:wrap.near\":\"100000000000000000000000\"}}],\"signer_id\":\"petersalomonsendev.near\"}",
                "nonce": "Vij2xgAlKBKzgB67tZAvnxgPVIiJkIBxtPcWOQPg6MM=",
                "recipient": "intents.near",
                "callbackUrl": "$undefined"
            },
            "public_key": "ed25519:GRtF329SrJLv4cBckqgdRYMAModu3Rnnvaaq2BCJzprJ",
            "signature": "ed25519:hEiMeWEsSzE1nCpUW6aA28BZtZ9RmB1N3NH62dfek8UWMGFyJAGRzAhAfAPCY5rM62mFwm6dWi4xiHgRZrubef3"
        });

        let request = SubmitIntentRequest {
            dao_id: "test.sputnik-dao.near".to_string(),
            r#type: "SWAP_TRANSFER".to_string(),
            signed_data,
        };

        let result = submit_intent(State(state), mock_auth_user(), Json(request)).await;
        assert!(result.is_ok(), "Submit intent should succeed");

        let response = result.unwrap().0;
        assert!(
            response["intentHash"].is_string(),
            "Response should contain intentHash"
        );
        assert_eq!(
            response["intentHash"],
            "9JXD3ae4yNeVY9LjdWMAzpQpGveZeUmMXfuG6ZjUkTjD"
        );
        assert!(response["correlationId"].is_string());
    }

    // ======================================================================
    // Full flow: Quote → Generate → Sign → Submit
    // ======================================================================

    #[tokio::test]
    async fn test_full_shield_flow_with_local_signing() {
        let mock_server = MockServer::start().await;

        // Mount all three mocks
        Mock::given(method("POST"))
            .and(path("/v0/quote"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_shield_quote_response()))
            .mount(&mock_server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v0/generate-intent"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_generate_intent_response()))
            .mount(&mock_server)
            .await;

        Mock::given(method("POST"))
            .and(path("/v0/submit-intent"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_submit_intent_response()))
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;
        let account_id = "petersalomonsendev.near";

        // Step 1: Get shield quote
        let quote_request = QuoteRequest {
            dry: Some(false),
            swap_type: Some("EXACT_INPUT".to_string()),
            slippage_tolerance: Some(100),
            origin_asset: "nep141:wrap.near".to_string(),
            deposit_type: Some("INTENTS".to_string()),
            destination_asset: "nep141:wrap.near".to_string(),
            amount: "100000000000000000000000".to_string(),
            refund_to: Some(account_id.to_string()),
            refund_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            recipient: Some(account_id.to_string()),
            recipient_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            deadline: "2026-03-21T14:22:56.605Z".to_string(),
            quote_waiting_time_ms: Some(0),
        };

        let quote_result = get_quote(State(state.clone()), Json(quote_request))
            .await
            .expect("Quote should succeed");
        let deposit_address = quote_result.0["quote"]["depositAddress"]
            .as_str()
            .expect("Should have depositAddress");

        // Step 2: Generate intent
        let gen_request = GenerateIntentRequest {
            r#type: "SWAP_TRANSFER".to_string(),
            standard: "nep413".to_string(),
            deposit_address: deposit_address.to_string(),
            signer_id: account_id.to_string(),
        };

        let gen_result = generate_intent(State(state.clone()), mock_auth_user(), Json(gen_request))
            .await
            .expect("Generate intent should succeed");
        let intent_payload = &gen_result.0["intent"]["payload"];

        // Step 3: Sign locally (using dev account key)
        dotenvy::from_filename("../.env").ok();
        let secret_key_str =
            std::env::var("PETERSALOMONSEN_DEV").expect("PETERSALOMONSEN_DEV must be set");
        let secret_key: near_crypto::SecretKey = secret_key_str.parse().unwrap();
        let public_key = secret_key.public_key();

        let message = intent_payload["message"].as_str().unwrap();
        let nonce_b64 = intent_payload["nonce"].as_str().unwrap();
        let recipient = intent_payload["recipient"].as_str().unwrap();

        // Decode nonce from base64
        use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
        let nonce_bytes = BASE64.decode(nonce_b64).expect("Invalid base64 nonce");
        let nonce: [u8; 32] = nonce_bytes.try_into().expect("Nonce must be 32 bytes");

        // Sign NEP-413 (matching near-cli-rs implementation)
        #[derive(borsh::BorshSerialize)]
        struct NEP413Payload {
            message: String,
            nonce: [u8; 32],
            recipient: String,
            callback_url: Option<String>,
        }

        let payload = NEP413Payload {
            message: message.to_string(),
            nonce,
            recipient: recipient.to_string(),
            callback_url: None,
        };

        const NEP413_PREFIX: u32 = (1u32 << 31) + 413;
        let mut bytes = NEP413_PREFIX.to_le_bytes().to_vec();
        borsh::to_writer(&mut bytes, &payload).expect("Borsh serialization failed");

        use sha2::Digest;
        let hash = sha2::Sha256::digest(&bytes);
        let signature = secret_key.sign(&hash);

        // Step 4: Submit signed intent
        let signed_data = serde_json::json!({
            "standard": "nep413",
            "payload": {
                "message": message,
                "nonce": nonce_b64,
                "recipient": recipient,
            },
            "public_key": public_key.to_string(),
            "signature": signature.to_string(),
        });

        let submit_request = SubmitIntentRequest {
            dao_id: "test.sputnik-dao.near".to_string(),
            r#type: "SWAP_TRANSFER".to_string(),
            signed_data,
        };

        let submit_result = submit_intent(State(state), mock_auth_user(), Json(submit_request))
            .await
            .expect("Submit should succeed");

        assert!(submit_result.0["intentHash"].is_string());
        assert!(submit_result.0["correlationId"].is_string());
    }

    // ======================================================================
    // Error cases
    // ======================================================================

    #[tokio::test]
    async fn test_generate_intent_api_error() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v0/generate-intent"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": "Bad Request",
                "message": "Invalid deposit address"
            })))
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;

        let request = GenerateIntentRequest {
            r#type: "SWAP_TRANSFER".to_string(),
            standard: "nep413".to_string(),
            deposit_address: "invalid".to_string(),
            signer_id: "test.near".to_string(),
        };

        let result = generate_intent(State(state), mock_auth_user(), Json(request)).await;
        assert!(result.is_err());
        let (status, msg) = result.unwrap_err();
        assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
        // Handler extracts "error" field first, which is "Bad Request"
        assert!(
            msg.contains("Bad Request") || msg.contains("Invalid deposit address"),
            "Expected error message, got: {}",
            msg
        );
    }

    #[tokio::test]
    async fn test_submit_intent_api_error() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/v0/submit-intent"))
            .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "error": "Unauthorized",
                "message": "Invalid signature"
            })))
            .mount(&mock_server)
            .await;

        let state = create_test_state(&mock_server.uri()).await;

        let request = SubmitIntentRequest {
            dao_id: "test.sputnik-dao.near".to_string(),
            r#type: "SWAP_TRANSFER".to_string(),
            signed_data: serde_json::json!({"bad": "data"}),
        };

        let result = submit_intent(State(state), mock_auth_user(), Json(request)).await;
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, axum::http::StatusCode::UNAUTHORIZED);
    }
}
