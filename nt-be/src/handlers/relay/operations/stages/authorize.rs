//! First stage: decide whether the sponsor relays this action at all, and
//! take the gas credit for it.

use crate::{
    auth::AuthUser,
    config::plans::PlanType,
    handlers::relay::{
        access::{self, AuthorizedRelay},
        effects::accounting,
        parse::{RelayError, parse_relay},
        sponsor::policy,
    },
};

use super::{
    super::{
        models::{FailureCode, OperationStage},
        store::RelayStore,
    },
    Stage, StageContext, StageError, StageResult,
};

/// A delegate action closer than this to its `max_block_height` is refused:
/// the stages that follow could not land it in time.
const DELEGATE_EXPIRY_MARGIN_BLOCKS: u64 = 20;

pub struct Authorize;

impl Authorize {
    /// DAO permissions, the treasury's plan and credits, the deposit limit.
    async fn check(ctx: &StageContext<'_>) -> Result<AuthorizedRelay, RelayError> {
        let operation = ctx.operation;
        let parsed = parse_relay(operation.treasury_id.clone(), &operation.submission_payload)
            .map_err(|_| RelayError::rejected_before_send(axum::http::StatusCode::BAD_REQUEST))?;
        let actor = AuthUser {
            account_id: operation.actor_account_id.clone(),
        };
        let treasury_record = access::fetch_treasury_record(ctx.state, &parsed.treasury_id).await?;
        let authorized = access::authorize(ctx.state, &actor, parsed, treasury_record).await?;
        policy::enforce_deposit_limit(
            ctx.state,
            &authorized.treasury_id,
            authorized.tier,
            authorized.attached_deposit,
            ctx.plan.storage_cost,
        )
        .await?;
        Ok(authorized)
    }

    /// A `4xx` is the answer to the user and ends the operation; anything
    /// else is a read that failed and is tried again.
    fn refusal(error: RelayError) -> Result<StageResult, StageError> {
        if error.status.is_client_error() {
            Ok(StageResult::failed(
                FailureCode::Rejected(error.status),
                format!("refused at authorization with {}", error.status),
            ))
        } else {
            Err(StageError::Transient(format!(
                "authorization read failed with {}",
                error.status
            )))
        }
    }
}

impl Stage for Authorize {
    async fn run(&self, ctx: &StageContext<'_>) -> Result<StageResult, StageError> {
        if let Some(outcome) = ctx.unsendable(DELEGATE_EXPIRY_MARGIN_BLOCKS).await? {
            return Ok(StageResult::done(outcome));
        }
        // Read the policy first. `check` reports a failed read through the
        // relay's alerting error path, which is right for a request and wrong
        // for a stage that simply runs again in two seconds; a stalled
        // operation is reported by age instead.
        let actor = AuthUser {
            account_id: ctx.operation.actor_account_id.clone(),
        };
        if let Err((status, message)) = actor
            .fetch_dao_policy(ctx.state, &ctx.operation.treasury_id)
            .await
            && status.is_server_error()
        {
            return Err(StageError::Transient(format!(
                "DAO policy read failed with {status}: {message}"
            )));
        }
        let authorized = match Self::check(ctx).await {
            Ok(authorized) => authorized,
            Err(error) => return Self::refusal(error),
        };
        let mut tx = ctx
            .state
            .db_pool
            .begin()
            .await
            .map_err(|error| StageError::Store(error.into()))?;
        if let Err(error) =
            accounting::reserve_gas_credit(&mut *tx, &authorized.treasury_id, authorized.plan_type)
                .await
        {
            return Self::refusal(error);
        }
        let advanced = RelayStore::advance_stage_on(
            &mut tx,
            ctx.lease,
            OperationStage::Authorize,
            ctx.plan.stage_after(OperationStage::Authorize),
            Some(authorized.plan_type != PlanType::Enterprise),
        )
        .await?;
        tx.commit()
            .await
            .map_err(|error| StageError::Store(error.into()))?;
        Ok(StageResult::Advanced(Box::new(advanced)))
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;
    use crate::handlers::relay::operations::models::OperationOutcome;

    #[test]
    fn a_client_error_ends_the_operation_and_anything_else_is_retried() {
        for status in [
            StatusCode::FORBIDDEN,
            StatusCode::PAYMENT_REQUIRED,
            StatusCode::NOT_FOUND,
        ] {
            let Ok(StageResult::Done(completion)) =
                Authorize::refusal(RelayError::rejected_before_send(status))
            else {
                panic!("{status} is an answer to the user");
            };
            assert!(matches!(
                completion.outcome,
                OperationOutcome::Failed {
                    failure_code: FailureCode::Rejected(code),
                    ..
                } if code == status
            ));
        }
        for status in [StatusCode::INTERNAL_SERVER_ERROR, StatusCode::BAD_GATEWAY] {
            assert!(matches!(
                Authorize::refusal(RelayError::rejected_before_send(status)),
                Err(StageError::Transient(_))
            ));
        }
    }
}
