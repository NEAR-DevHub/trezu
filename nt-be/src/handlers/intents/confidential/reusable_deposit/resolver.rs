//! Serve the set: cache first, re-verify when stale, discover or create on
//! 1Click otherwise.

use std::sync::Arc;

use chrono::{Duration, Utc};
use near_account_id::AccountIdRef;
use reqwest::StatusCode;

use crate::AppState;
use crate::handlers::intents::confidential::refresh_dao_jwt;

use super::client::WithdrawalsError;
use super::minimum::bridge_minimum;
use super::repository::{
    clear_cached, db_error, is_monitored, load_cached_entry, store_cached, store_first,
};
use super::types::{ResolvedDepositAddress, ReusableDepositAddresses};

/// A cached set older than this is re-listed from 1Click before it is served
/// (rotated quotes, chains 1Click added since). 1Click being down keeps the
/// cached set in service.
const REVERIFY_AFTER: Duration = Duration::hours(24);
/// An explicit refresh within this window of the last 1Click read is a no-op,
/// so a run of requests for an unsupported chain costs one listing a minute.
const REFRESH_DEBOUNCE: Duration = Duration::minutes(1);

pub struct ReusableDepositResolver<'a> {
    pub(super) state: &'a Arc<AppState>,
    /// Public treasury: no 1Click session of its own. The set is created
    /// with the partner credentials and credits the public Intents balance.
    /// 1Click lists a set only to its owner's session, so an ownerless set
    /// cannot be discovered again: the stored copy is the only record.
    pub(super) public: bool,
}

impl<'a> ReusableDepositResolver<'a> {
    pub fn new(state: &'a Arc<AppState>) -> Self {
        Self {
            state,
            public: false,
        }
    }

    pub fn public(state: &'a Arc<AppState>) -> Self {
        Self {
            state,
            public: true,
        }
    }

    /// The 1Click bearer for this treasury's set: its own session, or the
    /// partner token for a public treasury.
    pub(super) async fn jwt(&self, dao_id: &AccountIdRef) -> Result<String, (StatusCode, String)> {
        if !self.public {
            return refresh_dao_jwt(self.state, dao_id).await;
        }
        self.state.env_vars.oneclick_jwt_token.clone().ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "ONECLICK_JWT_TOKEN is not set".to_string(),
        ))
    }

    /// The DAO's reusable deposit set: cached, else discovered from 1Click,
    /// else created. Needs the DAO's 1Click JWT for the 1Click paths.
    /// A cached set 1Click has not confirmed within `REVERIFY_AFTER` is
    /// re-listed first; if that fails the cached set is served as long as
    /// 1Click still answers for its address.
    #[tracing::instrument(level = "debug", skip_all, fields(dao_id = %dao_id))]
    pub async fn resolve(
        &self,
        dao_id: &AccountIdRef,
    ) -> Result<ReusableDepositAddresses, (StatusCode, String)> {
        let pool = &self.state.db_pool;
        let cached = load_cached_entry(pool, dao_id.as_str())
            .await
            .map_err(db_error)?;
        if let Some(cached) = cached {
            // A public set cannot be listed again: the stored copy is served
            // as is and never replaced.
            if self.public || cached.confirmed_within(REVERIFY_AFTER, Utc::now()) {
                return Ok(cached.set);
            }
            return match self.resolve_from_oneclick(dao_id).await {
                Ok(set) => {
                    self.record_confirmed(dao_id, &set, &cached.set).await?;
                    Ok(set)
                }
                Err((status, message)) => {
                    if self.cached_set_is_dead(dao_id, &cached.set).await {
                        clear_cached(pool, dao_id.as_str())
                            .await
                            .map_err(db_error)?;
                        tracing::warn!(
                            dao_id = dao_id.as_str(),
                            %status,
                            "reusable deposit set re-verify failed and 1Click no longer serves the cached set; cleared it: {message}"
                        );
                        return Err((status, message));
                    }
                    tracing::warn!(
                        dao_id = dao_id.as_str(),
                        %status,
                        "reusable deposit set re-verify failed; serving the cached set: {message}"
                    );
                    Ok(cached.set)
                }
            };
        }
        let set = self.resolve_from_oneclick(dao_id).await?;
        if self.public {
            return store_first(pool, dao_id.as_str(), &set)
                .await
                .map_err(db_error);
        }
        store_cached(pool, dao_id.as_str(), &set)
            .await
            .map_err(db_error)?;
        tracing::info!(
            dao_id = dao_id.as_str(),
            chains = set.chain_deposit_addresses.len(),
            "resolved reusable deposit set"
        );
        Ok(set)
    }

    /// The funding address for `chain` with the bridge floor for `token_id`.
    /// A chain missing from the cached set costs one refresh first, since
    /// 1Click may have added it.
    pub async fn deposit_address(
        &self,
        dao_id: &AccountIdRef,
        chain: &str,
        token_id: &str,
        amount: u128,
    ) -> Result<ResolvedDepositAddress, (StatusCode, String)> {
        let mut set = self.resolve(dao_id).await?;
        // A public set cannot be re-listed, so there is nothing to refresh.
        if set.address_for_chain(chain).is_none() && !self.public {
            match self.refresh(dao_id).await {
                Ok(fresh) => set = fresh,
                Err((status, message)) => tracing::warn!(
                    dao_id = dao_id.as_str(),
                    chain,
                    %status,
                    "reusable deposit set refresh failed: {message}"
                ),
            }
        }
        let entry = set.address_for_chain(chain).ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("No reusable deposit address for network {chain}"),
            )
        })?;
        let min_amount =
            bridge_minimum(self.state, dao_id.as_str(), token_id, amount, self.public).await;
        Ok(ResolvedDepositAddress {
            address: entry.address.clone(),
            memo: entry.memo.clone(),
            min_amount,
            quote_deposit_address: set.quote_deposit_address.clone(),
        })
    }

    /// Re-read the set from 1Click regardless of its age (a chain missing
    /// from the cached set may have been added since), debounced to one
    /// 1Click read per `REFRESH_DEBOUNCE`.
    #[tracing::instrument(level = "debug", skip_all, fields(dao_id = %dao_id))]
    pub async fn refresh(
        &self,
        dao_id: &AccountIdRef,
    ) -> Result<ReusableDepositAddresses, (StatusCode, String)> {
        let cached = load_cached_entry(&self.state.db_pool, dao_id.as_str())
            .await
            .map_err(db_error)?;
        if let Some(recent) = cached
            .as_ref()
            .filter(|cached| cached.confirmed_within(REFRESH_DEBOUNCE, Utc::now()))
        {
            return Ok(recent.set.clone());
        }
        let set = self.resolve_from_oneclick(dao_id).await?;
        match &cached {
            Some(cached) => self.record_confirmed(dao_id, &set, &cached.set).await?,
            None => store_cached(&self.state.db_pool, dao_id.as_str(), &set)
                .await
                .map_err(db_error)?,
        }
        Ok(set)
    }

    /// Whether 1Click has definitely stopped serving the cached set: its
    /// withdrawals read answers 404 or names another recipient. An auth or
    /// transport failure proves nothing about the address and is not a
    /// reason to withhold it.
    async fn cached_set_is_dead(
        &self,
        dao_id: &AccountIdRef,
        set: &ReusableDepositAddresses,
    ) -> bool {
        matches!(
            self.withdrawals(dao_id, set).await,
            Err(WithdrawalsError::StaleSet(_))
        )
    }

    async fn record_confirmed(
        &self,
        dao_id: &AccountIdRef,
        set: &ReusableDepositAddresses,
        previous: &ReusableDepositAddresses,
    ) -> Result<(), (StatusCode, String)> {
        store_cached(&self.state.db_pool, dao_id.as_str(), set)
            .await
            .map_err(db_error)?;
        if set.quote_deposit_address != previous.quote_deposit_address {
            tracing::warn!(
                dao_id = dao_id.as_str(),
                previous = %previous.quote_deposit_address,
                current = %set.quote_deposit_address,
                "reusable deposit set changed on 1Click; addresses shared earlier are stale"
            );
        } else if set.chain_deposit_addresses != previous.chain_deposit_addresses {
            tracing::info!(
                dao_id = dao_id.as_str(),
                chains = set.chain_deposit_addresses.len(),
                "reusable deposit set chains changed on 1Click"
            );
        }
        Ok(())
    }

    /// Discover the DAO's set on 1Click, else create it. A public set is
    /// only ever created, and only for a treasury we can store it for.
    async fn resolve_from_oneclick(
        &self,
        dao_id: &AccountIdRef,
    ) -> Result<ReusableDepositAddresses, (StatusCode, String)> {
        let jwt = self.jwt(dao_id).await?;
        if self.public {
            if !is_monitored(&self.state.db_pool, dao_id.as_str())
                .await
                .map_err(db_error)?
            {
                return Err((
                    StatusCode::NOT_FOUND,
                    format!("Treasury {dao_id} is not registered"),
                ));
            }
            return self.create(dao_id.as_str(), &jwt).await;
        }
        let set = match self.discover(dao_id.as_str(), &jwt).await? {
            Some(existing) => existing,
            None => match self.create(dao_id.as_str(), &jwt).await {
                Ok(created) => created,
                // 1Click rejects a second set for the account: the listing
                // lagged the create, so look again before giving up.
                Err((StatusCode::BAD_REQUEST, message)) => self
                    .discover(dao_id.as_str(), &jwt)
                    .await?
                    .ok_or((StatusCode::BAD_REQUEST, message))?,
                Err(error) => return Err(error),
            },
        };
        Ok(set)
    }
}
