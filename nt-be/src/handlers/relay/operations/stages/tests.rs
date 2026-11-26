//! Each stage against a test database and a scripted chain node. A "process"
//! is an `AppState` of its own on the shared database; a crash is a claim
//! dropped with its lease expired, so the next claim starts from the row.

use std::sync::{Arc, Mutex};

use near_api::{AccountId, NearToken, NetworkConfig, RPCEndpoint};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::OwnedSemaphorePermit;
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate, matchers::any};

use super::{StageContext, StageError, StageResult};
use crate::{
    AppState,
    handlers::relay::operations::{
        engine::{RelayEngine, RunOutcome},
        models::{
            FailureCode, NewRelayOperation, OperationKind, OperationLease, OperationOutcome,
            OperationStage, OperationState, RelayOperation, RelayProposalType, RelayTransaction,
            TransactionState,
        },
        plan::RelayPlan,
        rpc::RelayRpc,
        store::RelayStore,
    },
    utils::test_utils::{build_test_state, policy_granting},
};

const DAO: &str = "stages.sputnik-dao.near";
const USER: &str = "alice.near";
const LEASE: std::time::Duration = std::time::Duration::from_secs(60);
const RUN_BUDGET: std::time::Duration = std::time::Duration::from_secs(20);
const HEAD: u64 = 1_000;

#[derive(Clone)]
enum Reply {
    Result(Value),
    Error(Value),
    Down,
}

struct Script {
    send_tx: Reply,
    tx: Reply,
    policy: Reply,
    proposal: Reply,
    calls: Vec<(String, Value)>,
}

/// The chain node every process talks to. Tests change its answers and read
/// back what it was asked.
#[derive(Clone)]
struct Node(Arc<Mutex<Script>>);

impl Node {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(Script {
            send_tx: Reply::Down,
            tx: Reply::Error(json!({ "cause": { "name": "UNKNOWN_TRANSACTION" } })),
            policy: Reply::Result(view_result(&policy_granting(
                USER,
                &["*:AddProposal", "*:VoteApprove"],
            ))),
            proposal: Reply::Down,
            calls: Vec::new(),
        })))
    }

    fn script(&self, change: impl FnOnce(&mut Script)) {
        change(&mut self.0.lock().unwrap());
    }

    fn params_of(&self, method: &str) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(name, _)| name == method)
            .map(|(_, params)| params.clone())
            .collect()
    }

    fn count(&self, method: &str) -> usize {
        self.params_of(method).len()
    }
}

impl Respond for Node {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or_default();
        let params = body["params"].clone();
        let method = match body["method"].as_str().unwrap_or_default() {
            "query" => params["method_name"]
                .as_str()
                .unwrap_or("view_access_key")
                .to_owned(),
            other => other.to_owned(),
        };
        let mut script = self.0.lock().unwrap();
        let reply = match method.as_str() {
            "send_tx" => script.send_tx.clone(),
            "tx" => script.tx.clone(),
            "block" => Reply::Result(block(HEAD)),
            "view_access_key" => Reply::Result(json!({
                "nonce": 7,
                "permission": "FullAccess",
                "block_height": HEAD,
                "block_hash": "11111111111111111111111111111111",
            })),
            "get_policy" => script.policy.clone(),
            "get_proposal" => script.proposal.clone(),
            _ => Reply::Down,
        };
        script.calls.push((method, params));
        match reply {
            Reply::Result(result) => ResponseTemplate::new(200)
                .set_body_json(json!({ "jsonrpc": "2.0", "id": "dontcare", "result": result })),
            Reply::Error(error) => ResponseTemplate::new(200)
                .set_body_json(json!({ "jsonrpc": "2.0", "id": "dontcare", "error": error })),
            Reply::Down => ResponseTemplate::new(503),
        }
    }
}

fn view_result(value: &Value) -> Value {
    json!({
        "result": serde_json::to_vec(value).unwrap(),
        "logs": [],
        "block_height": HEAD,
        "block_hash": "11111111111111111111111111111111",
    })
}

fn block(height: u64) -> Value {
    let hash = "11111111111111111111111111111111";
    json!({
        "author": "node.near",
        "chunks": [],
        "header": {
            "approvals": [],
            "block_body_hash": hash,
            "block_merkle_root": hash,
            "block_ordinal": height,
            "challenges_result": [],
            "challenges_root": hash,
            "chunk_endorsements": [],
            "chunk_headers_root": hash,
            "chunk_mask": [],
            "chunk_receipts_root": hash,
            "chunk_tx_root": hash,
            "chunks_included": 0,
            "epoch_id": hash,
            "epoch_sync_data_hash": null,
            "gas_price": "100000000",
            "hash": hash,
            "height": height,
            "last_ds_final_block": hash,
            "last_final_block": hash,
            "latest_protocol_version": 88,
            "next_bp_hash": hash,
            "next_epoch_id": hash,
            "outcome_root": hash,
            "prev_hash": hash,
            "prev_height": height - 1,
            "prev_state_root": hash,
            "random_value": hash,
            "rent_paid": "0",
            "signature": "ed25519:4uc3qFKAVrhtJR7MpZVgNi6hsBn82zEtQkjcgyow4JCjV7TMmHCMTyZi2z5VYKZr4u7Hg9qPPCb9AwN6agHGSiKX",
            "timestamp": 1_794_731_078_427_311_643_u64,
            "timestamp_nanosec": "1794731078427311643",
            "total_supply": "1311752275436559488671768069109769",
            "validator_proposals": [],
            "validator_reward": "0",
        },
    })
}

/// A final outcome in which the DAO returned `proposal_id`.
fn landed(proposal_id: u64) -> Value {
    use base64::Engine as _;
    json!({
        "final_execution_status": "FINAL",
        "status": { "SuccessValue": "" },
        "receipts_outcome": [{
            "outcome": {
                "executor_id": DAO,
                "status": {
                    "SuccessValue": base64::engine::general_purpose::STANDARD
                        .encode(proposal_id.to_string()),
                },
            },
        }],
    })
}

fn failed_on_chain() -> Value {
    json!({
        "final_execution_status": "FINAL",
        "status": { "Failure": { "ActionError": { "kind": "FunctionCallError" } } },
        "receipts_outcome": [],
    })
}

fn not_executed_yet() -> Reply {
    Reply::Result(json!({ "final_execution_status": "INCLUDED" }))
}

fn timed_out() -> Reply {
    Reply::Error(json!({ "name": "HANDLER_ERROR", "cause": { "name": "TIMEOUT_ERROR" } }))
}

/// A user's signed delegate action calling `method` on the DAO.
fn delegate(method: &str, args: Value) -> Vec<u8> {
    use near_crypto::{KeyType, PublicKey, Signature};
    use near_primitives::action::{
        Action, FunctionCallAction,
        delegate::{DelegateAction, NonDelegateAction, SignedDelegateAction},
    };

    let call = NonDelegateAction::try_from(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: method.to_owned(),
        args: serde_json::to_vec(&args).unwrap(),
        gas: near_primitives::gas::Gas::from_gas(10),
        deposit: NearToken::from_yoctonear(0),
    })))
    .unwrap();
    borsh::to_vec(&SignedDelegateAction {
        delegate_action: DelegateAction {
            sender_id: USER.parse().unwrap(),
            receiver_id: DAO.parse().unwrap(),
            actions: vec![call],
            nonce: 1,
            max_block_height: HEAD + 10_000,
            public_key: PublicKey::empty(KeyType::ED25519),
        },
        signature: Signature::empty(KeyType::ED25519),
    })
    .unwrap()
}

fn add_proposal() -> Vec<u8> {
    delegate(
        "add_proposal",
        json!({ "proposal": { "description": "d", "kind": { "Transfer": {
            "token_id": "", "receiver_id": "bob.near", "amount": "1"
        } } } }),
    )
}

fn approve(proposal_id: u64) -> Vec<u8> {
    delegate(
        "act_proposal",
        json!({ "id": proposal_id, "action": "VoteApprove" }),
    )
}

/// One backend process: its own state, lanes and caches, on the shared
/// database and chain node.
struct Process {
    state: Arc<AppState>,
    rpc: RelayRpc,
}

impl Process {
    fn store(&self) -> RelayStore<'_> {
        RelayStore::new(&self.state.db_pool)
    }

    fn engine(&self) -> RelayEngine {
        RelayEngine::new(self.state.clone())
    }

    /// Run a claimed operation as the worker loop would.
    async fn finish_run(&self, operation: RelayOperation) -> RunOutcome {
        let engine = self.engine();
        Box::pin(engine.run_operation(operation, RUN_BUDGET)).await
    }
}

/// What one process holds in memory while it works an operation.
struct Claim {
    operation: RelayOperation,
    lease: OperationLease,
    plan: RelayPlan,
    landed_relay: Mutex<Option<Value>>,
    lane_turn: Mutex<Option<OwnedSemaphorePermit>>,
}

impl Claim {
    fn of(operation: RelayOperation) -> Self {
        Self {
            lease: operation.lease().expect("a claimed row carries its lease"),
            plan: RelayPlan::from_operation(&operation).expect("payload parses"),
            operation,
            landed_relay: Mutex::new(None),
            lane_turn: Mutex::new(None),
        }
    }

    /// One call of the stage the operation is in.
    async fn stage(&self, process: &Process) -> Result<StageResult, StageError> {
        // Boxed: these futures are large in a debug build and the test
        // thread's stack is half a worker's.
        Box::pin(super::run(&StageContext {
            state: &process.state,
            rpc: &process.rpc,
            lease: &self.lease,
            operation: &self.operation,
            plan: &self.plan,
            landed_relay: &self.landed_relay,
            lane_turn: &self.lane_turn,
        }))
        .await
    }

    /// Commit what the stage returned, as the engine does.
    async fn advance(&mut self, process: &Process, result: StageResult) -> OperationStage {
        self.operation = match result {
            StageResult::Advance(to) => process
                .store()
                .advance_stage(&self.lease, self.operation.stage, to)
                .await
                .expect("advance commits"),
            StageResult::Advanced(row) => *row,
            other => panic!("expected the stage to finish, got {}", describe(&other)),
        };
        self.operation.stage
    }
}

fn describe(result: &StageResult) -> String {
    match result {
        StageResult::Advance(to) => format!("advance to {to}"),
        StageResult::Advanced(row) => format!("advanced to {}", row.stage),
        StageResult::NotReady(after, note) => format!("not ready for {after:?}: {note:?}"),
        StageResult::Done(completion) => format!("done as {}", completion.outcome.state()),
    }
}

fn describe_all(result: &Result<StageResult, StageError>) -> String {
    match result {
        Ok(result) => describe(result),
        Err(StageError::Store(error)) => format!("store error: {error}"),
        Err(StageError::Transient(error)) => format!("transient: {error}"),
        Err(StageError::Invariant(error)) => format!("invariant: {error}"),
    }
}

struct World {
    pool: PgPool,
    node: Node,
    server: MockServer,
}

impl World {
    async fn start(pool: PgPool) -> Self {
        let node = Node::new();
        let server = MockServer::start().await;
        Mock::given(any())
            .respond_with(node.clone())
            .mount(&server)
            .await;
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, enabled, gas_covered_transactions) VALUES ($1, true, 5)",
        )
        .bind(DAO)
        .execute(&pool)
        .await
        .expect("seed treasury");
        Self { pool, node, server }
    }

    fn process(&self) -> Process {
        let mut state = build_test_state(self.pool.clone());
        state.network = NetworkConfig {
            rpc_endpoints: vec![
                RPCEndpoint::new(self.server.uri().parse().unwrap()).with_retries(1),
            ],
            ..NetworkConfig::mainnet()
        };
        let rpc = RelayRpc::from_state(&state);
        Process {
            state: Arc::new(state),
            rpc,
        }
    }

    async fn submit(&self, kind: OperationKind, payload: Vec<u8>) -> uuid::Uuid {
        let treasury_id: AccountId = DAO.parse().unwrap();
        let actor: AccountId = USER.parse().unwrap();
        let mut conn = self.pool.acquire().await.unwrap();
        RelayStore::insert_or_load_operation(
            &mut conn,
            NewRelayOperation {
                treasury_id,
                actor_account_id: actor,
                operation_kind: kind,
                submission_payload: payload,
                proposal_type: Some(RelayProposalType::Payment),
            },
        )
        .await
        .expect("insert")
        .id
    }

    async fn claim(&self, process: &Process, id: uuid::Uuid) -> Claim {
        Claim::of(
            process
                .store()
                .claim_operation(id, LEASE)
                .await
                .unwrap()
                .expect("the operation is free to claim"),
        )
    }

    /// The holder stopped without a word: its lease runs out and whatever it
    /// kept in memory is gone.
    async fn crash(&self, claim: Claim) -> uuid::Uuid {
        sqlx::query(
            "UPDATE relay_operations SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1",
        )
        .bind(claim.operation.id)
        .execute(&self.pool)
        .await
        .unwrap();
        claim.operation.id
    }

    /// An operation another process already brought to `stage`.
    async fn claimed_in(
        &self,
        process: &Process,
        payload: Vec<u8>,
        stage: OperationStage,
    ) -> Claim {
        let kind = match stage {
            OperationStage::Registrations => OperationKind::ActProposal,
            _ => OperationKind::AddProposal,
        };
        let id = self.submit(kind, payload).await;
        let mut claim = self.claim(process, id).await;
        if stage != OperationStage::Authorize {
            claim.operation = process
                .store()
                .advance_stage(&claim.lease, OperationStage::Authorize, stage)
                .await
                .unwrap();
        }
        claim
    }

    async fn transactions(&self, id: uuid::Uuid) -> Vec<RelayTransaction> {
        RelayStore::new(&self.pool)
            .transactions_of(id)
            .await
            .unwrap()
    }

    async fn credits(&self) -> i32 {
        sqlx::query_scalar(
            "SELECT gas_covered_transactions FROM monitored_accounts WHERE account_id = $1",
        )
        .bind(DAO)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }

    /// Every `send_tx` carried the bytes of a committed transaction, each
    /// transaction's bytes at most `times` over.
    async fn assert_only_committed_bytes_were_sent(&self, id: uuid::Uuid) {
        use base64::Engine as _;
        let committed: Vec<String> = self
            .transactions(id)
            .await
            .iter()
            .map(|tx| base64::engine::general_purpose::STANDARD.encode(&tx.signed_tx))
            .collect();
        for params in self.node.params_of("send_tx") {
            let sent = params["signed_tx_base64"].as_str().unwrap_or_default();
            assert!(
                committed.iter().any(|bytes| bytes == sent),
                "a transaction was broadcast that the database does not hold"
            );
        }
    }
}

#[sqlx::test]
async fn authorize_takes_one_credit_even_when_two_processes_hold_the_row(pool: PgPool) {
    let world = World::start(pool).await;
    let (first, second) = (world.process(), world.process());
    let id = world
        .submit(OperationKind::AddProposal, add_proposal())
        .await;

    // The first holder stalls past its lease; the second takes the row over.
    let stalled = world.claim(&first, id).await;
    sqlx::query(
        "UPDATE relay_operations SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1",
    )
    .bind(id)
    .execute(&world.pool)
    .await
    .unwrap();
    let mut claim = world.claim(&second, id).await;

    let result = claim.stage(&second).await.unwrap();
    assert_eq!(
        claim.advance(&second, result).await,
        OperationStage::StorageTopUp
    );
    assert!(claim.operation.credit_reserved);
    assert_eq!(world.credits().await, 4);

    let late = stalled.stage(&first).await;
    assert!(
        matches!(
            late,
            Err(StageError::Store(
                crate::handlers::relay::operations::store::RelayStoreError::LeaseLost
            ))
        ),
        "the stalled holder writes nothing: {}",
        describe_all(&late)
    );
    assert_eq!(world.credits().await, 4, "its reservation rolled back");
    assert_eq!(world.node.count("send_tx"), 0);
}

#[sqlx::test]
async fn authorize_waits_out_a_failed_read_and_ends_on_a_refusal(pool: PgPool) {
    let world = World::start(pool).await;
    let process = world.process();
    let id = world
        .submit(OperationKind::AddProposal, add_proposal())
        .await;
    let claim = world.claim(&process, id).await;

    world.node.script(|script| script.policy = Reply::Down);
    let result = claim.stage(&process).await;
    assert!(
        matches!(result, Err(StageError::Transient(_))),
        "{}",
        describe_all(&result)
    );
    let row = process.store().operation(id).await.unwrap().unwrap();
    assert_eq!(row.stage, OperationStage::Authorize);
    assert!(!row.credit_reserved);
    assert_eq!(world.credits().await, 5);

    world.node.script(|script| {
        script.policy = Reply::Result(view_result(&policy_granting(
            "someone-else.near",
            &["*:AddProposal"],
        )))
    });
    let Ok(StageResult::Done(completion)) = claim.stage(&process).await else {
        panic!("a refusal is the answer to the user");
    };
    assert!(matches!(
        completion.outcome,
        OperationOutcome::Failed {
            failure_code: FailureCode::Rejected(axum::http::StatusCode::FORBIDDEN),
            ..
        }
    ));
    assert_eq!(world.credits().await, 5, "a refusal takes no credit");
    assert!(world.transactions(id).await.is_empty());
}

#[sqlx::test]
async fn a_sponsor_step_is_signed_once_however_often_its_holder_changes(pool: PgPool) {
    let world = World::start(pool).await;
    let processes = [world.process(), world.process(), world.process()];

    // Signed and committed, then the holder dies before broadcasting.
    let claim = world
        .claimed_in(&processes[0], add_proposal(), OperationStage::StorageTopUp)
        .await;
    assert!(matches!(
        claim.stage(&processes[0]).await,
        Ok(StageResult::NotReady(..))
    ));
    let id = world.crash(claim).await;
    let signed = world.transactions(id).await;
    assert_eq!(signed.len(), 1);
    assert_eq!(signed[0].state, TransactionState::Prepared);
    assert_eq!(world.node.count("send_tx"), 0);

    // The next holder broadcasts those bytes; the node never answers.
    world.node.script(|script| script.send_tx = timed_out());
    let claim = world.claim(&processes[1], id).await;
    assert!(matches!(
        claim.stage(&processes[1]).await,
        Ok(StageResult::NotReady(..))
    ));
    let id = world.crash(claim).await;
    assert_eq!(world.node.count("send_tx"), 1);

    // Sent but not executed: the third holder waits and writes nothing.
    world.node.script(|script| script.tx = not_executed_yet());
    let mut claim = world.claim(&processes[2], id).await;
    let before = world.transactions(id).await;
    assert!(matches!(
        claim.stage(&processes[2]).await,
        Ok(StageResult::NotReady(..))
    ));
    let after = world.transactions(id).await;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].state, TransactionState::Pending);
    assert_eq!(after[0].tx_hash, signed[0].tx_hash);
    assert_eq!(after[0].updated_at, before[0].updated_at);
    assert_eq!(world.node.count("send_tx"), 1);

    world
        .node
        .script(|script| script.tx = Reply::Result(landed(0)));
    let result = claim.stage(&processes[2]).await.unwrap();
    assert_eq!(
        claim.advance(&processes[2], result).await,
        OperationStage::Relay
    );
    let settled = world.transactions(id).await;
    assert_eq!(settled.len(), 1);
    assert_eq!(settled[0].state, TransactionState::Succeeded);
    assert_eq!(
        world.node.count("view_access_key"),
        1,
        "one signature for the step, whoever held it"
    );
    world.assert_only_committed_bytes_were_sent(id).await;
}

#[sqlx::test]
async fn a_landed_relay_is_settled_by_reading_and_never_signed_again(pool: PgPool) {
    let world = World::start(pool).await;
    let processes = [world.process(), world.process(), world.process()];
    world
        .node
        .script(|script| script.send_tx = Reply::Result(landed(42)));

    // Signed, broadcast, landed; the holder dies before the stage change commits.
    let claim = world
        .claimed_in(&processes[0], add_proposal(), OperationStage::Relay)
        .await;
    assert!(matches!(
        claim.stage(&processes[0]).await,
        Ok(StageResult::NotReady(..))
    ));
    assert!(matches!(
        claim.stage(&processes[0]).await,
        Ok(StageResult::Advance(OperationStage::Settle))
    ));
    let id = world.crash(claim).await;
    let (signatures, broadcasts) = (
        world.node.count("view_access_key"),
        world.node.count("send_tx"),
    );
    assert_eq!((signatures, broadcasts), (1, 1));

    // The next holder finds the relay final and only moves the row on.
    let mut claim = world.claim(&processes[1], id).await;
    assert_eq!(claim.operation.stage, OperationStage::Relay);
    let result = claim.stage(&processes[1]).await.unwrap();
    assert_eq!(
        claim.advance(&processes[1], result).await,
        OperationStage::Settle
    );
    let id = world.crash(claim).await;

    // Settle with nothing in memory: an unreadable outcome is retried, a
    // readable one decides the result.
    let claim = world.claim(&processes[2], id).await;
    world.node.script(|script| script.tx = Reply::Down);
    let unreadable = claim.stage(&processes[2]).await;
    assert!(
        matches!(unreadable, Err(StageError::Transient(_))),
        "{}",
        describe_all(&unreadable)
    );
    world
        .node
        .script(|script| script.tx = Reply::Result(landed(42)));
    let Ok(StageResult::Done(completion)) = claim.stage(&processes[2]).await else {
        panic!("a readable outcome ends the operation");
    };
    assert!(matches!(
        completion.outcome,
        OperationOutcome::Succeeded { ref proposal_ids } if proposal_ids == &[42]
    ));
    assert_eq!(world.node.count("view_access_key"), signatures);
    assert_eq!(world.node.count("send_tx"), broadcasts);
    assert_eq!(world.transactions(id).await.len(), 1);
}

#[sqlx::test]
async fn a_relay_that_failed_on_chain_reaches_settle_and_fails_there(pool: PgPool) {
    let world = World::start(pool).await;
    let process = world.process();
    world
        .node
        .script(|script| script.send_tx = Reply::Result(failed_on_chain()));
    let mut claim = world
        .claimed_in(&process, add_proposal(), OperationStage::Relay)
        .await;
    assert!(matches!(
        claim.stage(&process).await,
        Ok(StageResult::NotReady(..))
    ));
    let result = claim.stage(&process).await.unwrap();
    assert_eq!(
        claim.advance(&process, result).await,
        OperationStage::Settle
    );

    world
        .node
        .script(|script| script.tx = Reply::Result(failed_on_chain()));
    let Ok(StageResult::Done(completion)) = claim.stage(&process).await else {
        panic!("a failed relay ends the operation");
    };
    assert!(matches!(
        completion.outcome,
        OperationOutcome::Failed {
            failure_code: FailureCode::OnChain(_),
            ..
        }
    ));
}

#[sqlx::test]
async fn settle_without_a_final_relay_is_parked_not_guessed(pool: PgPool) {
    let world = World::start(pool).await;
    let process = world.process();
    let claim = world
        .claimed_in(&process, add_proposal(), OperationStage::Settle)
        .await;
    assert!(matches!(
        claim.stage(&process).await,
        Err(StageError::Invariant(_))
    ));
}

#[sqlx::test]
async fn registrations_stop_the_vote_while_its_recipients_are_unknown(pool: PgPool) {
    let world = World::start(pool).await;
    let process = world.process();
    let claim = world
        .claimed_in(&process, approve(7), OperationStage::Registrations)
        .await;
    let id = claim.operation.id;

    // The proposal cannot be read: nothing is signed, the stage is retried.
    let result = claim.stage(&process).await;
    assert!(
        matches!(result, Err(StageError::Transient(_))),
        "{}",
        describe_all(&result)
    );
    assert!(world.transactions(id).await.is_empty());
    assert_eq!(world.node.count("send_tx"), 0);

    // Still unreadable half an hour on: the operation ends as not sent.
    sqlx::query(
        "UPDATE relay_operations SET created_at = NOW() - INTERVAL '31 minutes' WHERE id = $1",
    )
    .bind(id)
    .execute(&world.pool)
    .await
    .unwrap();
    let id = world.crash(claim).await;
    let claim = world.claim(&process, id).await;
    let Ok(StageResult::Done(completion)) = claim.stage(&process).await else {
        panic!("an operation that old with nothing in flight ends");
    };
    assert!(matches!(
        completion.outcome,
        OperationOutcome::Failed {
            failure_code: FailureCode::NotSent,
            ..
        }
    ));
}

#[sqlx::test]
async fn another_process_finishes_an_operation_from_the_stage_it_stopped_in(pool: PgPool) {
    let world = World::start(pool).await;
    let (first, second) = (world.process(), world.process());
    let id = world
        .submit(OperationKind::AddProposal, add_proposal())
        .await;

    // The first process authorizes, signs the storage top-up, and dies.
    let mut claim = world.claim(&first, id).await;
    let result = claim.stage(&first).await.unwrap();
    assert_eq!(
        claim.advance(&first, result).await,
        OperationStage::StorageTopUp
    );
    assert!(matches!(
        claim.stage(&first).await,
        Ok(StageResult::NotReady(..))
    ));
    world.crash(claim).await;

    world
        .node
        .script(|script| script.send_tx = Reply::Result(landed(42)));
    let taken = second
        .store()
        .claim_operation(id, LEASE)
        .await
        .unwrap()
        .unwrap();
    let RunOutcome::Terminal(done) = second.finish_run(taken).await else {
        panic!("the second process finishes it");
    };

    assert_eq!(done.state, OperationState::Succeeded);
    assert_eq!(done.proposal_ids.as_deref(), Some(&[42_i64][..]));
    assert_eq!(world.credits().await, 4);
    assert_eq!(
        world.node.count("get_policy"),
        1,
        "authorization was not run again"
    );
    assert_eq!(
        world.node.count("view_access_key"),
        2,
        "one signature each for the top-up and the relay"
    );
    assert_eq!(world.node.count("send_tx"), 2);
    let transactions = world.transactions(id).await;
    assert_eq!(transactions.len(), 2);
    assert!(
        transactions
            .iter()
            .all(|tx| tx.state == TransactionState::Succeeded)
    );
    world.assert_only_committed_bytes_were_sent(id).await;
}

#[sqlx::test]
async fn a_result_is_committed_once_when_the_process_dies_after_the_relay_lands(pool: PgPool) {
    let world = World::start(pool).await;
    let (first, second) = (world.process(), world.process());
    world
        .node
        .script(|script| script.send_tx = Reply::Result(landed(42)));

    // The relay lands and the row reaches `settle`; the process dies before
    // the result commits.
    let mut claim = world
        .claimed_in(&first, add_proposal(), OperationStage::Relay)
        .await;
    let id = claim.operation.id;
    sqlx::query("UPDATE relay_operations SET credit_reserved = TRUE WHERE id = $1")
        .bind(id)
        .execute(&world.pool)
        .await
        .unwrap();
    assert!(matches!(
        claim.stage(&first).await,
        Ok(StageResult::NotReady(..))
    ));
    let result = claim.stage(&first).await.unwrap();
    assert_eq!(claim.advance(&first, result).await, OperationStage::Settle);
    let Ok(StageResult::Done(unwritten)) = claim.stage(&first).await else {
        panic!("the first process had the result in hand");
    };
    sqlx::query(
        "UPDATE relay_operations SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1",
    )
    .bind(id)
    .execute(&world.pool)
    .await
    .unwrap();

    world
        .node
        .script(|script| script.tx = Reply::Result(landed(42)));
    let taken = second
        .store()
        .claim_operation(id, LEASE)
        .await
        .unwrap()
        .unwrap();
    let RunOutcome::Terminal(done) = second.finish_run(taken).await else {
        panic!("the second process commits the result");
    };
    assert_eq!(done.state, OperationState::Succeeded);
    assert_eq!(done.stage, OperationStage::Settle);

    // The first process comes back and tries to write what it had.
    let late = first
        .engine()
        .finish(&claim.operation, &claim.lease, unwritten)
        .await;
    let (RunOutcome::Terminal(late) | RunOutcome::Pending(late)) = late;
    assert_eq!(late.state, OperationState::Succeeded);
    let counted: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM relay_operations WHERE id = $1 AND state = 'succeeded'",
    )
    .bind(id)
    .fetch_one(&world.pool)
    .await
    .unwrap();
    assert_eq!(counted, 1);
    assert_eq!(
        world.node.count("view_access_key"),
        1,
        "nothing signed twice"
    );
    assert_eq!(world.node.count("send_tx"), 1);
    assert_eq!(world.transactions(id).await.len(), 1);
}
